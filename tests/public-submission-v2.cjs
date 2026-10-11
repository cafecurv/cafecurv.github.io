const assert=require('node:assert/strict');
const {v2Fixture,certify,id,line,payload,query,reviewed,submit,readSql,backend}=require('./public-submission-v2-fixture.cjs');
(async()=>{const {db}=await v2Fixture();let n=0,key=90000;
const q=(s,p=[])=>query(db,s,p),eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;},ok=(v,m)=>{assert.ok(v,m);n++;};
const send=p=>submit(db,p),review=p=>reviewed(db,p);
const order=async r=>(await q('select * from orders where order_number=$1',[r.order_number]))[0];
const items=async r=>q('select i.* from order_items i join orders o on o.id=i.order_id where o.order_number=$1 order by i.sort_order',[r.order_number]);
const state=()=>q(`select (select jsonb_agg(to_jsonb(o) order by id) from orders o) orders,(select jsonb_agg(to_jsonb(i) order by id) from order_items i) items,(select jsonb_agg(to_jsonb(c) order by id) from customers c) customers`);
const seq=async()=>(await q('select last_value,is_called from order_number_seq'))[0];
const scoped=async f=>{await db.exec('begin');try{await f();}finally{await db.exec('rollback');}};
const fail=async(p,code)=>{const before=await state(),s=await seq();const r=await send(p);eq(r.error?.code,code,JSON.stringify(r));eq(await state(),before,'failed request no writes');eq(await seq(),s,'preallocation failure no sequence');return r;};
try{
 const p=await review(payload(key++)),s=await seq(),r=await send(p);ok(r.order_number&&r.tracking_token,'success contract');eq(Object.keys(r).sort(),['order_number','tracking_token'],'legacy result shape');
 eq(Number((await seq()).last_value),Number(s.last_value)+(s.is_called?1:0),'one allocation');let o=await order(r),i=(await items(r))[0];
 eq([o.pricing_contract_version,o.submission_fingerprint_version,o.pricing_fingerprint_version],[2,2,1],'order metadata');eq(o.accepted_review_fingerprint,p.review_fingerprint,'review stored');ok(o.priced_at,'pricing timestamp');
 eq([Number(o.subtotal),Number(o.total),Number(i.unit_price),Number(i.line_total)],[10.1,10.1,10.1,10.1],'authoritative amounts');eq(o.customer_id,null,'blank-phone guest');eq(o.payment_method,'counter','counter retained');eq(o.preparation_timing,'asap','ASAP');eq(o.requested_preparation_at,null,'no fabricated time');
 eq(i.product_name,'Simple sushi','server name');eq(i.variant_label,'Each','server size');ok(i.pricing_configuration_snapshot.contract_version===2,'structured snapshot');
 const before=await state(),afterseq=await seq();eq(await send(p),r,'exact replay');eq(await send({...p,review_fingerprint:'bad',subtotal:-999,items:[{...p.items[0],unit_price:-100,product_name:'Fake'}]}),r,'replay ignores review/display money');eq(await state(),before,'replay no maintenance');eq(await seq(),afterseq,'replay no allocation');
 await fail({...p,customer_name:'Changed'},'ORDER_SUBMISSION_KEY_CONFLICT');
 await scoped(async()=>{await q('update products set is_sold_out=true where id=$1',[id(1000)]);await q('update store_settings set website_ordering_enabled=false');eq(await send(p),r,'replay before availability and closed');await fail(await review(payload(key++,[line(1002,1104,[3001])])),'CURV_ORDERING_CLOSED');});
 for(const [ls,total] of [[[line(1001,1101,[3001,3010])],125],[[line(1002,1104,[3001])],100],[[line(1003,1105,[3002])],100],[[line(1004,1106,[3003])],100],[[line(1005,1107,[3031])],130],[[line(1005,1108,[3031])],240],[[line(1005,1109,[3031])],340],[[line(1001,1103,[3000,3011])],90],[[line(1001,1102,[3000,3010])],120],[[line(),line(1001,1101,[3000,3010])],110.1]]){
  const x=await send(await review(payload(key++,ls)));eq(Number((await order(x)).subtotal),total,'configuration persisted');ok((await items(x)).every(it=>it.pricing_configuration_snapshot),'every snapshot present');
 }
 const optionOrder=await send(await review(payload(key++,[line(1001,1101,[3000,3010,3020],2,'No lid')])));i=(await items(optionOrder))[0];eq(i.options,{Milk:['Full cream'],Temperature:['ICED'],Extras:['Extra shot']},'readable options');eq(i.item_note,'No lid','note');
 for(const [type,phone,linked] of [['pickup','09171234567',true],['delivery','unsupported',false],['dine_in','+639171234567',true]]){
  const x=await send(await review(payload(key++,[line()],{fulfillment_type:type,customer_phone:phone,preparation_timing:type==='dine_in'?'asap':null,payment_method:type==='dine_in'?'counter':'gcash',delivery_option:type==='delivery'?'curv_rider':null,delivery_address:type==='delivery'?'Address':null,pickup_time:type==='pickup'?'ASAP':null,delivery_fee:999,delivery_fee_status:'confirmed'})));
  o=await order(x);ok(o,'fulfillment success '+JSON.stringify(x));eq(!!o.customer_id,linked,'C1B phone behavior');eq(o.customer_phone,phone,'original phone snapshot');eq(o.delivery_fee,null,'no fabricated fee');eq(o.delivery_fee_status,type==='delivery'?'to_confirm':'not_applicable','delivery status');
 }
 const forged=await review(payload(key++));forged.subtotal=0;forged.total=0;forged.items[0]={...forged.items[0],unit_price:0,line_total:0,product_name:'Forged',options:{Fake:'Fake'}};const fx=await send(forged);eq(Number((await order(fx)).total),10.1,'forged total ignored');eq((await items(fx))[0].product_name,'Simple sushi','forged labels ignored');
 await scoped(async()=>{await q('update products set name=$1 where id=$2',['  Reviewed name  ',id(1000)]);await q('update product_sizes set label=$1 where id=$2',[' Each ',id(1100)]);await certify(db,1000);const x=await send(await review(payload(key++)));const saved=(await items(x))[0];eq(saved.product_name,'  Reviewed name  ','exact reviewed product label');eq(saved.variant_label,' Each ','exact reviewed size label');});
 await fail({...await review(payload(key++)),items:[line(1000,1100,[],2147483647)]},'QUANTITY_INVALID');
 for(const setup of ['update product_sizes set price=11.10 where id=$1','update products set name=\'Renamed\' where id=$1'])await scoped(async()=>{
  const x=await review(payload(key++)),before=await state(),s=await seq();await q(setup,[setup.includes('product_sizes')?id(1100):id(1000)]);await certify(db,1000);
  const changed=await send(x);eq(changed.error.code,'PRICE_CHANGED','price/label change');eq(await state(),before,'PRICE_CHANGED no order/customer writes');eq(await seq(),s,'PRICE_CHANGED no allocation');
  const next=await send({...x,review_fingerprint:changed.quote.review_fingerprint});ok(next.order_number,'same key reviewed retry succeeds');
 });
 await scoped(async()=>{const x=await review(payload(key++,[line(1001,1101,[3001,3010])]));await q('update option_choices set price_delta=26 where id=$1',[id(3001)]);await certify(db,1001);await fail(x,'PRICE_CHANGED');});
 await scoped(async()=>{const x=await review(payload(key++));await db.exec(`alter function configuration_private.customer_pricing_review(jsonb) rename to test_old_review;
 create function configuration_private.customer_pricing_review(p_pricing jsonb) returns jsonb language sql immutable set search_path=pg_catalog as $$select configuration_private.test_old_review(p_pricing||jsonb_build_object('pricing_policy_version','test-next-policy'))$$;`);await fail(x,'PRICE_CHANGED');});
 await scoped(async()=>{const x=await review(payload(key++));await q('update product_sizes set price=11 where id=$1',[id(1100)]);await fail(x,'CONFIGURATION_INVALID');});
 await scoped(async()=>{const x=await review(payload(key++));await q('update products set is_available=false where id=$1',[id(1000)]);await fail(x,'PRODUCT_UNAVAILABLE');});
 await fail({...await review(payload(key++)),review_fingerprint:'0'.repeat(64)},'PRICE_CHANGED');
 for(const change of [{customer_name:''},{fulfillment_type:'pickup',preparation_timing:null},{fulfillment_type:'delivery',preparation_timing:null,customer_phone:'09171234567',delivery_address:null},{preparation_timing:'scheduled',requested_preparation_at:null},{items:[]},{items:[{...line(),quantity:0}]}])await fail({...await review(payload(key++)),...change},'ORDER_CART_INVALID');
 await fail({...await review(payload(key++)),pricing_contract_version:1},'CLIENT_UPDATE_REQUIRED');
 await fail(await review(payload(key++,[line()],{preparation_timing:'scheduled',requested_preparation_at:'2000-01-01T01:00:00+08:00'})),'DINE_TIMING_NOT_LATER_TODAY');
 const tomorrow=new Date(Date.now()+86400000).toISOString();await fail(await review(payload(key++,[line()],{preparation_timing:'scheduled',requested_preparation_at:tomorrow})),'DINE_TIMING_NOT_LATER_TODAY');
 await fail({...await review(payload(key++)),customer_notes:'x'.repeat(1001)},'ORDER_CART_INVALID');
 for(const payment_method of [null,'bitcoin','gcash'])await fail(await review(payload(key++,[line()],{payment_method})),'ORDER_CART_INVALID');
 await fail(await review(payload(key++,[line()],{fulfillment_type:'delivery',preparation_timing:null,customer_phone:'09171234567',delivery_option:'lalamove',delivery_address:'Returning customer',payment_method:'gcash'})),'ORDER_CART_INVALID');
 for(const payment_method of ['counter','cod','gcash','bank']){const x=await send(await review(payload(key++,[line()],{fulfillment_type:'pickup',preparation_timing:null,customer_phone:'09171234567',payment_method})));eq((await order(x)).payment_status,'unpaid','selected payment remains unpaid');}
 await fail({...await review(payload(key++)),ui_state:'x'.repeat(262144)},'ORDER_CART_INVALID');
 const later=(await q("select to_char(((clock_timestamp() at time zone 'Asia/Manila')::date+time '23:59:59') at time zone 'Asia/Manila','YYYY-MM-DD\"T\"HH24:MI:SSOF') t"))[0].t.replace(/([+-]\d\d)$/,'$1:00');
 const scheduled=await review(payload(key++,[line()],{preparation_timing:'scheduled',requested_preparation_at:later}));const sr=await send(scheduled);ok(sr.order_number,'later today scheduled');eq(new Date((await order(sr)).requested_preparation_at).getTime(),new Date(later).getTime(),'Manila timestamp');
 // A moved-past canonical timestamp + matching stored intent simulates elapsed
 // time without changing frozen canonicalization or weakening current checks.
 const past={...scheduled,requested_preparation_at:'2000-01-01T01:00:00+08:00'};
 await scoped(async()=>{await q('update orders set public_submission_fingerprint=submission_private.fingerprint_v2_intent($1) where order_number=$2',[JSON.stringify(past),sr.order_number]);eq(await send(past),sr,'matching replay after time passes');});
 // Rollback covers legacy insert, items, linker, v2 metadata and snapshots.
 for(const target of ['item','link','snapshot'])await scoped(async()=>{
  const x=await review(payload(key++,[line()],{customer_phone:'09179999999'})),before=await state();
  if(target==='link')await db.exec(`create or replace function customer_private.link_website_order(p_order_id uuid) returns void language plpgsql as $$begin raise exception 'private-link-secret';end$$`);
  else await db.exec(`create function public.test_fail_v2() returns trigger language plpgsql as $$begin raise exception 'private-item-secret';end$$;create trigger test_fail_v2 before ${target==='item'?'insert':'update of pricing_configuration_snapshot'} on order_items for each row execute function public.test_fail_v2()`);
  const result=await send(x);eq(result.error?.code,'ORDER_INTERNAL_ERROR',target+' failure sanitized');ok(!JSON.stringify(result).includes('secret'),'no internals');eq(await state(),before,'complete rollback '+target);
 });
 const legacy={submission_key:id(key++),customer_name:'Legacy',customer_phone:'09175555555',fulfillment_type:'pickup',payment_method:'gcash',subtotal:15,total:15,items:[{product_name:'Old snapshot',quantity:1,unit_price:15,line_total:15}]};
 const lr=(await q('select submit_public_order($1) v',[JSON.stringify(legacy)]))[0].v;eq(await send(legacy),lr,'exact stored legacy replay through new entry');
 const tracked=(await q('select public.get_public_order_tracking($1::uuid) v',[r.tracking_token]))[0];ok(JSON.stringify(tracked).includes(r.order_number),'tracking compatibility');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{eq(await send(p),r,role+' public replay');await assert.rejects(()=>q('select submission_private.replay_or_prepare($1)',[JSON.stringify({payload:p})]),e=>e.code==='42501');n++;}finally{await db.exec('reset role');}}
 await db.exec('create role v2_ungranted;set role v2_ungranted');try{await assert.rejects(()=>send(p),e=>e.code==='42501');n++;}finally{await db.exec('reset role');}
 eq((await q("select proconfig from pg_proc where oid='public.submit_public_order_v2(jsonb)'::regprocedure"))[0].proconfig,['search_path=pg_catalog'],'pinned path');
 await assert.rejects(()=>db.exec(readSql(backend)),e=>e.detail==='D0B5_COLLISION');n++;await db.exec('rollback');
 console.log(n+' D0B5 integration assertions passed.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
