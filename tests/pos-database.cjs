// Actual PostgreSQL execution in an in-memory WASM database. No network, files,
// Supabase instance, or test-only permissive is_admin helper is used.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const root=path.resolve(__dirname,'..');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function fixture({applyPos=true}={}) {
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  for(const file of ['MENU_MANAGER_PHASE1_SCHEMA.sql','MENU_MANAGER_PHASE1S_B_ACCESS.sql',
    'MENU_MANAGER_PHASE1_VARIANTS_ALTER.sql','OPTION_GROUPS_PHASE_A_SCHEMA.sql','CATEGORY_SECTIONS_PHASE_S1_SCHEMA.sql',
    'INCOMING_ORDERS_PHASE_A_SCHEMA.sql','INCOMING_ORDERS_PHASE_D1_DELIVERY_SUPPORT.sql','INCOMING_ORDERS_PHASE_O7B_TRACKING_RPC.sql',
    'INCOMING_ORDERS_PHASE_O9B_CANCEL_REQUEST_RPC.sql','INCOMING_ORDERS_PHASE_O12A_WEBSITE_ORDERING_STATUS.sql',
    'INCOMING_ORDERS_PHASE_O14_DINE_IN.sql','TIMEKEEPING_PHASE_T1_BACKEND.sql']) {
    try { await db.exec(fs.readFileSync(path.join(root,'admin',file),'utf8').replace(/^\uFEFF/,'')); }
    catch(e){ e.message=file+': '+e.message; throw e; }
  }
  // Minimal late catalog-column baseline; not a replacement migration chain.
  await db.exec(`alter table public.products add column is_sold_out boolean not null default false,
    add column archived_at timestamptz;
    insert into auth.users values ('${id(1)}'),('${id(2)}'),('${id(3)}');
    insert into admin_profiles(id,full_name) values('${id(1)}','Fixture Owner');
    insert into staff(id,name,pin_hash,created_by) values('${id(10)}','Fixture Cashier','not-a-production-pin','${id(1)}');
    insert into categories(id,name) values('${id(20)}','Fixture Drinks');
    insert into products(id,category_id,name,is_published) values('${id(30)}','${id(20)}','Fixture Latte',false);
    insert into product_sizes(id,product_id,label,price) values('${id(40)}','${id(30)}','Regular',160);
    insert into option_groups(id,name,group_key,selection_type) values('${id(50)}','Milk','milk','single');
    insert into option_choices(id,option_group_id,label,value,price_delta) values('${id(60)}','${id(50)}','Oat','oat',25);
    insert into product_option_groups(product_id,option_group_id,is_required,min_selections,max_selections)
      values('${id(30)}','${id(50)}',true,1,1);
    insert into product_option_defaults(product_id,option_group_id,option_choice_id) values('${id(30)}','${id(50)}','${id(60)}');`);
  if(applyPos) {
    for(const name of ['POS_PHASE_P1A_SCHEMA.sql','POS_PHASE_P1A_BACKEND.sql'])await db.exec(fs.readFileSync(path.join(root,'admin',name),'utf8'));
    await db.exec(`insert into pos_staff_access(user_id,staff_id,created_by) values('${id(2)}','${id(10)}','${id(1)}');`);
  }
  let user=id(2);
  const rpcImpl=async(name,args={})=>{
    assert.match(name,/^pos_[a-z_]+$/);
    const entries=Object.entries(args);entries.forEach(([k])=>assert.match(k,/^p_[a-z_]+$/));
    try {
      await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[user||'']);
      await db.exec('set role authenticated');
      const {rows}=await db.query(`select public.${name}(${entries.map(([k],i)=>k+' => $'+(i+1)).join(',')}) as data`,entries.map(([,v])=>v));
      return {data:rows[0].data,error:null};
    } catch(e){return {data:null,error:{code:e.code,details:e.detail,message:e.message}};}
    finally{await db.exec('reset role');}
  };
  let queue=Promise.resolve();
  const rpc=(...args)=>{const next=queue.then(()=>rpcImpl(...args));queue=next.catch(()=>{});return next;};
  return {db,rpc,setUser:u=>{user=u;},id};
}
async function run() {
  const f=await fixture();const {db,rpc}=f;let checks=0;
  const ok=(v,label)=>{assert.ok(v,label);checks++;};
  const call=async(n,a)=>{const r=await rpc(n,a);assert.equal(r.error,null,JSON.stringify(r.error));return r.data;};
  const fail=async(n,a,code)=>{const r=await rpc(n,a);assert.equal(r.error?.details,code);checks++;};
  // Include complete headers, all item snapshots and command history so failed
  // operations cannot hide a revision/timestamp/source change or partial write.
  const state=async()=> (await db.query(`select
    (select jsonb_agg(to_jsonb(o) order by id) from orders o) as orders,
    (select jsonb_agg(to_jsonb(i) order by id) from order_items i) as items,
    (select jsonb_agg(to_jsonb(c) order by command_key) from pos_private.commands c) as commands`)).rows[0];
  const unchanged=async(before,label)=>{assert.deepEqual(await state(),before,label);checks++;};
  const line={p_size:id(40),p_choices:[id(60)],p_quantity:2,p_item_note:'No ice'};
  try {
    ok((await call('pos_get_access')).staff_id===id(10),'server staff identity');
    const cat=await call('pos_get_catalog');ok(cat.products.length===1,'unpublished counter product visible');
    ok(!JSON.stringify(cat).includes('pin_hash')&&!JSON.stringify(cat).includes('cost'),'safe catalog projection');
    const create={p_key:id(100),...line,p_customer:'Alice',p_type:'dine_in',p_note:'Counter'};
    let o=await call('pos_create_order',create);const orderId=o.id;
    ok(o.revision===1&&o.items.length===1&&Number(o.total)===370,'atomic first line and DB option pricing');
    ok(o.items[0].item_note==='No ice','note saved');
    const replay=await call('pos_create_order',create);ok(replay.id===o.id,'creation replay');
    await fail('pos_create_order',{...create,p_quantity:3},'POS_KEY_CONFLICT');
    const add={p_key:id(101),p_order_id:o.id,p_revision:o.revision,...line,p_quantity:1};
    o=await call('pos_add_item',add);await call('pos_add_item',add);
    ok((await call('pos_get_order',{p_order_id:o.id})).items.length===2,'add replay does not duplicate');
    await fail('pos_add_item',{...add,p_key:id(102)},'POS_REVISION_CONFLICT');
    await db.exec(`update product_sizes set price=170 where id='${id(40)}'; update option_choices set price_delta=30 where id='${id(60)}';`);
    o=await call('pos_update_item',{p_key:id(103),p_order_id:o.id,p_revision:o.revision,p_item_id:o.items[0].id,p_quantity:3,p_item_note:'Less sweet'});
    ok(Number(o.items[0].unit_price)===185&&o.items[0].quantity===3,'quantity edit preserves saved price');
    o=await call('pos_configure_item',{p_key:id(104),p_order_id:o.id,p_revision:o.revision,p_item_id:o.items[0].id,...line,p_quantity:1});
    ok(Number(o.items[0].unit_price)===200,'explicit configuration uses current prices');
    await fail('pos_add_item',{p_key:id(105),p_order_id:o.id,p_revision:o.revision,...line,p_choices:[]},'POS_OPTIONS_INVALID');
    await fail('pos_add_item',{p_key:id(106),p_order_id:o.id,p_revision:o.revision,...line,p_choices:[id(60),id(60)]},'POS_OPTIONS_INVALID');
    await db.exec(`update products set is_sold_out=true where id='${id(30)}';`);
    ok((await call('pos_get_catalog')).products[0].is_sold_out,'sold out visible');
    await fail('pos_add_item',{p_key:id(107),p_order_id:o.id,p_revision:o.revision,...line},'POS_NOT_SELLABLE');
    await db.exec(`update products set is_sold_out=false,is_available=false where id='${id(30)}';`);
    ok((await call('pos_get_catalog')).products.length===0,'unavailable hidden');
    await fail('pos_create_order',{...create,p_key:id(108)},'POS_NOT_SELLABLE');
    await db.exec(`update products set is_available=true where id='${id(30)}';`);
    o=await call('pos_update_header',{p_key:id(109),p_order_id:o.id,p_revision:o.revision,p_customer:'Bob',p_type:'delivery',p_note:'Call at counter'});
    ok(o.fulfillment_type==='delivery'&&o.customer_name==='Bob','delivery header without web contact requirements');
    o=await call('pos_hold_order',{p_key:id(110),p_order_id:o.id,p_revision:o.revision});ok(o.status==='held'&&o.held_at,'hold');
    const heldState=await state();
    await fail('pos_hold_order',{p_key:id(120),p_order_id:o.id,p_revision:o.revision},'POS_STATE_INVALID');
    await unchanged(heldState,'holding HELD at current revision changes no state');
    await fail('pos_add_item',{p_key:id(111),p_order_id:o.id,p_revision:o.revision,...line},'POS_STATE_INVALID');
    ok((await call('pos_list_open_orders')).length===1,'held order listed');
    o=await call('pos_resume_order',{p_key:id(112),p_order_id:o.id,p_revision:o.revision});ok(o.status==='open'&&!o.held_at,'resume');
    const openState=await state();
    await fail('pos_resume_order',{p_key:id(121),p_order_id:o.id,p_revision:o.revision},'POS_STATE_INVALID');
    await unchanged(openState,'resuming OPEN at current revision changes no state');
    o=await call('pos_remove_item',{p_key:id(113),p_order_id:o.id,p_revision:o.revision,p_item_id:o.items[0].id});ok(o.items.length===1,'soft removal');
    ok((await db.query(`select count(*)::int n from order_items where order_id=$1`,[o.id])).rows[0].n===2,'removed snapshot retained');
    const reload=await call('pos_get_order',{p_order_id:orderId});ok(reload.revision===o.revision,'refetch persistence');
    f.setUser(id(3));await fail('pos_add_item',{p_key:id(114),p_order_id:o.id,p_revision:o.revision,...line},'POS_ACCESS_DENIED');
    f.setUser(null);await fail('pos_get_catalog',{},'POS_AUTH_REQUIRED');
    f.setUser(id(2));await db.exec(`update staff set is_active=false where id='${id(10)}';`);
    await fail('pos_create_order',create,'POS_ACCESS_DENIED');
    await db.exec(`update staff set is_active=true where id='${id(10)}';`);
    await db.exec(`update pos_staff_access set is_active=false where user_id='${id(2)}';`);
    ok((await db.query('select is_active from staff where id=$1',[id(10)])).rows[0].is_active===true,'staff stays active during mapping deactivation');
    const disabledState=await state();
    await fail('pos_get_access',{},'POS_ACCESS_DENIED');
    await fail('pos_get_catalog',{},'POS_ACCESS_DENIED');
    await fail('pos_get_order',{p_order_id:o.id},'POS_ACCESS_DENIED');
    await fail('pos_add_item',{p_key:id(122),p_order_id:o.id,p_revision:o.revision,...line},'POS_ACCESS_DENIED');
    await unchanged(disabledState,'inactive mapping blocks writes despite active staff');
    await db.exec(`update pos_staff_access set is_active=true where user_id='${id(2)}';`);
    // Existing owner direct table operations cannot bypass the POS command path.
    await db.exec(`select set_config('request.jwt.claim.sub','${id(1)}',false); set role authenticated;`);
    ok((await db.query(`select * from orders where source='pos'`)).rows.length===0,'owner raw POS read excluded');
    ok((await db.query(`update orders set payment_status='paid' where id=$1 returning id`,[o.id])).rows.length===0,'old paid toggle blocked');
    await db.exec('reset role');
    // Exercise real existing guest submission/tracking after P1A schema changes.
    const payload={submission_key:id(150),customer_name:'Website Guest',customer_phone:'09000000000',fulfillment_type:'dine_in',
      subtotal:160,total:160,items:[{product_name:'Web Latte',quantity:1,unit_price:160,line_total:160}]};
    await db.exec('set role anon');
    const web=(await db.query('select submit_public_order($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
    const webReplay=(await db.query('select submit_public_order($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
    ok(web.tracking_token&&web.order_number===webReplay.order_number,'website submit/replay still works');
    const tracked=(await db.query('select get_public_order_tracking($1::uuid) result',[web.tracking_token])).rows[0].result;
    ok(JSON.stringify(tracked).includes('Website Guest')||JSON.stringify(tracked).includes(web.order_number),'website tracking');
    const cancellation=(await db.query('select request_public_order_cancellation($1::uuid,$2) result',[web.tracking_token,'Changed plans'])).rows[0].result;
    ok(cancellation.ok,'website cancellation request');
    await db.exec('reset role');
    ok((await call('pos_list_open_orders')).length===1,'website order excluded from POS open list');
    const websiteRow=(await db.query('select * from orders where order_number=$1',[web.order_number])).rows[0];
    ok(websiteRow.source!=='pos'&&websiteRow.pos_revision===null,'normal website order has no POS revision');
    const websiteState=await state();
    await fail('pos_update_header',{p_key:id(123),p_order_id:websiteRow.id,p_revision:1,
      p_customer:'Attempted POS takeover',p_type:'pickup',p_note:'Must not save'},'POS_NOT_FOUND');
    await unchanged(websiteState,'POS cannot adopt website order or modify header/status/revision/items');
    ok((await db.query('select tracking_token from orders where id=$1',[o.id])).rows[0].tracking_token===null,'POS cannot enter token tracking');
    await db.exec(`select set_config('request.jwt.claim.sub','${id(1)}',false); set role authenticated;`);
    ok((await db.query('select * from orders where order_number=$1',[web.order_number])).rows.length===1,'Incoming Orders still reads website order');
    ok((await db.query("update orders set payment_status='paid' where order_number=$1 returning id",[web.order_number])).rows.length===1,'existing website payment field remains compatible');
    await db.exec('reset role');
    // Reapplying drafts must retain data and not create duplicate grants/constraints.
    for(const file of ['POS_PHASE_P1A_SCHEMA.sql','POS_PHASE_P1A_BACKEND.sql'])await db.exec(fs.readFileSync(path.join(root,'admin',file),'utf8'));
    ok((await call('pos_get_order',{p_order_id:o.id})).id===o.id,'draft reapplication preserves orders');
    console.log(checks+' PostgreSQL POS/website checks passed (embedded, offline).');
  }finally{await db.close();}
}
module.exports={fixture};
if(require.main===module)run().catch(e=>{console.error(e.message,e.detail||'');process.exitCode=1;});
