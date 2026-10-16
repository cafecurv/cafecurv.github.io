// DISPOSABLE LOCAL DATABASE ONLY. Do not run without permission to execute local test SQL.
const assert=require('node:assert/strict');
const {fixture,id,readSql}=require('./menu-manager-product-save-fixture.cjs');
const {reviewed,submit,payload}=require('./public-submission-v2-fixture.cjs');
(async()=>{const {db}=await fixture();let count=0;
 const q=async(s,p=[])=>(await db.query(s,p)).rows;
 const check=(v,m)=>{assert.ok(v,m);count++;};
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);count++;};
 const rejects=async(fn,detail)=>{let e;try{await fn();}catch(x){e=x;}check(e,'must reject');if(detail)eq(e.detail,detail);};
 const snapshot=async()=>q('select id,configuration_private.catalog_structure(id) s from products order by id');
 const mutate=async(p,sql,args=[])=>{await db.exec('begin');try{
   await q('insert into menu_save_private.active_save values(pg_backend_pid(),txid_current(),$1)',[id(p)]);
   await q(sql,args);await q('delete from menu_save_private.active_save where backend=pg_backend_pid() and transaction_id=txid_current()');await db.exec('commit');
 }catch(e){await db.exec('rollback');throw e;}};
 const certify=p=>q("select configuration_private.certify_product($1,configuration_private.catalog_structure($1),'Disposable test only')",[id(p)]);
 const price=async(p,s,c)=>(await q('select configuration_private.choice_delta($1,$2,$3) p',[id(p),id(s),id(c)]))[0].p;
 try{
  // The older fixture uses the initial view. Install the reviewed archive-aware
  // production baseline locally; never weaken the migration's drift guard.
  await db.exec('create or replace view public.public_menu_option_choices with (security_invoker=true) as '+readSql('MENU_MANAGER_OPTION_POLICIES_PHASE3A.sql').split('$reviewed_view$')[1]);
  const before=await snapshot();
  const certs=await q('select * from configuration_private.product_pricing_certifications order by product_id');
  await db.exec(readSql('MENU_MANAGER_OPTION_POLICIES_PHASE3A.sql'));
  eq(await snapshot(),before,'all fixture structures unchanged');eq(await q('select * from configuration_private.product_pricing_certifications order by product_id'),certs,'certificates unchanged');
  eq(Number(await price(1001,1101,3001)),25,'shared fallback');
  eq(Number(await price(1002,1104,3001)),0,'existing product override');
  for(const [s,p] of [[1107,30],[1108,60],[1109,90]])eq(Number(await price(1005,s,3031)),p,'contextual size price');
  const sizeQuote=(await q('select public.quote_public_cart($1) result',[JSON.stringify({pricing_contract_version:2,items:[{product_id:id(1005),product_size_id:id(1108),option_choice_ids:[id(3031)],quantity:1,item_note:null}]})]))[0].result;
  check(sizeQuote.ok,'contextual effective quote succeeds');eq(sizeQuote.quote.items[0].unit_price,'240.00','size charge wins in quote');
  const enabled=await q('select * from public.get_public_effective_option_choices() where product_id=$1 and option_choice_id=$2',[id(1002),id(3001)]);
  eq(Number(enabled[0].price_delta),0,'public effective product price');eq(enabled[0].price_by_size[id(1104)],0,'public size price agrees');
  // Privileged fixture setup for a FUTURE atomic writer; no new browser write API.
  await db.exec('alter table product_option_choice_price_overrides disable trigger mm_phase1_save_guard');
  await q('insert into product_option_choice_price_overrides(product_id,option_choice_id,price_delta) values($1,$2,20)',[id(1001),id(3001)]);
  await db.exec('alter table product_option_choice_price_overrides enable trigger mm_phase1_save_guard');
  await certify(1001);
  eq(Number(await price(1001,1101,3001)),20,'new product-specific charge replaces shared 25');
  eq(Number(await price(1002,1104,3001)),0,'other product price unchanged');
  const quote=(await q('select public.quote_public_cart($1) result',[JSON.stringify({pricing_contract_version:2,items:[{product_id:id(1001),product_size_id:id(1101),option_choice_ids:[id(3001),id(3010)],quantity:1,item_note:null}]})]))[0].result;
  check(quote.ok,'effective price quote succeeds');eq(quote.quote.items[0].unit_price,'120.00','quote uses effective product charge');
  eq(Number((await q('select price_delta from public.get_public_effective_option_choices() where product_id=$1 and option_choice_id=$2',[id(1001),id(3001)]))[0].price_delta),20,'public and quote agree');
  // Remove test override before disabling the choice: dependent rows must not survive.
  await db.exec('alter table product_option_choice_price_overrides disable trigger mm_phase1_save_guard');
  await q('delete from product_option_choice_price_overrides where product_id=$1 and option_choice_id=$2',[id(1001),id(3001)]);
  await db.exec('alter table product_option_choice_price_overrides enable trigger mm_phase1_save_guard');await certify(1001);
  await mutate(1001,'insert into public.product_option_choice_policies values($1,$2,$3,false)',[id(1001),id(2000),id(3001)]);
  check(JSON.stringify(await snapshot())!==JSON.stringify(before),'policy invalidates snapshot');
  await rejects(()=>q('select configuration_private.assert_pricing_ready($1)',[id(1001)]),'D0B1_CERTIFICATION_STALE');
  eq((await q('select * from public.get_public_effective_option_choices() where product_id=$1 and option_choice_id=$2',[id(1001),id(3001)])).length,0,'disabled choice absent publicly');
  eq((await q('select * from public.get_public_effective_option_choices() where product_id=$1 and option_choice_id=$2',[id(1002),id(3001)])).length,1,'other product unaffected');
  await certify(1001);
  await rejects(()=>price(1001,1101,3001),'D0A1_INVALID_CONFIGURATION');
  await rejects(()=>q('select configuration_private.price_order_configuration($1)',[JSON.stringify([{product_id:id(1001),product_size_id:id(1101),option_choice_ids:[id(3001),id(3010)],quantity:1,item_note:null}])]),'OPTION_INVALID');
  const intact=await snapshot();
  await db.exec('begin');
  await q('insert into menu_save_private.active_save values(pg_backend_pid(),txid_current(),$1)',[id(1001)]);
  await q("update products set name='Must roll back' where id=$1",[id(1001)]);
  await q('insert into product_option_choice_policies values($1,$2,$3,false)',[id(1001),id(2000),id(3000)]);
  await rejects(()=>certify(1001),'D0B1_DEFAULT_COVERAGE');await db.exec('rollback');
  eq(await snapshot(),intact,'invalid default rolls back policy and structure');
  eq((await q('select name from products where id=$1',[id(1001)]))[0].name,'Configurable drink','product change rolled back');
  const order=await submit(db,await reviewed(db,payload(9921)));check(!!order.order_number,'v2 submission after model installation');
  await mutate(1001,'insert into public.product_option_choice_policies values($1,$2,$3,false)',[id(1001),id(2000),id(3000)]);
  await rejects(()=>certify(1001),'D0B1_DEFAULT_COVERAGE');
  for(const role of ['anon','authenticated']){
   check(!(await q("select has_table_privilege($1,'public.product_option_choice_policies','INSERT,UPDATE,DELETE') allowed",[role]))[0].allowed,'no API policy writes');
   for(const fn of ['choice_policy_structure(uuid)','effective_choice_price(uuid,uuid,uuid)','effective_product_choices(uuid)'])check(!(await q('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,'configuration_private.'+fn]))[0].allowed,'private helper denied');
   await db.exec('set role '+role);await rejects(()=>q('select * from public.product_option_choice_policies'));await db.exec('reset role');
  }
  await rejects(()=>db.exec(readSql('MENU_MANAGER_OPTION_POLICIES_PHASE3A.sql')),'MM_3A_COLLISION');await db.exec('rollback');
  console.log('Phase 3A database: '+count+' assertions passed');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message,e.detail||'');process.exitCode=1;});
