const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {pricingFixture,certify,id,line,readSql}=require('./public-pricing-engine-fixture.cjs');
const preview='WEBSITE_PRICING_D0B4_PREVIEW.sql';
(async()=>{const {db}=await pricingFixture();let n=0;
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const equal=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};const ok=(v,m)=>{assert.ok(v,m);n++;};
const request=items=>({pricing_contract_version:2,items});
const call=async r=>(await q('select public.quote_public_cart($1::jsonb) v',[JSON.stringify(r)]))[0].v;
const quote=async items=>{const r=await call(request(items));assert.equal(r.ok,true,JSON.stringify(r));return r.quote;};
const fail=async(r,code)=>{const v=await call(r);equal(v.ok,false,code);equal(v.error.code,code,'stable safe code');equal(Object.keys(v.error).sort(),['code','message'],'no diagnostic fields');return v;};
const scoped=async fn=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
const state=()=>q(`select (select jsonb_agg(to_jsonb(o) order by id) from orders o) orders,
 (select jsonb_agg(to_jsonb(i) order by id) from order_items i) items,
 (select jsonb_agg(to_jsonb(c) order by id) from customers c) customers,
 (select jsonb_agg(to_jsonb(s) order by schemaname,sequencename) from pg_sequences s) sequences`);
const baseline=()=>q(`select oid,pg_get_functiondef(oid) definition,proacl,proconfig,proowner from pg_proc where oid in
 ('public.submit_public_order(jsonb)'::regprocedure,'public.get_public_order_tracking(uuid)'::regprocedure,'customer_private.link_website_order(uuid)'::regprocedure)`);
try{
 const functionsBefore=await baseline();await db.exec(readSql(preview));equal(await baseline(),functionsBefore,'submission/tracking/customer-link definitions, owners and ACL unchanged');
 // A legitimate existing website order makes the no-update checks non-vacuous.
 const seed={submission_key:id(88001),customer_name:'Existing customer',customer_phone:'09171234567',fulfillment_type:'delivery',delivery_option:'curv_rider',delivery_address:'Existing address',payment_method:'gcash',subtotal:160,total:160,items:[{product_name:'Existing website item',quantity:1,unit_price:160,line_total:160}]};
 await q('select public.submit_public_order($1::jsonb)',[JSON.stringify(seed)]);
 equal((await q('select count(*)::int n from customers'))[0].n,1,'existing customer fixture');
 equal((await q('select count(*)::int n from orders where public_submission_key is not null'))[0].n,1,'existing submission key fixture');
 const before=await state(),simple=await quote([line()]),drink=line(1001,1101,[3000,3010]);
 equal(simple.subtotal,'10.10','zero-option product');equal(simple.currency,'PHP','currency');
 equal((await quote([drink])).subtotal,'100.00','explicit required defaults');
 equal((await quote([line(1001,1101,[3001,3010,3020])])).subtotal,'165.00','optional extra and premium milk');
 for(const [p,s,c] of [[1002,1104,3001],[1003,1105,3002],[1004,1106,3003]])equal((await quote([line(p,s,[c])])).subtotal,'100.00','included milk');
 for(const [s,total] of [[1107,'130.00'],[1108,'240.00'],[1109,'340.00']])equal((await quote([line(1005,s,[3031])])).subtotal,total,'contextual cheese');
 for(const [s,c,total] of [[1103,3011,'90.00'],[1101,3010,'100.00'],[1102,3010,'120.00']])equal((await quote([line(1001,s,[3000,c])])).subtotal,total,'temperature tuple');
 const multi=await quote([line(1000,1100,[],3,'No sauce'),drink]);equal(multi.subtotal,'130.30','exact multi-item subtotal');
 equal(await quote([drink,line(1000,1100,[],3,'No sauce')]),multi,'deterministic line ordering');
 equal(await quote([line(1001,1101,[3010,3000])]),await quote([drink]),'choice ordering does not alter quote/hash');
 equal(await quote([line(),line()]),await quote([line(1000,1100,[],2)]),'merged intent stable');
 equal(await quote([line()]),simple,'repeat preview stable');
 equal(await quote([{...line(),unit_price:0,line_total:-1,subtotal:1,product_name:'Forged',size_label:'Fake',options:[{label:'Fake'}]}]),simple,'forged labels and money ignored');
 ok(/^[a-f0-9]{64}$/.test(simple.review_fingerprint),'SHA-256 hex');equal(simple.pricing_fingerprint_version,1,'review algorithm version');
 for(const item of multi.items){for(const key of ['base_price','option_total','unit_price','line_total'])ok(/^\d+\.\d{2}$/.test(item[key]),'fixed decimal '+key);for(const o of item.options)ok(/^\d+\.\d{2}$/.test(o.effective_price_delta),'public option money string');}
 equal(Object.keys(simple).sort(),['currency','items','pricing_contract_version','pricing_fingerprint_version','pricing_policy_version','review_fingerprint','subtotal'].sort(),'quote allowlist');
 equal(Object.keys(simple.items[0]).sort(),['line_index','product_id','product_size_id','option_choice_ids','quantity','item_note','product_name','category_name','size_label','base_price','option_total','unit_price','line_total','options'].sort(),'line allowlist');
 const priced=(await q('select configuration_private.price_order_configuration($1) v',[JSON.stringify([drink])]))[0].v;
 const project=async p=>(await q('select configuration_private.customer_pricing_review($1) v',[JSON.stringify(p)]))[0].v;
 const review=await project(priced);
 const polluted=structuredClone(priced);polluted.private_rules={secret:true};polluted.timestamp='2099-01-01';polluted.review_fingerprint='forged';polluted.items[0].cost=999;polluted.items[0].options[0].internal_note='secret';
 equal(await project(polluted),review,'unknown/private engine metadata excluded');
 equal(Object.keys(review.items[0].options[0]).sort(),['group_id','group_key','group_name','choice_id','label','value','effective_price_delta'].sort(),'option allowlist');
 // Freeze PostgreSQL JSONB canonical bytes as well as SHA-256; do not use JS JSON.stringify for the database hash.
 const vectors=[simple,multi];
 for(let i=0;i<vectors.length;i++){
  const v=vectors[i];const canonical=(await q("select ($1::jsonb-'review_fingerprint')::text t",[JSON.stringify(v)]))[0].t;
  equal(v.review_fingerprint,createHash('sha256').update('CURV:PUBLIC_PRICING_REVIEW:v1:'+canonical,'utf8').digest('hex'),'independent digest vector '+i);
  equal(v.review_fingerprint,['6fa69d168e1b6ce3612232793989604560eab4b8551b7fa614364069e0cf5abd','3e20735640e5b9c4f540c1980f328f931815ed87e881cf4c371300881301d525'][i],'frozen review v1 vector '+i);
 }
 for(const [field,value] of [['pricing_policy_version','curv-cart-v2.2'],['currency','USD']]){const p=structuredClone(priced);p[field]=value;ok((await project(p)).review_fingerprint!==review.review_fingerprint,field+' included in hash');}
 for(const field of ['product_name','category_name','size_label']){const p=structuredClone(priced);p.items[0][field]+=' changed';ok((await project(p)).review_fingerprint!==review.review_fingerprint,field+' included in hash');}
 for(const [key,value] of [['quantity',2],['item_note','Different note']])ok((await quote([{...line(),[key]:value}])).review_fingerprint!==simple.review_fingerprint,key+' changes hash');
 await scoped(async()=>{await q('update product_sizes set price=11.10 where id=$1',[id(1100)]);await certify(db,1000);const v=await quote([line()]);equal(v.subtotal,'11.10','fresh base price');ok(v.review_fingerprint!==simple.review_fingerprint,'base change changes hash');});
 await scoped(async()=>{const old=await quote([line(1001,1101,[3001,3010])]);await q('update option_choices set price_delta=26 where id=$1',[id(3001)]);await certify(db,1001);const v=await quote([line(1001,1101,[3001,3010])]);equal(v.subtotal,'126.00','fresh option price');ok(v.review_fingerprint!==old.review_fingerprint,'option change changes hash');});
 await scoped(async()=>{await q('update products set name=$1 where id=$2',['Server renamed sushi',id(1000)]);const v=await quote([line()]);equal(v.items[0].product_name,'Server renamed sushi','fresh server label');ok(v.review_fingerprint!==simple.review_fingerprint,'server name changes hash');});
 await scoped(async()=>{await q('update option_choices set label=$1 where id=$2',['Renamed milk',id(3000)]);await certify(db,1001);ok((await quote([drink])).review_fingerprint!==review.review_fingerprint,'server option label changes hash');});
 for(const [r,code] of [[null,'ORDER_CART_INVALID'],[[],'ORDER_CART_INVALID'],[{},'ORDER_CART_INVALID'],[{items:[line()],pricing_contract_version:'2'},'ORDER_CART_INVALID'],[{...request([line()]),customer_name:'No checkout here'},'ORDER_CART_INVALID'],[request([]),'ORDER_CART_INVALID'],[request(Array(31).fill(line())),'ORDER_CART_INVALID'],[request([{...line(),item_note:'x'.repeat(262144)}]),'ORDER_CART_INVALID'],[request([{...line(),item_note:'x'.repeat(501)}]),'ORDER_CART_INVALID'],[request([{...line(),product_id:'bad'}]),'ORDER_CART_INVALID'],[request([{...line(),option_choice_ids:Array(65).fill(id(3000))}]),'ORDER_CART_INVALID'],[request([line(99999,1100)]),'PRODUCT_UNAVAILABLE'],[request([line(1000,1101)]),'SIZE_INVALID'],[request([line(1000,1100,[99999])]),'OPTION_INVALID'],[request([line(1001,1101)]),'OPTION_REQUIRED'],[request([line(1001,1101,[3000,3001,3010])]),'OPTION_SELECTION_INVALID'],[request([line(1001,1102,[3000,3011])]),'OPTION_SELECTION_INVALID'],[request([{...line(),quantity:0}]),'QUANTITY_INVALID'],[request([{...line(),quantity:2147483648}]),'QUANTITY_INVALID']])await fail(r,code);
 await scoped(async()=>{await q('update product_sizes set price=price+1 where id=$1',[id(1100)]);await fail(request([line()]),'CONFIGURATION_INVALID');});
 await scoped(async()=>{await q('update products set is_available=false where id=$1',[id(1000)]);await fail(request([line()]),'PRODUCT_UNAVAILABLE');});
 // Fault injection is transaction-scoped; no private exception text may escape.
 for(const clause of ["errcode='XX000',detail='private secret table'","errcode='22023',detail='NOT_AN_ALLOWED_CODE'","errcode='57014',detail='timeout private secret'"]){await scoped(async()=>{
  await db.exec(`create or replace function configuration_private.price_order_configuration(p_items jsonb) returns jsonb language plpgsql stable set search_path=pg_catalog as $$begin raise exception 'private SQL helper secret' using ${clause};end$$`);
  const r=await fail(request([line()]),'PRICING_UNAVAILABLE');ok(!JSON.stringify(r).includes('secret'),'unexpected diagnostic removed');
 });}
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);try{equal(await quote([line()]),simple,role+' allowed public call');await assert.rejects(()=>q('select configuration_private.price_order_configuration($1)',[JSON.stringify([line()])]),e=>e.code==='42501');n++;
   await assert.rejects(()=>q('select configuration_private.customer_pricing_review($1)',[JSON.stringify(priced)]),e=>e.code==='42501');n++;
   for(const table of ['configuration_private.product_pricing_certifications','public.product_option_choice_price_overrides','public.product_option_choice_override_requirements']){await assert.rejects(()=>q('select * from '+table),e=>e.code==='42501');n++;}
  }finally{await db.exec('reset role');}
 }
 await db.exec('create role preview_ungranted;set role preview_ungranted');
 try{await assert.rejects(()=>call(request([line()])),e=>e.code==='42501');n++;}finally{await db.exec('reset role');}
 const meta=(await q("select prosecdef,provolatile,proconfig from pg_proc where oid='public.quote_public_cart(jsonb)'::regprocedure"))[0];equal(meta,{prosecdef:true,provolatile:'s',proconfig:['search_path=pg_catalog']},'wrapper security metadata');
 equal((await q("select count(*)::int n from pg_proc p,lateral aclexplode(p.proacl) a where p.oid='public.quote_public_cart(jsonb)'::regprocedure and a.grantee=0"))[0].n,0,'no PUBLIC grant');
 equal(await state(),before,'no order/item/customer/submission/payment or sequence mutation');equal(await baseline(),functionsBefore,'baseline still unchanged');
 console.log(n+' public pricing preview assertions passed.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
