// Offline migration-gate tests: execute the actual draft, including BEGIN/COMMIT.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./pos-database.cjs');
const schema=fs.readFileSync(path.join(__dirname,'../admin/POS_PHASE_P1A_SCHEMA.sql'),'utf8');
async function seed(db,id) {
  await db.exec(`insert into orders(id,order_number,customer_name,customer_phone,total,subtotal)
    values('${id(800)}','C-800','Historical Guest','09000000000',160,160);
    insert into order_items(id,order_id,product_name,quantity,unit_price,line_total,item_note)
    values('${id(801)}','${id(800)}','Historical item',1,160,160,'Keep this note');`);
}
async function snapshot(db) {
  return (await db.query(`select
    (select jsonb_agg(to_jsonb(o) order by id) from orders o) as orders,
    (select jsonb_agg(to_jsonb(i) order by id) from order_items i) as items,
    (select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by conname)
      from pg_constraint where conrelid in ('orders'::regclass,'order_items'::regclass)) as constraints,
    (select jsonb_agg(jsonb_build_array(table_name,column_name,is_nullable) order by table_name,ordinal_position)
      from information_schema.columns where table_schema='public' and table_name in ('orders','order_items')) as columns,
    (select jsonb_agg(to_jsonb(n) order by n.nspname) from pg_namespace n
      where n.nspname in ('public','pos_private')) as namespaces,
    (select jsonb_agg(to_jsonb(c) - 'relpages' - 'reltuples' - 'relallvisible' - 'relallfrozen' order by c.oid)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','pos_private')) as relations,
    (select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname)
      from pg_policies p where schemaname in ('public','pos_private')) as policies,
    (select jsonb_agg(to_jsonb(i) order by schemaname,indexname)
      from pg_indexes i where schemaname in ('public','pos_private')) as indexes,
    (select jsonb_agg(jsonb_build_array(p.oid,p.proacl,pg_get_functiondef(p.oid)) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='pos_private' or (n.nspname='public' and p.proname like 'pos_%')) as functions,
    to_regnamespace('pos_private') is not null as private_schema,
    to_regclass('public.pos_staff_access') is not null as access_table`)).rows[0];
}
async function run() {
  let checks=0;
  // Missing POS columns must be handled on first install; existing website data
  // must pass unmodified. Run again to cover normal draft reapplication.
  const clean=await fixture({applyPos:false});
  try {
    await seed(clean.db,clean.id);
    const before=await snapshot(clean.db);
    await clean.db.exec(schema);
    const after=await snapshot(clean.db);
    for(const table of ['orders','items'])for(const [key,value] of Object.entries(before[table][0]))
      assert.deepEqual(after[table][0][key],value,'historical '+table+'.'+key);
    checks++;
    await clean.db.exec(schema);
    // Recreated constraints/policies may receive new internal OIDs; compare
    // their definitions and row values, not object identity on successful runs.
    const reapplied=await snapshot(clean.db);
    for(const key of ['orders','items','constraints','columns','policies','indexes'])
      assert.deepEqual(reapplied[key],after[key],'compatible reapplication: '+key);
    checks++;

    await clean.db.exec(fs.readFileSync(path.join(__dirname,'../admin/POS_PHASE_P1A_BACKEND.sql'),'utf8'));
    await clean.db.exec(`insert into pos_staff_access(user_id,staff_id,created_by)
      values('${clean.id(2)}','${clean.id(10)}','${clean.id(1)}');`);
    const created=await clean.rpc('pos_create_order',{p_key:clean.id(802),p_size:clean.id(40),p_choices:[clean.id(60)],
      p_quantity:2,p_item_note:'Saved POS note',p_customer:'Counter Guest',p_type:'dine_in',p_note:'Saved header'});
    assert.equal(created.error,null);
    const held=await clean.rpc('pos_hold_order',{p_key:clean.id(803),p_order_id:created.data.id,p_revision:created.data.revision});
    assert.equal(held.error,null);
    const validPos=await snapshot(clean.db);
    const posRow=validPos.orders.find(o=>o.source==='pos');
    assert.ok(posRow.pos_revision>1&&posRow.pos_created_by&&posRow.pos_updated_by&&posRow.pos_held_at);
    assert.ok(validPos.items.some(i=>Number(i.pos_base_price)===160&&Number(i.pos_option_total)===25));
    await clean.db.exec(schema);
    const retained=await snapshot(clean.db);
    for(const key of ['orders','items','constraints','columns','policies','indexes','functions'])
      assert.deepEqual(retained[key],validPos[key],'valid populated POS reapplication: '+key);
    checks++;
  } finally {await clean.db.close();}

  const cases=[
    ['ORDER_STATUS',`alter table orders drop constraint orders_status_check;
      update orders set status='legacy_unknown';`],
    ['ORDER_BOUNDARY',`alter table orders alter column tracking_token drop not null;
      alter table orders drop constraint if exists orders_pos_boundary_check;
      update orders set tracking_token=null;`],
    ['ORDER_DELIVERY',`alter table orders drop constraint orders_delivery_state_check;
      update orders set delivery_address='Unexpected pickup address';`],
    ['ITEM_PRICE',`alter table order_items drop constraint if exists order_items_pos_price_check;
      alter table order_items add column if not exists pos_base_price numeric(10,2),
        add column if not exists pos_option_total numeric(10,2);
      update order_items set pos_base_price=160,pos_option_total=25;`]
  ];
  for(const applyPos of [false,true])for(const [suffix,setup] of cases) {
    const f=await fixture({applyPos});
    try {
      await seed(f.db,f.id);await f.db.exec(setup);
      const before=await snapshot(f.db);
      await assert.rejects(f.db.exec(schema),e=>{
        assert.equal(e.code,'P0001');assert.equal(e.detail,'POS_PREFLIGHT_'+suffix);
        assert.match(e.message,/P1A pre-flight: 1 existing/);
        assert.match(e.message,/No historical rows were changed/);return true;
      });
      await f.db.exec('rollback');
      assert.deepEqual(await snapshot(f.db),before,'failed gate preserves rows and prior schema');
      checks++;
    } finally {await f.db.close();}
  }
  console.log(checks+' offline POS schema pre-flight scenarios passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
