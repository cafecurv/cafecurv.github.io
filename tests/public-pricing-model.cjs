// Offline model acceptance against real PostgreSQL semantics in PGlite.
// No claim of simultaneous transaction testing; no public pricing engine yet.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {configurationFixture}=require('./public-configuration-fixture.cjs');
const sql=name=>fs.readFileSync(path.join(__dirname,'../admin',name),'utf8').replace(/^\uFEFF/,'');
(async()=>{const {db,id,rpc}=await configurationFixture({applyPos:true});let n=0;
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const ok=(v,m)=>{assert.ok(v,m);n++;};
const bad=async(s,code,p=[])=>{await assert.rejects(()=>db.query(s,p),e=>e.detail===code||e.code===code);n++;};
const structure=async(p=30)=>(await q('select configuration_private.catalog_structure($1) s',[id(p)]))[0].s;
const certify=async(p=30,expected=undefined)=>q('select configuration_private.certify_product($1,$2::jsonb,$3)',[id(p),JSON.stringify(expected??await structure(p)),'Reviewed test fixture expected manifest']);
const ready=async(p=30)=>q('select configuration_private.assert_pricing_ready($1)',[id(p)]);
const coverage=async(code,p=30)=>bad('select configuration_private.validate_product_coverage($1)',code,[id(p)]);
const draft=sql('WEBSITE_PRICING_D0B1_SCHEMA.sql');
const rpcBaseline=()=>q("select oid,pg_get_functiondef(oid) definition,proowner,prosecdef,proconfig,proacl from pg_proc where oid in ('submit_public_order(jsonb)'::regprocedure,'get_public_order_tracking(uuid)'::regprocedure)");
const submit=async p=>{await db.exec('set role anon');try{return(await q('select submit_public_order($1::jsonb) r',[JSON.stringify(p)]))[0].r;}finally{await db.exec('reset role');}};
try{
 await db.exec(sql('CUSTOMER_PHASE_C1B_SCHEMA.sql'));await db.exec(sql('CUSTOMER_PHASE_C1B_BACKEND.sql'));
 await db.exec(sql('WEBSITE_DINE_IN_TIMING_SCHEMA.sql'));await db.exec(sql('WEBSITE_DINE_IN_TIMING_BACKEND.sql'));
 const p={submission_key:id(900),customer_name:'Legacy ASAP',customer_phone:'',fulfillment_type:'dine_in',preparation_timing:'asap',payment_method:'counter',subtotal:160,total:160,items:[{product_name:'Saved name',quantity:1,unit_price:160,line_total:160,options:{milk:'Oat'}}]};
 const result=await submit(p),before=await q('select * from orders'),itemsBefore=await q('select * from order_items'),rpcBefore=await rpcBaseline();
 // Collision and missing prerequisite must fail before partial DDL.
 const migrationFail=async(code)=>{await assert.rejects(()=>db.exec(draft),e=>e.detail===code);n++;await db.exec('rollback');ok((await q("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='orders' and column_name='priced_at'"))[0].n===0,'no partial metadata DDL');};
 await db.exec('alter table orders add column pricing_contract_version text');await migrationFail('D0B1_COLLISION');await db.exec('alter table orders drop column pricing_contract_version');
 await db.exec('alter table orders rename column preparation_timing to temporarily_missing_timing');await migrationFail('D0B1_PREREQUISITE');await db.exec('alter table orders rename column temporarily_missing_timing to preparation_timing');
 await db.exec(draft);
 assert.deepEqual(await rpcBaseline(),rpcBefore);n++;
 const after=await q('select * from orders'),newFields=['pricing_contract_version','pricing_policy_version','pricing_fingerprint_version','accepted_review_fingerprint','priced_at','submission_fingerprint_version'];
 for(const r of after)for(const f of newFields){ok(r[f]===null,'legacy '+f+' NULL');delete r[f];}assert.deepEqual(after,before);n++;
 const afterItems=await q('select * from order_items');for(const r of afterItems){ok(r.pricing_configuration_snapshot===null,'legacy snapshot NULL');delete r.pricing_configuration_snapshot;}assert.deepEqual(afterItems,itemsBefore);n++;
 assert.deepEqual(await submit(p),result);n++;
 const pos=await rpc('pos_create_order',{p_key:id(950),p_size:id(40),p_choices:[id(60)],p_quantity:1,p_customer:'Counter',p_type:'dine_in',p_note:'',p_item_note:''});
 ok(!pos.error&&pos.data.id,'actual POS insertion after D0B1 remains valid');
 const second=await submit({...p,submission_key:id(901),customer_name:'New current-contract ASAP'});
 ok(!!second.order_number,'current submission still operates after model migration');
 ok((await q('select customer_id,preparation_timing from orders where order_number=$1',[second.order_number]))[0].customer_id===null,'phone-less dine-in never creates fake customer');
 await db.exec(`update products set is_published=true where id='${id(30)}';insert into products(id,category_id,name,is_published) values('${id(31)}','${id(20)}','Intentional no-options sushi',true);insert into product_sizes(id,product_id,label,price) values('${id(41)}','${id(31)}','Each',190)`);
 await bad('select configuration_private.assert_pricing_ready($1)','D0B1_CERTIFICATION_STALE',[id(31)]);
 await certify(31);await ready(31);ok(true,'explicitly reviewed zero-group product');
 await certify();await ready();ok(true,'fully configured product');
 for(const change of [
  `delete from product_option_groups where product_id='${id(30)}'`,
  `insert into option_choices(option_group_id,label,value) values('${id(50)}','Unreviewed milk','new')`,
  `update product_option_groups set is_required=false,min_selections=0 where product_id='${id(30)}'`
 ]){
  await db.exec('begin');await db.exec(change);await bad('select configuration_private.assert_pricing_ready($1)','D0B1_CERTIFICATION_STALE',[id(30)]);await db.exec('rollback');
 }
 const original=await structure();
 for(const field of ['assignments','defaults','choices','sizes']){
  await bad('select configuration_private.certify_product($1,$2::jsonb,$3)','D0B1_CERTIFICATION_MISMATCH',[id(30),JSON.stringify({...original,[field]:[]}),'Incorrect reviewed fixture']);
 }
 await db.exec(`delete from product_option_defaults where product_id='${id(30)}'`);await coverage('D0B1_DEFAULT_COVERAGE');await bad('select configuration_private.assert_pricing_ready($1)','D0B1_CERTIFICATION_STALE',[id(30)]);
 await db.exec(`insert into product_option_defaults(product_id,option_group_id,option_choice_id) values('${id(30)}','${id(50)}','${id(60)}')`);await certify();
 await db.exec(`update product_option_groups set is_active=false where product_id='${id(30)}'`);await coverage('D0B1_DEFAULT_COVERAGE');await bad('select configuration_private.assert_pricing_ready($1)','D0B1_CERTIFICATION_STALE',[id(30)]);await db.exec('update product_option_groups set is_active=true');await certify();
 await db.exec('update option_choices set is_active=false');await coverage('D0B1_GROUP_COVERAGE');await db.exec('update option_choices set is_active=true');
 const requirement=(size=null)=>`insert into product_option_choice_override_requirements(product_id,product_size_id,option_choice_id,specificity) values('${id(30)}',${size?"'"+id(size)+"'":'null'},'${id(60)}','${size?'size':'product'}')`;
 const override=(size=null,price=0)=>`insert into product_option_choice_price_overrides(product_id,product_size_id,option_choice_id,price_delta) values('${id(30)}',${size?"'"+id(size)+"'":'null'},'${id(60)}',${price})`;
 const delta=async()=>(await q('select configuration_private.choice_delta($1,$2,$3) d',[id(30),id(40),id(60)]))[0].d;
 ok(Number(await delta())===25,'ordinary option safely uses base delta');
 await db.exec(requirement());await coverage('D0B1_OVERRIDE_COVERAGE');await bad('select configuration_private.choice_delta($1,$2,$3)','D0A1_REQUIRED_OVERRIDE_MISSING',[id(30),id(40),id(60)]);
 await db.exec(override());await certify();await ready();ok(Number(await delta())===0,'required product inclusion present');
 await db.exec(requirement(40));await coverage('D0B1_OVERRIDE_COVERAGE');await bad('select configuration_private.choice_delta($1,$2,$3)','D0A1_REQUIRED_OVERRIDE_MISSING',[id(30),id(40),id(60)]);
 await db.exec(override(40,30));await certify();await ready();ok(Number(await delta())===30,'required size override precedes product');
 for(const change of ['delete from product_option_choice_override_requirements','delete from product_option_choice_price_overrides']){
  await db.exec('begin');await db.exec(change);await bad('select configuration_private.assert_pricing_ready($1)','D0B1_CERTIFICATION_STALE',[id(30)]);await db.exec('rollback');
 }
 await bad(requirement(),'23505');await bad(requirement(40),'23505');await bad(override(40,40),'23505');await bad(override(null,40),'23505');
 await bad(requirement(41),'23503');
 await db.exec(`update product_option_choice_override_requirements set is_active=false where product_size_id is not null`);await bad('select configuration_private.assert_pricing_ready($1)','D0B1_CERTIFICATION_STALE',[id(30)]);
 await db.exec('update product_option_choice_override_requirements set is_active=true');await certify();
 await db.exec('update product_sizes set price=price+1');await bad('select configuration_private.assert_pricing_ready($1)','D0B1_CERTIFICATION_STALE',[id(30)]);await certify();await certify(31);
 // Separate temperature identities and distinct catalog size rows; no label inference.
 await db.exec(`insert into option_groups(id,name,group_key,selection_type) values('${id(51)}','Temperature','temperature','single');
 insert into option_choices(id,option_group_id,label,value) values('${id(61)}','${id(51)}','HOT','hot'),('${id(62)}','${id(51)}','ICED','iced');
 insert into product_option_groups(product_id,option_group_id,is_required,min_selections,max_selections) values('${id(30)}','${id(51)}',true,1,1);
 insert into product_option_defaults(product_id,option_group_id,option_choice_id) values('${id(30)}','${id(51)}','${id(62)}');
 insert into product_sizes(id,product_id,label,price) values('${id(42)}','${id(30)}','HOT 12oz',150),('${id(43)}','${id(30)}','Large',190)`);
 await coverage('D0B1_TEMPERATURE_COVERAGE');
 for(const [s,c] of [[42,61],[40,62],[43,62]])await db.exec(`insert into product_size_option_choice_compatibility values('${id(30)}','${id(s)}','${id(c)}',true)`);
 await certify();await ready();ok(true,'all sizes have explicit temperature coverage');
 for(const [s,c] of [[42,61],[40,62],[43,62]])ok(Number((await q('select configuration_private.choice_delta($1,$2,$3) d',[id(30),id(s),id(c)]))[0].d)===0,'valid temperature tuple '+s);
 await bad('select configuration_private.choice_delta($1,$2,$3)','D0A1_INVALID_CONFIGURATION',[id(30),id(43),id(61)]);
 await ready(31);ok(true,'non-temperature product unaffected');
 await db.exec(`delete from product_size_option_choice_compatibility where product_size_id='${id(42)}'`);await coverage('D0B1_TEMPERATURE_COVERAGE');await bad('select configuration_private.assert_pricing_ready($1)','D0B1_CERTIFICATION_STALE',[id(30)]);
 await db.exec(`insert into product_size_option_choice_compatibility values('${id(30)}','${id(42)}','${id(61)}',true)`);await certify();
 for(const condition of ['is_available=false','is_published=false','is_sold_out=true','archived_at=now()']){
  await db.exec(`update products set ${condition} where id='${id(30)}'`);await bad('select configuration_private.assert_pricing_ready($1)','D0B1_PRODUCT_UNAVAILABLE',[id(30)]);
  await db.exec('set role anon');ok((await q('select * from get_public_configuration_compatibility()')).length===0,'hidden '+condition);await db.exec('reset role');
  await db.exec(`update products set is_available=true,is_published=true,is_sold_out=false,archived_at=null where id='${id(30)}'`);
 }
 const snapshot={contract_version:2,pricing_policy_version:'curv-cart-v2.1',product_id:id(30),product_size_id:id(40),option_choice_ids:[id(60)],options:[{group_id:id(50),choice_id:id(60),group_name:'Milk',label:'Oat',effective_price_delta:30}]};
 const item=itemsBefore[0].id;
 await q('update order_items set pricing_configuration_snapshot=$1 where id=$2',[JSON.stringify(snapshot),item]);
 ok((await q('select options from order_items where id=$1',[item]))[0].options.milk==='Oat','readable options unchanged');
 for(const invalid of [{}, {...snapshot,product_id:'wrong'}, {...snapshot,options:[]}, {...snapshot,option_choice_ids:[id(60),id(60)]}, {...snapshot,options:[{...snapshot.options[0],effective_price_delta:-1}]}, {...snapshot,pricing_policy_version:''}])await bad('update order_items set pricing_configuration_snapshot=$1 where id=$2','D0B1_SNAPSHOT_INVALID',[JSON.stringify(invalid),item]);
 await db.exec(`update option_choices set label='Changed later',price_delta=99 where id='${id(60)}'`);
 assert.deepEqual((await q('select pricing_configuration_snapshot s from order_items where id=$1',[item]))[0].s,snapshot);n++;
 await db.exec('begin');
 const deletedCatalogSnapshot={...snapshot,product_id:id(31),product_size_id:id(41),option_choice_ids:[],options:[]};
 await q('update order_items set pricing_configuration_snapshot=$1 where id=$2',[JSON.stringify(deletedCatalogSnapshot),item]);
 await db.exec(`delete from configuration_private.product_pricing_certifications where product_id='${id(31)}';delete from product_sizes where product_id='${id(31)}';delete from products where id='${id(31)}'`);
 assert.deepEqual((await q('select pricing_configuration_snapshot s from order_items where id=$1',[item]))[0].s,deletedCatalogSnapshot);n++;await db.exec('rollback');
 await bad('update orders set pricing_contract_version=2 where id=$1','23514',[before[0].id]);
 await q("update orders set pricing_contract_version=2,pricing_policy_version='curv-cart-v2.1',pricing_fingerprint_version=1,accepted_review_fingerprint=repeat('a',64),priced_at=now(),submission_fingerprint_version=2 where id=$1",[before[0].id]);ok(true,'complete future metadata accepted without activating v2');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  for(const t of ['public.product_option_choice_override_requirements','public.product_option_choice_price_overrides','public.product_size_option_choice_compatibility','configuration_private.product_pricing_certifications'])await bad('select * from '+t,'42501');
  await bad('select configuration_private.assert_pricing_ready($1)','42501',[id(30)]);
  const projection=await q('select * from get_public_configuration_compatibility()');ok(projection.length===3&&Object.keys(projection[0]).sort().join() === 'is_active,option_choice_id,product_id,product_size_id','safe ID projection '+role);
  await db.exec('reset role');
 }
 const preserved=await q('select * from orders');await assert.rejects(()=>db.exec(draft),e=>e.detail==='D0B1_COLLISION');n++;await db.exec('rollback');assert.deepEqual(await q('select * from orders'),preserved);n++;
 ok((await q("select count(*)::int n from pg_constraint where conrelid='order_items'::regclass and contype='f' and pg_get_constraintdef(oid) like '%pricing_configuration_snapshot%'"))[0].n===0,'snapshot has no catalog FK');
 console.log(n+' D0B1 local pricing-model assertions passed');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
