const assert=require('node:assert/strict');
const {pricingFixture,certify,id,line,readSql,engine}=require('./public-pricing-engine-fixture.cjs');
(async()=>{const {db,rpc}=await pricingFixture();let n=0;
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const ok=(v,m)=>{assert.ok(v,m);n++;};const equal=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
const price=async items=>(await q('select configuration_private.price_order_configuration($1::jsonb) v',[JSON.stringify(items)]))[0].v;
let scopedTransaction=false;
const fail=async(items,code)=>{if(scopedTransaction)await db.exec('savepoint expected_failure');try{await assert.rejects(()=>price(items),e=>e.detail===code);n++;}finally{if(scopedTransaction)await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}};
const scoped=async fn=>{await db.exec('begin');scopedTransaction=true;try{await fn();}finally{await db.exec('rollback');scopedTransaction=false;}};
const change=async(sql,items,code)=>scoped(async()=>{await db.exec(sql);await fail(items,code);});
const state=()=>q(`select (select jsonb_agg(to_jsonb(o) order by id) from orders o) orders,(select jsonb_agg(to_jsonb(i) order by id) from order_items i) items,(select jsonb_agg(to_jsonb(c) order by id) from customers c) customers`);
try{
 const before=await state(),simple=await price([line()]);equal(simple.subtotal,'10.10','certified zero-option product');
 equal(simple.items[0].base_price,'10.10','base price is server size price');equal(simple.items[0].product_name,'Simple sushi','server product name');
 equal(simple.items[0].category_name,'Pricing fixture','server category');equal(simple.items[0].size_label,'Each','server size');
 const drink=line(1001,1101,[3000,3010]);equal((await price([drink])).subtotal,'100.00','explicit required free defaults');
 equal((await price([line(1001,1101,[3001,3010])])).subtotal,'125.00','non-included premium milk');
 for(const [p,s,c] of [[1002,1104,3001],[1003,1105,3002],[1004,1106,3003]])equal((await price([line(p,s,[c])])).subtotal,'100.00','included premium milk '+c);
 for(const [s,total] of [[1107,'130.00'],[1108,'240.00'],[1109,'340.00']])equal((await price([line(1005,s,[3031])])).subtotal,total,'Takoyaki exact-size cheese '+s);
 for(const [c,delta] of [[3020,40],[3021,10],[3022,15],[3023,5],[3024,20],[3025,35],[3026,30],[3027,0]])equal((await price([line(1001,1101,[3000,3010,c])])).subtotal,(100+delta).toFixed(2),'ordinary modifier '+c);
 equal((await price([line(1001,1101,[3000,3010,3020,3021])])).subtotal,'150.00','optional multi-select');
 equal((await price([line(1006,1110,[3040])])).subtotal,'200.00','free savory sauce');
 equal((await price([line(1007,1111,[3050,3051])])).subtotal,'53.00','required multi-select');
 for(const [s,c,total] of [[1103,3011,'90.00'],[1101,3010,'100.00'],[1102,3010,'120.00']])equal((await price([line(1001,s,[3000,c])])).subtotal,total,'explicit temperature '+s);
 equal((await price([line(1000,1100,[],3,'  Keep\n  spaces  '),drink])).subtotal,'130.30','exact multi-line arithmetic');
 equal((await price([line(1000,1100,[],1,'  Keep\n  spaces  ')])).items[0].item_note,'Keep\n  spaces','only boundary note whitespace trimmed');
 const forged={...line(),unit_price:-99,line_total:0,subtotal:0,total:0,product_name:'Fake',category_name:'Fake',size_label:'Fake',options:{fake:'Fake'},option_snapshots:[{label:'Fake',price:-999}]};
 equal(await price([forged]),simple,'forged prices, labels, subtotal and option snapshots ignored');
 equal(await price([line(1001,1101,[3010,3000])]),await price([drink]),'choice order deterministic');
 equal(await price([drink,line()]),await price([line(),drink]),'line order deterministic');
 equal(await price([line(),line()]),await price([line(1000,1100,[],2)]),'identical configurations merge consistently with D0B2');
 equal((await price([line(1000,1100,[],1,'A'),line(1000,1100,[],1,'B')])).items.length,2,'different notes stay separate');
 const normalized=(await q('select submission_private.canonicalize_v2_intent($1) v',[JSON.stringify({pricing_contract_version:2,customer_name:'Parity fixture',customer_phone:'',fulfillment_type:'dine_in',preparation_timing:'asap',items:[drink,line(),line()]})]))[0].v.items;
 equal((await price([line(),drink,line()])).items.map(({product_id,product_size_id,option_choice_ids,quantity,item_note})=>({product_id,product_size_id,option_choice_ids,quantity,item_note})),normalized,'D0B2 canonical line identity and merging parity');
 const snapshot=(await price([drink])).items[0].pricing_configuration_snapshot;
 ok((await q('select configuration_private.valid_pricing_snapshot($1) v',[JSON.stringify(snapshot)]))[0].v,'snapshot matches D0B1 persistence shape');
 equal(snapshot.options.map(o=>o.choice_id),[id(3000),id(3010)],'deterministic option snapshot order');
 ok(snapshot.options.every(o=>o.group_id&&o.group_key&&o.group_name&&o.label&&o.value!==undefined&&typeof o.effective_price_delta==='number'),'complete server option snapshots');
 for(const [items,code] of [[null,'ORDER_CART_INVALID'],[{},'ORDER_CART_INVALID'],[[],'ORDER_CART_INVALID'],[Array(31).fill(line()),'ORDER_CART_INVALID'],[[{...line(),ui_state:'x'.repeat(262144)}],'ORDER_CART_INVALID'],[[{...line(),product_id:'bad'}],'ORDER_CART_INVALID'],[[{...line(),product_size_id:null}],'ORDER_CART_INVALID'],[[{...line(),item_note:'x'.repeat(501)}],'ORDER_CART_INVALID'],[[{...line(),option_choice_ids:null}],'ORDER_CART_INVALID'],[[{...line(),option_choice_ids:Array(65).fill(id(3000))}],'ORDER_CART_INVALID'],[[{...line(),unexpected:'value'}],'ORDER_CART_INVALID']])await fail(items,code);
 for(const quantity of [0,-1,1.5,'2',null,2147483648])await fail([{...line(),quantity}],'QUANTITY_INVALID');
 await fail([line(1000,1100,[],2147483647),line()],'QUANTITY_INVALID');
 await fail([line(99999,1100)],'PRODUCT_UNAVAILABLE');await fail([line(1000,1101)],'SIZE_INVALID');await fail([line(1000,99999)],'SIZE_INVALID');
 for(const condition of ['is_available=false','is_published=false','is_sold_out=true','archived_at=now()'])await change(`update products set ${condition} where id='${id(1000)}'`,[line()],'PRODUCT_UNAVAILABLE');
 await fail([line(1000,1100,[3000])],'OPTION_INVALID');await fail([line(1001,1101,[3000,3010,99999])],'OPTION_INVALID');
 await fail([line(1001,1101,[3000,3000,3010])],'OPTION_SELECTION_INVALID');
 await fail([line(1001,1101,[])],'OPTION_REQUIRED');await fail([line(1001,1101,[3000])],'OPTION_REQUIRED');
 await fail([line(1001,1101,[3000,3001,3010])],'OPTION_SELECTION_INVALID');
 await fail([line(1007,1111,[3050])],'OPTION_SELECTION_INVALID');await fail([line(1007,1111,[3050,3051,3052])],'OPTION_SELECTION_INVALID');
 await fail([line(1001,1102,[3000,3011])],'OPTION_SELECTION_INVALID');
 for(const sql of [
  `update option_choices set is_active=false where id='${id(3000)}'`,
  `update option_groups set is_active=false where id='${id(2000)}'`,
  `update product_option_groups set is_active=false where product_id='${id(1001)}' and option_group_id='${id(2000)}'`,
  `delete from product_option_groups where product_id='${id(1001)}' and option_group_id='${id(2000)}'`,
  `delete from product_option_defaults where product_id='${id(1001)}'`,
  `delete from product_size_option_choice_compatibility where product_id='${id(1001)}'`,
  `update product_sizes set price=price+1 where id='${id(1101)}'`,
  `update option_choices set label='Changed label' where id='${id(3000)}'`,
  `delete from configuration_private.product_pricing_certifications where product_id='${id(1001)}'`
 ])await change(sql,[drink],'CONFIGURATION_INVALID');
 await change(`delete from product_option_choice_price_overrides where product_id='${id(1002)}'`,[line(1002,1104,[3001])],'CONFIGURATION_INVALID');
 await change(`delete from product_option_choice_price_overrides where product_id='${id(1005)}' and product_size_id='${id(1107)}'`,[line(1005,1107,[3031])],'CONFIGURATION_INVALID');
 await scoped(async()=>{
  await db.exec(`update option_choices set is_active=false where id='${id(3020)}'`);await certify(db,1001);await fail([line(1001,1101,[3000,3010,3020])],'OPTION_INVALID');
 });
 await scoped(async()=>{
  await db.exec(`insert into product_option_choice_price_overrides(product_id,product_size_id,option_choice_id,price_delta) values('${id(1002)}','${id(1104)}','${id(3001)}',7.25)`);await certify(db,1002);
  equal((await price([line(1002,1104,[3001])])).subtotal,'107.25','size override precedes required product inclusion');
 });
 await scoped(async()=>{
  await db.exec(`insert into product_option_choice_override_requirements(product_id,option_choice_id,specificity) values('${id(1001)}','${id(3024)}','product');insert into product_option_choice_price_overrides(product_id,option_choice_id,price_delta) values('${id(1001)}','${id(3024)}',0)`);await certify(db,1001);
  equal((await price([line(1001,1101,[3000,3010,3024])])).subtotal,'100.00','Curvccino inclusion explicit contextual zero');
 });
 // Bypass certification writer only in corruption fixtures to prove runtime
 // checks do not blindly trust an owner-written matching JSON document.
 const refreshUnchecked=p=>q('update configuration_private.product_pricing_certifications set expected_structure=configuration_private.catalog_structure($1) where product_id=$1',[id(p)]);
 await scoped(async()=>{
  await db.exec(`drop index d0a1_override_product_choice;insert into product_option_choice_price_overrides(product_id,option_choice_id,price_delta) values('${id(1002)}','${id(3001)}',9)`);await refreshUnchecked(1002);
  await fail([line(1002,1104,[3001])],'CONFIGURATION_INVALID');
 });
 await scoped(async()=>{
  await db.exec(`delete from product_option_choice_price_overrides where product_id='${id(1002)}'`);await refreshUnchecked(1002);await fail([line(1002,1104,[3001])],'CONFIGURATION_INVALID');
 });
 await scoped(async()=>{
  await db.exec(`drop index d0a1_override_size_choice;insert into product_option_choice_price_overrides(product_id,product_size_id,option_choice_id,price_delta) values('${id(1005)}','${id(1107)}','${id(3031)}',9)`);await refreshUnchecked(1005);await fail([line(1005,1107,[3031])],'CONFIGURATION_INVALID');
 });
 await scoped(async()=>{
  await db.exec(`delete from product_option_defaults where product_id='${id(1001)}'`);await refreshUnchecked(1001);await fail([drink],'CONFIGURATION_INVALID');
 });
 await scoped(async()=>{
  await db.exec(`alter table product_sizes drop constraint product_sizes_price_nonnegative;update product_sizes set price=-1 where id='${id(1100)}'`);await refreshUnchecked(1000);await fail([line()],'CONFIGURATION_INVALID');
 });
 for(const value of [-1,0.001,1000000])await scoped(async()=>{
  await db.exec(`alter table product_option_choice_price_overrides drop constraint product_option_choice_price_overrides_price_delta_check;update product_option_choice_price_overrides set price_delta=${value} where product_id='${id(1002)}'`);await refreshUnchecked(1002);await fail([line(1002,1104,[3001])],'CONFIGURATION_INVALID');
 });
 for(const value of ['0.001','1000000',"'NaN'","'Infinity'"]){
  await scoped(async()=>{await db.exec(`update product_sizes set price=${value} where id='${id(1100)}'`);await refreshUnchecked(1000);await fail([line()],'CONFIGURATION_INVALID');});
  await scoped(async()=>{await db.exec(`update option_choices set price_delta=${value} where id='${id(3020)}'`);await refreshUnchecked(1001);await fail([line(1001,1101,[3000,3010,3020])],'CONFIGURATION_INVALID');});
 }
 await fail([line(1000,1100,[],2147483647)],'QUANTITY_INVALID');
 await scoped(async()=>{await db.exec(`update product_sizes set price=999999.99 where id='${id(1100)}'`);await certify(db,1000);
  equal((await price([line(1000,1100,[],100)])).subtotal,'99999999.00','existing NUMERIC(10,2) safe range');
  await fail([line(1000,1100,[],101)],'QUANTITY_INVALID');await fail([line(1000,1100,[],60,'A'),line(1000,1100,[],60,'B')],'QUANTITY_INVALID');
 });
 equal(await state(),before,'pricing makes no order/item/customer changes');
 await scoped(async()=>{
  await db.exec(`update products set notes='private recipe' where id='${id(1000)}';update product_sizes set cost=8.88 where id='${id(1100)}'`);await certify(db,1000);
  const output=JSON.stringify(await price([line()]));ok(!output.includes('private recipe')&&!output.includes('8.88')&&!output.includes('expected_structure'),'private catalog fields never enter pricing projection');
 });
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  for(const sql of ['select configuration_private.price_order_configuration(\'[]\'::jsonb)','select * from public.product_option_choice_price_overrides','select * from public.product_option_choice_override_requirements','select * from configuration_private.product_pricing_certifications']){await assert.rejects(()=>q(sql),e=>e.code==='42501');n++;}
  await db.exec('reset role');
 }
 const meta=(await q("select provolatile,prosecdef,proconfig from pg_proc where oid='configuration_private.price_order_configuration(jsonb)'::regprocedure"))[0];
 equal(meta.provolatile,'s','STABLE snapshot semantics');ok(!meta.prosecdef&&meta.proconfig.includes('search_path=pg_catalog'),'invoker and pinned search path');
 equal((await price([line(1000,1100,[],2,'Additional units')])).subtotal,'20.20','standalone amendment addition needs no checkout fields');
 await assert.rejects(()=>db.exec(readSql(engine)),e=>e.detail==='D0B3_COLLISION');n++;await db.exec('rollback');equal(await price([line()]),simple,'reapplication abort leaves engine intact');
 const pos=await rpc('pos_create_order',{p_key:id(9001),p_size:id(40),p_choices:[id(60)],p_quantity:1,p_customer:'Counter',p_type:'dine_in',p_note:'',p_item_note:''});ok(!pos.error,'POS still works with private engine installed');
 console.log(n+' D0B3 pricing-engine assertions passed (offline PGlite).');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
