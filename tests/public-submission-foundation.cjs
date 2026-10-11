const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {submissionFixture,readSql,foundation,canonicalVector,vectorHash}=require('./public-submission-foundation-fixture.cjs');
(async()=>{const {db,id,rpc}=await submissionFixture();let n=0;
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const ok=(v,m)=>{assert.ok(v,m);n++;};
const equal=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
const bad=async(s,code,p=[])=>{await assert.rejects(()=>q(s,p),e=>e.detail===code||e.code===code);n++;};
const canonical=async p=>(await q('select submission_private.canonicalize_v2_intent($1::jsonb) v',[JSON.stringify(p)]))[0].v;
const hash=async p=>(await q('select submission_private.fingerprint_v2_intent($1::jsonb) v',[JSON.stringify(p)]))[0].v;
const prepare=async(p,context={})=>(await q('select submission_private.replay_or_prepare($1::jsonb) v',[JSON.stringify({payload:p,client_context:context})]))[0].v;
const invalid=async(p,code='ORDER_CART_INVALID')=>bad('select submission_private.canonicalize_v2_intent($1::jsonb)',code,[JSON.stringify(p)]);
const body=structuredClone(canonicalVector);
const legacy={submission_key:id(8001),customer_name:'Legacy Guest',customer_phone:'09171234567',fulfillment_type:'dine_in',payment_method:'counter',preparation_timing:'asap',subtotal:160,total:160,items:[{product_name:'Historical line',quantity:1,unit_price:160,line_total:160}]};
const submit=async p=>{await db.exec('set role anon');try{return(await q('select submit_public_order($1::jsonb) r',[JSON.stringify(p)]))[0].r;}finally{await db.exec('reset role');}};
const baseline=()=>q("select oid,pg_get_functiondef(oid) definition,proowner,prosecdef,proconfig,proacl from pg_proc where oid in ('submit_public_order(jsonb)'::regprocedure,'get_public_order_tracking(uuid)'::regprocedure,'customer_private.link_website_order(uuid)'::regprocedure)");
const state=()=>q(`select (select jsonb_agg(to_jsonb(o) order by id) from orders o) orders,(select jsonb_agg(to_jsonb(i) order by id) from order_items i) items,(select jsonb_agg(to_jsonb(c) order by id) from customers c) customers`);
try{
 const first=await submit(legacy),prior=await state(),before=await baseline();
 const migrationFailure=async(setup,restore)=>{
  await db.exec(setup);await assert.rejects(()=>db.exec(readSql(foundation)),e=>e.detail==='D0B2_PREREQUISITE');n++;
  await db.exec('rollback');ok((await q("select to_regnamespace('submission_private') n"))[0].n===null,'preflight applies no partial DDL');await db.exec(restore);
 };
 await migrationFailure('alter table orders rename column submission_fingerprint_version to missing_version','alter table orders rename column missing_version to submission_fingerprint_version');
 await migrationFailure('alter index orders_public_submission_key_idx rename to missing_key_index','alter index missing_key_index rename to orders_public_submission_key_idx');
 await migrationFailure('alter function customer_private.normalize_phone(text) rename to missing_normalizer','alter function customer_private.missing_normalizer(text) rename to normalize_phone');
 await migrationFailure('alter role anon rename to missing_anon','alter role missing_anon rename to anon');
 await db.exec(readSql(foundation));equal(await baseline(),before,'submission/tracking/link function definition and ACL unchanged');equal(await state(),prior,'no historical mutation');
 const h=await hash(body),c=await canonical(body);
 equal(h,vectorHash,'frozen v2 hash vector');
 equal(c.items[0].quantity,2,'integer quantity');equal(c.customer_phone,'+639171234567','C1B phone normalization reused');
 equal(await hash({...body,customer_phone:'+639171234567'}),h,'phone variants');equal(await hash({...body,customer_phone:'639171234567'}),h,'63 prefix');
 for(const phone of ['',null,'09171234567','639171234567','+639171234567','unsupported phone',' 09171234567 ']){
  const pair=(await q('select customer_private.normalize_phone($1) old,submission_private.normalize_phone_v2($1) frozen',[phone]))[0];equal(pair.old,pair.frozen,'frozen C1B phone rules match');
 }
 await db.exec('begin;alter function customer_private.normalize_phone(text) rename to later_crm_normalizer');equal(await hash(body),h,'v2 replay independent of future CRM helper changes');await db.exec('rollback');
 equal(await hash({...body,customer_name:' \tGuest\r\n',customer_phone:' 09171234567 ',fulfillment_type:' DINE_IN ',payment_method:' COUNTER ',preparation_timing:' ASAP '}),h,'boundary whitespace and enum case');
 equal(await hash({...body,items:[{...body.items[0],option_choice_ids:[id(61),id(60)]}]}),h,'choice ordering');
 const reverseKeys=value=>Array.isArray(value)?value.map(reverseKeys):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverseKeys(v)])):value;
 equal(await hash(reverseKeys(body)),h,'JSON field ordering');
 const rich={...body,subtotal:0,total:999999,review_fingerprint:'forged',pricing_snapshot:{fake:true},priced_at:'1900',ui_state:{open:true},items:[{...body.items[0],unit_price:-999,line_total:0,product_name:'Forged',category_name:'Other',variant_label:'Changed',options:{invented:'value'},option_snapshots:[{price:999}],pricing_configuration_snapshot:{fake:true},sort_order:99}]};
 equal(await hash(rich),h,'all browser monetary/display/review/server snapshot values excluded');
 const uuidBody={...body,items:[{...body.items[0],product_id:'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF'}]};
 equal(await hash({...uuidBody,items:[{...uuidBody.items[0],product_id:'{abcdefab-cdef-4abc-8def-abcdefabcdef}'}]}),await hash(uuidBody),'UUID textual aliases normalize');
 for(const patch of [{product_id:id(31)},{product_size_id:id(41)},{option_choice_ids:[id(62)]},{quantity:3},{item_note:'Less ice'}])ok(await hash({...body,items:[{...body.items[0],...patch}]})!==h,'changed item intent changes hash');
 for(const patch of [{customer_name:'guest'},{customer_phone:'09171234568'},{payment_method:'gcash'},{customer_notes:'Please call'},{customer_email:'guest@example.test'}])ok(await hash({...body,...patch})!==h,'changed order intent changes hash');
 const pickup={...body,fulfillment_type:'pickup',preparation_timing:null,requested_preparation_at:null,pickup_time:'ASAP'};
 ok(await hash(pickup)!==h,'fulfillment changes hash');
 ok(await hash({...pickup,pickup_time:'7 PM'})!==await hash(pickup),'pickup intent preserved');
 const delivery={...pickup,fulfillment_type:'delivery',delivery_option:'curv_rider',delivery_address:'Unit  2\nMain St'};
 for(const patch of [{delivery_option:'lalamove'},{delivery_address:'Unit 2\nMain St'},{delivery_address:'Different address'}])ok(await hash({...delivery,...patch})!==await hash(delivery),'delivery selection/free text remains meaningful');
 equal(await hash({...delivery,delivery_address:undefined,customer_address:delivery.delivery_address}),await hash(delivery),'legacy address alias');
 equal(await hash({...pickup,pickup_time:undefined,preferred_time:'ASAP'}),await hash(pickup),'legacy time alias');
 await invalid({...delivery,customer_address:'Conflicting alias'});await invalid({...pickup,preferred_time:'Conflicting alias'});
 const scheduled={...body,preparation_timing:'scheduled',requested_preparation_at:'2020-01-01T18:42:00.123456+08:00'};
 const sh=await hash(scheduled);ok(sh!==h,'timing changes hash');equal(await hash({...scheduled,requested_preparation_at:'2020-01-01T10:42:00.123456Z'}),sh,'same exact instant offset normalization');
 equal((await canonical(scheduled)).requested_preparation_at,'2020-01-01T10:42:00.123456Z','microseconds preserved, no future-time gate');
 await db.exec("set timezone='America/Los_Angeles';set datestyle='SQL, DMY'");equal(await hash(scheduled),sh,'session timezone/date style independent');await db.exec("set timezone='UTC';set datestyle='ISO, YMD'");
 for(const timestamp of ['invalid','2020-01-01T18:42:00','2020-02-30T18:42:00Z','2020-01-01T18:42:00.1234567Z'])await invalid({...scheduled,requested_preparation_at:timestamp});
 await invalid({...scheduled,requested_preparation_at:null});await invalid({...body,requested_preparation_at:'2020-01-01T18:42:00Z'});
 const two={...body,items:[body.items[0],{...body.items[0],product_id:id(31),item_note:'Different note'}]};
 equal(await hash({...two,items:[...two.items].reverse()}),await hash(two),'line ordering irrelevant');
 equal(await hash({...body,items:[{...body.items[0],quantity:1},{...body.items[0],quantity:1}]}),h,'identical lines canonically merge');
 equal((await canonical({...body,items:[body.items[0],{...body.items[0],item_note:'Other'}]})).items.length,2,'different notes stay separate');
 equal(await hash({...body,items:[{...body.items[0],item_note:' No ice '}]}),h,'note boundary trim');
 equal(await hash({...body,items:[{...body.items[0],item_note:''}]}),await hash({...body,items:[{...body.items[0],item_note:null}]}),'empty and NULL note');
 equal((await canonical({...body,customer_phone:''})).customer_phone,null,'blank dine-in phone accepted');
 equal((await canonical({...body,customer_phone:'unsupported phone'})).customer_phone,'unsupported phone','no invented phone identity or new business rule');
 await invalid({...pickup,customer_phone:''});await invalid({...delivery,customer_phone:''});
 for(const p of [null,[],{}, {...body,items:[]},{...body,items:{}},{...body,customer_name:''},{...body,customer_name:12},{...body,customer_name:'a'.repeat(201)},{...body,unexpected_intent:'ignored?'},{...body,ui_state:'x'.repeat(262144)}, {...body,items:Array(31).fill(body.items[0])}])await invalid(p,p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===0?'CLIENT_UPDATE_REQUIRED':'ORDER_CART_INVALID');
 for(const quantity of [0,-1,1.5,'2',null,2147483648])await invalid({...body,items:[{...body.items[0],quantity}]});
 for(const patch of [{product_id:null},{product_size_id:'bad'},{option_choice_ids:[id(60),id(60)]},{option_choice_ids:'bad'},{option_choice_ids:Array(65).fill(id(60))},{item_note:'x'.repeat(501)},{unknown_modifier:'bad'}])await invalid({...body,items:[{...body.items[0],...patch}]});
 await invalid({...body,items:[{...body.items[0],quantity:2147483647},{...body.items[0],quantity:1}]});
 await invalid({...body,pricing_contract_version:1},'CLIENT_UPDATE_REQUIRED');
 // Hash vector is computed from PostgreSQL canonical JSON text, UTF8 and explicit prefix.
 const canonicalText=(await q('select submission_private.canonicalize_v2_intent($1)::text t',[JSON.stringify(body)]))[0].t;
 equal(h,crypto.createHash('sha256').update('curv.intent.v2\n'+canonicalText,'utf8').digest('hex'),'explicit stable SHA-256 algorithm');
 const replay=await prepare(legacy);equal(replay.result,first,'version NULL uses exact v1 replay');
 const legacyHash=(await q('select public_submission_fingerprint h from orders where public_submission_key=$1',[legacy.submission_key]))[0].h;
 equal((await q('select submission_private.fingerprint_v1_payload($1) h',[JSON.stringify(legacy)]))[0].h,legacyHash,'exact existing O10 fingerprint');
 // Exercise actual legacy scheduled success and retry after time passes. The
 // temporary clock override is transaction-scoped test setup, rolled back fully.
 await db.exec('begin');
 const later=(await q("select to_char((((clock_timestamp() at time zone 'Asia/Manila')::date+time '23:59:59.999999') at time zone 'Asia/Manila') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') t"))[0].t;
 const legacyScheduled={...legacy,submission_key:id(8070),preparation_timing:'scheduled',requested_preparation_at:later};const scheduledResult=await submit(legacyScheduled);
 await db.exec("create function public.clock_timestamp() returns timestamptz language sql as $$select pg_catalog.clock_timestamp()+interval '2 days'$$;alter function submit_public_order(jsonb) set search_path=public,pg_catalog,pg_temp");
 equal(await submit(legacyScheduled),scheduledResult,'actual legacy scheduled replay after time passed');equal((await prepare(legacyScheduled)).result,scheduledResult,'private v1 scheduled replay after time passed');await db.exec('rollback');
 equal(await prepare(legacy,{new_ui_field:true,review_fingerprint:'new'}),replay,'additive envelope metadata does not change v1 payload');
 await bad('select submission_private.replay_or_prepare($1)','ORDER_SUBMISSION_KEY_CONFLICT',[JSON.stringify({payload:{...legacy,customer_name:'Changed'}})]);
 await bad('select submission_private.replay_or_prepare($1)','ORDER_SUBMISSION_KEY_CONFLICT',[JSON.stringify({payload:{...legacy,new_client_field:true}})]);
 await q('update orders set submission_fingerprint_version=1 where public_submission_key=$1',[legacy.submission_key]);equal((await prepare(legacy)).result,first,'explicit version 1 replays');
 await db.exec('update products set is_available=false;update product_sizes set price=999;update store_settings set website_ordering_enabled=false');
 equal(await submit(legacy),first,'current legacy RPC replay survives catalog/closure');equal((await prepare(legacy)).result,first,'private legacy replay precedes current validation');
 const prepared=await prepare(body);equal(prepared.state,'new','genuinely new v2 intent prepared, not submitted');equal(prepared.fingerprint,h,'version 2 fingerprint returned only internally');
 await bad('select submission_private.replay_or_prepare($1)','ORDER_CART_INVALID',[JSON.stringify({payload:{...body,submission_key:'bad'}})]);
 await bad('select submission_private.replay_or_prepare($1)','ORDER_CART_INVALID',[JSON.stringify({payload:body,client_context:{large:'x'.repeat(1048576)}})]);
 await bad('select submission_private.replay_or_prepare($1)','CLIENT_UPDATE_REQUIRED',[JSON.stringify({payload:{...legacy,submission_key:id(8099)}})]);
 // Synthetic historical v2 metadata only; no v2 creation endpoint is introduced.
 await q("update orders set submission_fingerprint_version=2,public_submission_fingerprint=$1 where public_submission_key=$2",[sh,legacy.submission_key]);
 equal((await prepare({...scheduled,submission_key:legacy.submission_key})).result,first,'stored v2 dispatch replays expired schedule before closure/catalog validation');
 await bad('select submission_private.replay_or_prepare($1)','ORDER_SUBMISSION_KEY_CONFLICT',[JSON.stringify({payload:{...scheduled,submission_key:legacy.submission_key,items:[{...body.items[0],quantity:3}]}})]);
 await bad('select submission_private.replay_or_prepare($1)','CLIENT_UPDATE_REQUIRED',[JSON.stringify({payload:legacy})]);
 const v2State=await state();equal((await prepare({...scheduled,submission_key:legacy.submission_key,total:1,review_fingerprint:'new review'})).result,first,'v2 prices/review changes replay original');equal(await state(),v2State,'replay has zero order/item/customer mutations');
 for(const code of ['ORDER_SUBMISSION_KEY_CONFLICT','ORDER_RETRY_REQUIRED','CLIENT_UPDATE_REQUIRED','ORDER_CART_INVALID']){
  await assert.rejects(()=>q('select submission_private.reject($1)',[code]),e=>e.detail===code&&!/hash|canonical|lock|select |insert /i.test(e.message));n++;
 }
 await db.exec('begin isolation level repeatable read');await bad('select submission_private.lock_submission_key($1)','ORDER_RETRY_REQUIRED',[id(888)]);await db.exec('rollback');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);for(const fn of ['canonicalize_v2_intent','fingerprint_v2_intent','fingerprint_v1_payload','replay_or_prepare'])await bad(`select submission_private.${fn}($1::jsonb)`,'42501',[JSON.stringify(body)]);
  await bad('select submission_private.lock_submission_key($1)','42501',[body.submission_key]);await db.exec('reset role');
 }
 ok((await q("select count(*)::int n from pg_proc where pronamespace='submission_private'::regnamespace and prosecdef")).at(0).n===0,'no new security definer functions');
 const data=await state();await assert.rejects(()=>db.exec(readSql(foundation)),e=>e.detail==='D0B2_COLLISION');n++;await db.exec('rollback');equal(await state(),data,'collision no partial writes');
 equal(await baseline(),before,'existing function baseline still identical');
 await db.exec('update store_settings set website_ordering_enabled=true;update products set is_available=true');
 const fresh=await submit({...legacy,submission_key:id(8050),customer_phone:'',customer_name:'Phone-less'});
 ok((await q('select customer_id,preparation_timing from orders where order_number=$1',[fresh.order_number]))[0].customer_id===null,'phone-less current dine-in still unlinked');
 const pos=await rpc('pos_create_order',{p_key:id(8051),p_size:id(40),p_choices:[id(60)],p_quantity:1,p_customer:'Counter',p_type:'dine_in',p_note:'',p_item_note:''});ok(!pos.error,'POS command remains functional');
 console.log(n+' D0B2 canonicalization/replay/security assertions passed (offline PGlite; concurrency tested separately).');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
