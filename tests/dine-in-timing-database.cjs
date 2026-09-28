
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture}=require('./pos-database.cjs');
(async()=>{const {db,id,rpc}=await fixture();let n=0,k=9000;const check=(v,m)=>{assert.ok(v,m);n++;};
const sql=f=>fs.readFileSync(path.join(__dirname,'../admin',f),'utf8');
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const payload=(extra={})=>({submission_key:id(k++),customer_name:'Dine guest',customer_phone:'',fulfillment_type:'dine_in',preparation_timing:'asap',requested_preparation_at:null,payment_method:'counter',subtotal:100,total:100,items:[{product_name:'Saved item',quantity:1,unit_price:100,line_total:100}],...extra});
const submit=async p=>{await db.exec('set role anon');try{return (await q('select submit_public_order($1::jsonb) r',[JSON.stringify(p)]))[0].r;}finally{await db.exec('reset role');}};
const order=async r=>(await q('select * from orders where order_number=$1',[r.order_number]))[0];
const fail=async(p,detail)=>{await assert.rejects(()=>submit(p),e=>e.code==='22023'&&(!detail||e.detail===detail));n++;};
try{
await db.exec(sql('CUSTOMER_PHASE_C1B_SCHEMA.sql'));await db.exec(sql('CUSTOMER_PHASE_C1B_BACKEND.sql'));
const legacyPayload=payload({customer_phone:'09171234567'});delete legacyPayload.preparation_timing;delete legacyPayload.requested_preparation_at;
const legacy=await submit(legacyPayload);const old=await order(legacy);
const meta=()=>q("select proowner,prosecdef,proconfig,proacl from pg_proc where oid='submit_public_order(jsonb)'::regprocedure");const beforeMeta=await meta();
await db.exec(sql('WEBSITE_DINE_IN_TIMING_SCHEMA.sql'));await db.exec(sql('WEBSITE_DINE_IN_TIMING_BACKEND.sql'));
const after=await order(legacy);check(after.preparation_timing===null&&after.requested_preparation_at===null,'legacy NULL/NULL');delete after.preparation_timing;delete after.requested_preparation_at;check(JSON.stringify(after)===JSON.stringify(old),'no historical backfill');
check(JSON.stringify(await meta())===JSON.stringify(beforeMeta),'security ownership ACL config unchanged');
check(JSON.stringify(await submit(legacyPayload))===JSON.stringify(legacy),'legacy replay remains accepted');
await db.exec(sql('WEBSITE_DINE_IN_TIMING_SCHEMA.sql'));await db.exec(sql('WEBSITE_DINE_IN_TIMING_BACKEND.sql'));check(true,'patches reapply');
await fail(payload({customer_name:''}));await fail(payload({preparation_timing:null}),'DINE_TIMING_REQUIRED');
const p=payload();const result=await submit(p);const r=await order(result);
check(r.customer_phone===''&&r.customer_id===null,'blank phone accepted without customer');check(r.preparation_timing==='asap'&&r.requested_preparation_at===null&&r.pickup_time===null,'ASAP has no fabricated time');check(r.payment_method==='counter'&&r.payment_status==='unpaid','counter payment preserved');check(r.delivery_address===null&&r.delivery_fee===null,'no delivery data');
const customersBefore=(await q('select count(*)::int n from customers'))[0].n;await submit(payload());check((await q('select count(*)::int n from customers'))[0].n===customersBefore,'phone-less order creates no customer');
const linked=await order(await submit(payload({customer_phone:'09171234567'})));check(!!linked.customer_id,'supported phone links through C1B');
check((await order(await submit(payload({customer_phone:'unsupported phone'})))).customer_id===null,'existing nonblank unsupported-phone behavior retained');await fail(payload({customer_phone:'x'.repeat(51)}));
await fail(payload({preparation_timing:'scheduled'}),'DINE_TIMING_INVALID');await fail(payload({requested_preparation_at:new Date().toISOString()}),'DINE_TIMING_INVALID');
for(const date of ['not-a-date','2026-09-28T25:00:00+08:00','2026-09-28T12:00:00']) await fail(payload({preparation_timing:'scheduled',requested_preparation_at:date}),'DINE_TIMING_INVALID');
const times=(await q("select clock_timestamp()-interval '1 minute' past, ((clock_timestamp() at time zone 'Asia/Manila')::date+1+time '12:00') at time zone 'Asia/Manila' tomorrow, ((clock_timestamp() at time zone 'Asia/Manila')::date+time '23:59:59.999') at time zone 'Asia/Manila' later"))[0];
await fail(payload({preparation_timing:'scheduled',requested_preparation_at:new Date(times.past).toISOString()}),'DINE_TIMING_NOT_LATER_TODAY');await fail(payload({preparation_timing:'scheduled',requested_preparation_at:new Date(times.tomorrow).toISOString()}),'DINE_TIMING_NOT_LATER_TODAY');
const scheduled=payload({preparation_timing:'scheduled',requested_preparation_at:new Date(times.later).toISOString()});const sr=await submit(scheduled);check(new Date((await order(sr)).requested_preparation_at).getTime()===new Date(times.later).getTime(),'later today UTC timestamp maps to Manila');
await db.exec("set timezone='America/Los_Angeles'");check(JSON.stringify(await submit(scheduled))===JSON.stringify(sr),'timezone-independent replay');await db.exec("set timezone='UTC'");
// Make time advance only within the disposable database to prove replay bypasses expired timing.
await db.exec("create function public.clock_timestamp() returns timestamptz language sql as $$ select pg_catalog.clock_timestamp()+interval '2 days' $$");
await db.exec("set search_path=public,pg_catalog,pg_temp");await db.exec("alter function submit_public_order(jsonb) set search_path=public,pg_catalog,pg_temp");
check(JSON.stringify(await submit(scheduled))===JSON.stringify(sr),'replay after scheduled time returns original order');
await fail({...scheduled,submission_key:id(k++)},'DINE_TIMING_NOT_LATER_TODAY');
await db.exec('drop function public.clock_timestamp()');await db.exec('alter function submit_public_order(jsonb) set search_path=public,pg_temp');
for(const type of ['pickup','delivery']){const p=payload({fulfillment_type:type,preparation_timing:null,requested_preparation_at:null,pickup_time:'ASAP',delivery_option:'curv_rider',delivery_address:'Address'});await fail(p);p.customer_phone='09171234567';const o=await order(await submit(p));check(o.pickup_time==='ASAP'&&o.preparation_timing===null,type+' timing unchanged');}
const count=(await q('select count(*)::int n from orders'))[0].n;await fail(payload({preparation_timing:'scheduled',requested_preparation_at:'invalid'}));check((await q('select count(*)::int n from orders'))[0].n===count,'failed validation persists no order');
for(const status of ['accepted','preparing','ready','completed']){await q('update orders set status=$1 where id=$2',[status,r.id]);check((await order(result)).status===status,'normal workflow '+status);}
for(const pair of [[null,new Date().toISOString()],['bad',null],['scheduled',null],['asap',new Date().toISOString()]]){await assert.rejects(()=>q('update orders set preparation_timing=$1,requested_preparation_at=$2 where id=$3',[...pair,r.id]),e=>e.code==='23514');n++;}
const pos=await rpc('pos_create_order',{p_key:id(k++),p_size:id(40),p_choices:[id(60)],p_quantity:1,p_customer:'Counter',p_type:'dine_in',p_note:'',p_item_note:''});check(!pos.error&&!!pos.data.id,'POS remains valid with NULL structured timing');
console.log(n+' dine-in database assertions passed (local PGlite).');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
