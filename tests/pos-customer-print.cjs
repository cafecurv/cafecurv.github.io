// Actual embedded SQL read path and pure document renderer; no live network.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {kitchenFixture}=require('./pos-kitchen-fixture.cjs');
const {buildOrderCopyHtml}=require('../admin/pos-customer-print.js');
async function copyFixture(){const f=await kitchenFixture();try{
  await f.db.exec(fs.readFileSync(path.join(__dirname,'../admin/POS_PHASE_P1C_BACKEND.sql'),'utf8'));return f;
}catch(e){await f.db.close();throw e;}}
// All business tables, including order/payment fields, commands and kitchen
// history, plus table inventory and shared number sequence. Detect any writes.
async function businessState(db){
  const names=(await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','pos_private') order by 1,2")).rows;
  const state={};
  for(const {schemaname,tablename} of names){assert.match(schemaname,/^[a-z_]+$/);assert.match(tablename,/^[a-z_0-9]+$/);
    state[schemaname+'.'+tablename]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') data from "${schemaname}"."${tablename}" t`)).rows[0].data;}
  state.sequence=(await db.query('select last_value,is_called from order_number_seq')).rows[0];return state;
}
async function run(){
  const f=await copyFixture();const {db,rpc,id}=f;let checks=0,key=12000;
  const ok=(value,label)=>{assert.ok(value,label);checks++;};
  const call=async(n,a)=>{const r=await rpc(n,a);assert.equal(r.error,null,JSON.stringify(r.error));return r.data;};
  const fail=async(n,a,detail)=>{const r=await rpc(n,a);assert.equal(r.error?.details,detail);checks++;};
  try{
    let o=await call('pos_create_order',{p_key:id(key++),p_size:id(40),p_choices:[id(60)],p_quantity:2,p_item_note:'No ice',p_customer:'Jasmine',p_type:'dine_in',p_note:'Table 2'});
    const copyArgs={p_order_id:o.id};const before=await businessState(db);
    const copy=await call('pos_get_order_copy',copyArgs),again=await call('pos_get_order_copy',copyArgs);
    ok(copy.order_number===o.order_number&&again.order_number===o.order_number,'same order number');
    ok(copy.revision===o.revision&&copy.items.length===1,'read preserves revision/items');
    ok(copy.items[0].quantity===2&&Number(copy.items[0].unit_price)===185&&Number(copy.items[0].line_total)===370,'saved quantity and option-inclusive unit/line prices');
    ok(Number(copy.subtotal)===370&&Number(copy.total)===370,'authoritative subtotal and total');
    ok(copy.payment_status==='unpaid'&&copy.source==='pos'&&copy.printed_at,'unpaid POS boundary and server timestamp');
    assert.deepEqual(await businessState(db),before);checks++;
    const html=buildOrderCopyHtml({...copy,printed_at:'2026-09-17T11:42:00Z'});
    ok(html.includes('ORDER COPY')&&html.includes('UNPAID')&&html.includes('Not proof of payment.'),'basic unpaid customer copy');
    ok(html.includes('Jasmine')&&html.includes('DINE-IN')&&html.includes('7:42')&&html.includes('PM'),'customer/type and Manila time');
    ok(html.includes('No ice')&&html.includes('Milk: Oat')&&html.includes('+₱25.00 / unit'),'notes and modifier price effect');
    ok(html.includes('₱185.00')&&html.includes('₱370.00')&&html.includes('SUBTOTAL'),'saved monetary content');
    await db.exec('update product_sizes set price=999; update option_choices set price_delta=99;');
    const changedCatalog=await call('pos_get_order_copy',copyArgs);
    assert.deepEqual(changedCatalog.items,copy.items);ok(changedCatalog.total===copy.total,'catalog changes cannot reprice copy');
    o=await call('pos_update_item',{p_key:id(key++),p_order_id:o.id,p_revision:o.revision,p_item_id:o.items[0].id,p_quantity:3,p_item_note:'Less sweet'});
    const latest=await call('pos_get_order_copy',copyArgs);
    ok(latest.revision===o.revision&&Number(latest.total)===555&&latest.items[0].item_note==='Less sweet','reprint reflects latest committed order');
    o=await call('pos_send_kitchen',{p_key:id(key++),p_order_id:o.id,p_revision:o.revision});
    o=await call('pos_hold_order',{p_key:id(key++),p_order_id:o.id,p_revision:o.revision});
    const heldBefore=await businessState(db);const held=await call('pos_get_order_copy',copyArgs);
    ok(held.status==='held','HELD copy permitted');assert.deepEqual(await businessState(db),heldBefore);checks++;
    await db.query("update orders set customer_name='   ' where id=$1",[o.id]);
    ok((await call('pos_get_order_copy',copyArgs)).customer_name==='Walk-in','blank persisted customer fallback');
    const hostile='<img src=x onerror=bad()> & " </script>';
    const hostileHtml=buildOrderCopyHtml({...copy,customer_name:hostile,note:hostile,order_number:hostile,
      items:[{...copy.items[0],product_name:hostile,variant_label:hostile,item_note:hostile,
        options:{selections:[{group_name:hostile,label:hostile,price_delta:25}]}}]});
    ok(!hostileHtml.includes(hostile)&&hostileHtml.includes('&lt;img')&&hostileHtml.includes('&amp;'),'all dynamic text escaped');
    ok(buildOrderCopyHtml({...copy,customer_name:' '}).includes('Walk-in'),'renderer blank fallback');
    assert.throws(()=>buildOrderCopyHtml({...copy,payment_status:'paid'}),/POS_COPY_UNAVAILABLE/);checks++;
    await db.exec(`insert into orders(id,order_number,customer_name,customer_phone) values('${id(12900)}','C-WEB-COPY','Web Guest','09000000000');`);
    const webBefore=await businessState(db);await fail('pos_get_order_copy',{p_order_id:id(12900)},'POS_NOT_FOUND');assert.deepEqual(await businessState(db),webBefore);checks++;
    await fail('pos_get_order_copy',{p_order_id:id(12901)},'POS_NOT_FOUND');
    await db.exec(`update pos_staff_access set is_active=false where user_id='${id(2)}';`);
    await fail('pos_get_order_copy',copyArgs,'POS_ACCESS_DENIED');
    await db.exec(`update pos_staff_access set is_active=true where user_id='${id(2)}';`);
    f.setUser(id(1));ok((await call('pos_get_order_copy',copyArgs)).id===o.id,'owner read authorized');
    f.setUser(null);await fail('pos_get_order_copy',copyArgs,'POS_AUTH_REQUIRED');f.setUser(id(2));
    ok(!(await db.query("select has_function_privilege('anon','public.pos_get_order_copy(uuid)','EXECUTE') allowed")).rows[0].allowed,'anonymous execute denied');
    // Simulate future lifecycle/financial states solely in this disposable fixture.
    await db.exec('alter table orders drop constraint orders_status_check; alter table orders drop constraint orders_pos_boundary_check;');
    await db.query("update orders set status='completed',pos_held_at=null where id=$1",[o.id]);
    await fail('pos_get_order_copy',copyArgs,'POS_COPY_UNAVAILABLE');
    await db.query("update orders set status='open',payment_status='paid' where id=$1",[o.id]);
    await fail('pos_get_order_copy',copyArgs,'POS_COPY_UNAVAILABLE');
    await db.query("update orders set payment_status='unpaid',total=subtotal+10 where id=$1",[o.id]);
    await fail('pos_get_order_copy',copyArgs,'POS_COPY_UNAVAILABLE');
    await db.query('update orders set total=subtotal where id=$1',[o.id]);
    o=await call('pos_get_order',copyArgs);o=await call('pos_remove_item',{p_key:id(key++),p_order_id:o.id,p_revision:o.revision,p_item_id:o.items[0].id});
    await fail('pos_get_order_copy',copyArgs,'POS_COPY_EMPTY');
    console.log(checks+' offline P1C database/renderer checks passed.');
  }finally{await db.close();}
}
module.exports={copyFixture,businessState};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
