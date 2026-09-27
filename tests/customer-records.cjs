// C1B PostgreSQL tests using local PGlite. No network. Concurrency is NOT simulated.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {fixture}=require('./pos-database.cjs');
const sql=name=>fs.readFileSync(path.join(__dirname,'../admin',name),'utf8').replace(/^\uFEFF/,'');
async function run(){
 const f=await fixture();const {db,id,rpc}=f;let checks=0;let sequence=5000;
 const check=(v,m)=>{assert.ok(v,m);checks++;};
 const query=async(s,a=[]) => (await db.query(s,a)).rows;
 const as=async(role,s,a=[])=>{await db.exec('set role '+role);try{return await query(s,a);}finally{await db.exec('reset role');}};
 const payload=(extra={})=>({submission_key:id(sequence++),customer_name:'Customer One',customer_phone:'09171234567',fulfillment_type:'delivery',delivery_option:'curv_rider',delivery_address:'Address One',payment_method:'gcash',subtotal:160,total:160,items:[{product_name:'Website Item',quantity:1,unit_price:160,line_total:160,item_note:'Original note'}],...extra});
 const submit=async p=>(await as('anon','select submit_public_order($1::jsonb) result',[JSON.stringify(p)]))[0].result;
 const row=async number=>(await query('select * from orders where order_number=$1',[number]))[0];
 const customer=async()=> (await query('select * from customers where normalized_phone=$1',['+639171234567']))[0];
 const state=async()=> (await query(`select (select jsonb_agg(to_jsonb(c) order by id) from customers c) customers,
   (select jsonb_agg(to_jsonb(o) order by id) from orders o) orders,
   (select jsonb_agg(to_jsonb(i) order by id) from order_items i) items`))[0];
 const fail=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
 try{
  await db.exec(sql('INCOMING_ORDERS_PHASE_O7E_TRACKING_DETAILS.sql'));
  const historical=await submit(payload({customer_phone:'09179999999'}));
  const old=await row(historical.order_number);
  const beforeFn=(await query("select pg_get_functiondef('submit_public_order(jsonb)'::regprocedure) d"))[0].d;
  const beforeTrack=await as('anon','select * from get_public_order_tracking($1::uuid)',[historical.tracking_token]);
  const trackDef=(await query("select pg_get_functiondef('get_public_order_tracking(uuid)'::regprocedure) d"))[0].d;
  await db.exec(sql('CUSTOMER_PHASE_C1B_SCHEMA.sql'));await db.exec(sql('CUSTOMER_PHASE_C1B_BACKEND.sql'));
  const oldAfter=await row(historical.order_number);delete oldAfter.customer_id;
  check(JSON.stringify(oldAfter)===JSON.stringify(old),'migration preserves all historical order fields');
  check((await query('select count(*)::int n from customers'))[0].n===0,'no backfill');
  const afterFn=(await query("select pg_get_functiondef('submit_public_order(jsonb)'::regprocedure) d"))[0].d;
  check(afterFn.replace('  perform customer_private.link_website_order(v_order_id);\n\n','')===beforeFn,'only successful final return path changed in RPC');
  await db.exec(sql('CUSTOMER_PHASE_C1B_SCHEMA.sql'));await db.exec(sql('CUSTOMER_PHASE_C1B_BACKEND.sql'));
  check((await query("select pg_get_functiondef('submit_public_order(jsonb)'::regprocedure) d"))[0].d===afterFn,'migration reapplication does not duplicate hook');
  for(const phone of ['09171234567','+639171234567','639171234567',' 09171234567 ']) check((await query('select customer_private.normalize_phone($1) n',[phone]))[0].n==='+639171234567','supported phone '+phone);
  for(const phone of [null,'',' ','abc','0917 123 4567','0917-123-4567','12309171234567','091712345678','+6309171234567','09171234567 ext 1','+63917123456x']) check((await query('select customer_private.normalize_phone($1::text) n',[phone]))[0].n===null,'unsupported phone rejected '+phone);
  check(JSON.stringify(await submit({submission_key:old.public_submission_key,customer_name:old.customer_name,customer_phone:old.customer_phone,fulfillment_type:'delivery',delivery_option:'curv_rider',delivery_address:'Address One',payment_method:'gcash',subtotal:160,total:160,items:[{product_name:'Website Item',quantity:1,unit_price:160,line_total:160,item_note:'Original note'}]}))===JSON.stringify(historical),'historical replay keeps original response');
  check((await row(historical.order_number)).customer_id===null && (await query('select count(*)::int n from customers'))[0].n===0,'historical replay does not backfill');
  for(const [type,phone] of [['pickup','09175555551'],['dine_in','09175555552']]) {
    const result=await submit(payload({fulfillment_type:type,customer_phone:phone,delivery_option:null,delivery_address:null}));
    const linked=await row(result.order_number);
    check(!!linked.customer_id && (await query('select latest_delivery_address from customers where id=$1',[linked.customer_id]))[0].latest_delivery_address===null,type+' creates a new contact with no address');
  }
  const firstPayload=payload();const first=await submit(firstPayload);let firstRow=await row(first.order_number);let c=await customer();
  check(!!c && firstRow.customer_id===c.id,'first website order creates and links customer');
  check(firstRow.customer_phone===firstPayload.customer_phone && firstRow.customer_name===firstPayload.customer_name && firstRow.delivery_address===firstPayload.delivery_address,'snapshots unchanged');
  check(Object.keys(first).sort().join(',')==='order_number,tracking_token','no customer in response');
  check(c.latest_name==='Customer One' && c.latest_delivery_address==='Address One','initial details');
  let before=await state();const replay=await submit(firstPayload);
  check(JSON.stringify(first)===JSON.stringify(replay),'replay response unchanged');
  check(JSON.stringify(before)===JSON.stringify(await state()),'replay touches no customers/orders/items');
  await fail(()=>submit({...firstPayload,customer_name:'Conflict'}),'P0001');
  check(JSON.stringify(before)===JSON.stringify(await state()),'conflicting key leaves all data untouched');
  for(const type of ['pickup','dine_in']) {
   const result=await submit(payload({fulfillment_type:type,customer_phone:'+639171234567',customer_name:type,delivery_address:null,delivery_option:null,payment_method:type==='dine_in'?'counter':'gcash'}));
   check((await row(result.order_number)).customer_id===c.id,type+' links same normalized phone');
   check((await customer()).latest_delivery_address==='Address One',type+' preserves address');
   check((await row(result.order_number)).delivery_address===null,type+' snapshot has no address');
  }
  const later=await submit(payload({customer_phone:'639171234567',customer_name:'Latest',delivery_address:'Address Two'}));
  check((await customer()).latest_name==='Latest' && (await customer()).latest_delivery_address==='Address Two','later delivery updates profile');
  check((await row(first.order_number)).delivery_address==='Address One','later updates never rewrite old snapshot');
  await submit(payload({delivery_address:' Returning customer '}));
  check((await customer()).latest_delivery_address==='Address Two','legacy placeholder cannot overwrite address');
  before=await state();await fail(()=>submit(payload({delivery_address:' '})),'22023');
  check(JSON.stringify(before)===JSON.stringify(await state()),'blank delivery validation preserved; no profile write');
  before=await state();await fail(()=>submit(payload({customer_phone:''})),'22023');
  check(JSON.stringify(before)===JSON.stringify(await state()),'blank phone retains existing RPC rejection and no contact');
  const invalid=await submit(payload({customer_phone:'not a supported phone'}));
  check((await row(invalid.order_number)).customer_id===null,'unsupported nonblank phone allows guest order without link');
  check((await row(invalid.order_number)).customer_phone==='not a supported phone','unsupported original phone retained');
  // A controlled local delayed-order fixture exercises the same private linker.
  const newest=await customer();const delayed=id(sequence++);
  await db.query(`insert into orders(id,order_number,customer_name,customer_phone,fulfillment_type,source,created_at,payment_method,delivery_option,delivery_address,delivery_fee_status)
    values($1,$2,'Older name','09171234567','delivery','website','2020-01-01T00:00:00Z','gcash','curv_rider','Stale address','to_confirm')`,[delayed,'C1B-DELAYED']);
  await query('select customer_private.link_website_order($1)',[delayed]);
  c=await customer();check(c.latest_name===newest.latest_name && c.latest_delivery_address===newest.latest_delivery_address,'older order cannot overwrite latest details');
  check(new Date(c.first_order_at).getUTCFullYear()===2020 && String(c.last_order_at)===String(newest.last_order_at),'first/last timestamps use min/max');
  before=await state();await query('select customer_private.link_website_order($1)',[delayed]);
  check(JSON.stringify(before)===JSON.stringify(await state()),'already linked order maintenance is no-op');
  for(const role of ['anon','authenticated']) for(const statement of [
    'select * from customers',"select * from customers where normalized_phone='+639171234567'",
    "insert into customers(normalized_phone,first_order_at,last_order_at) values('+639171111111',now(),now())",
    "update customers set latest_name='Intruder'",'delete from customers',
    'select customer_private.link_website_order(null::uuid)',"select customer_private.normalize_phone('09171234567')"
  ]) await fail(()=>as(role,statement),'42501');
  check((await query("select relrowsecurity from pg_class where oid='customers'::regclass"))[0].relrowsecurity,'RLS enabled');
  check((await query("select count(*)::int n from pg_policies where tablename='customers'"))[0].n===0,'no public/authenticated customer policies');
  check((await query("select pg_get_functiondef('get_public_order_tracking(uuid)'::regprocedure) d"))[0].d===trackDef,'tracking function untouched');
  check(JSON.stringify(await as('anon','select * from get_public_order_tracking($1::uuid)',[historical.tracking_token]))===JSON.stringify(beforeTrack),'historical tracking response unchanged');
  const tracked=await as('anon','select * from get_public_order_tracking($1::uuid)',[first.tracking_token]);
  check(!JSON.stringify(tracked).includes('customer_id') && !JSON.stringify(tracked).includes('normalized_phone') && tracked.length===1,'tracking exposes no contact/history');
  // A backend failure must roll back order/items/customer as one transaction.
  await db.exec(`create function public.c1b_fixture_fail() returns trigger language plpgsql as $$ begin raise exception 'fixture failure'; end $$;
    create trigger c1b_fixture_fail before insert on customers for each row execute function public.c1b_fixture_fail();`);
  before=await state();await fail(()=>submit(payload({customer_phone:'09170000001'})),'P0001');
  check(JSON.stringify(before)===JSON.stringify(await state()),'customer failure rolls back whole order transaction');
  await db.exec('drop trigger c1b_fixture_fail on customers; drop function public.c1b_fixture_fail()');
  const pos=await rpc('pos_create_order',{p_key:id(sequence++),p_size:id(40),p_choices:[id(60)],p_quantity:1,p_customer:'Counter',p_type:'dine_in',p_note:'',p_item_note:''});
  check(!pos.error && !!pos.data.id,'POS create still works with migration installed');
  const n=(await query('select count(*)::int n from customers'))[0].n;
  await query('select customer_private.link_website_order($1)',[pos.data.id]);
  check((await query('select customer_id from orders where id=$1',[pos.data.id]))[0].customer_id===null && (await query('select count(*)::int n from customers'))[0].n===n,'POS excluded from linkage');
  await db.exec(sql('CUSTOMER_PHASE_C1B_VERIFY.sql'));
  before=await state();await db.exec(sql('CUSTOMER_PHASE_C1B_SMOKE_TEST.sql'));
  check(JSON.stringify(before)===JSON.stringify(await state()),'smoke rollback leaves all business rows unchanged');
  console.log(checks+' C1B assertions passed. True two-session concurrency remains a separate acceptance test.');
 }finally{await db.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
