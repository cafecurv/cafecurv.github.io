// Real embedded PostgreSQL, serialized requests. NOT a simultaneous-session test.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {kitchenFixture}=require('./pos-kitchen-fixture.cjs');
(async()=>{
  const f=await kitchenFixture();const {db,rpc,id}=f;let count=0,key=2000,o;
  const ok=(v,label)=>{assert.ok(v,label);count++;};
  const call=async(name,args={})=>{const r=await rpc(name,args);assert.equal(r.error,null,JSON.stringify(r.error));return r.data;};
  const fail=async(name,args,detail)=>{const r=await rpc(name,args);assert.equal(r.error?.details,detail,JSON.stringify(r));count++;};
  const args=()=>({p_key:id(key++),p_order_id:o.id,p_revision:o.revision});
  const line={p_size:id(40),p_choices:[id(60)],p_quantity:2,p_item_note:'No ice'};
  const edit=async(item,qty,note='No ice')=>{o=await call('pos_update_item',{...args(),p_item_id:item,p_quantity:qty,p_item_note:note});};
  const send=async()=>{o=await call('pos_send_kitchen',args());return o.kitchen_submission;};
  const snapshot=async()=> (await db.query(`select
    (select jsonb_agg(to_jsonb(o) order by id) from orders o) as orders,
    (select jsonb_agg(to_jsonb(i) order by id) from order_items i) as items,
    (select jsonb_agg(to_jsonb(s) order by id) from pos_kitchen_submissions s) as tickets,
    (select jsonb_agg(to_jsonb(i) order by id) from pos_kitchen_instructions i) as instructions,
    (select jsonb_agg(to_jsonb(c) order by command_key) from pos_private.commands c) as commands`)).rows[0];
  try{
    o=await call('pos_create_order',{p_key:id(key++),...line,p_customer:'Kitchen Guest',p_type:'dine_in',p_note:'Table 2'});
    const firstItem=o.items[0].id,initialRev=o.revision;
    ok(o.kitchen.pending_count===1&&o.kitchen.pending[0].action==='ADD','initial server pending');
    const firstArgs=args();o=await call('pos_send_kitchen',firstArgs);const first=o.kitchen_submission;
    ok(first.ticket_number===1&&first.instructions.length===1&&first.instructions[0].quantity===2,'ticket 1 first send');
    ok(o.revision===initialRev+1&&first.source_revision===initialRev&&o.kitchen.pending_count===0,'one revision and all sent');
    ok(first.submitted_by==='Fixture Cashier'&&first.header.note==='Table 2','actor/header snapshots');
    ok(!/price|total|payment/.test(JSON.stringify(first)),'price-free ticket contract');
    const beforeRetry=await snapshot();const replay=await call('pos_send_kitchen',firstArgs);
    assert.deepEqual(replay.kitchen_submission,first);assert.deepEqual(await snapshot(),beforeRetry);count++;
    await fail('pos_send_kitchen',{...firstArgs,p_revision:o.revision},'POS_KEY_CONFLICT');
    await fail('pos_send_kitchen',{...firstArgs,p_key:id(key++)},'POS_REVISION_CONFLICT');
    await fail('pos_send_kitchen',args(),'POS_KITCHEN_NO_CHANGES');
    assert.deepEqual(await snapshot(),beforeRetry);count++;

    o=await call('pos_add_item',{...args(),...line,p_quantity:1,p_item_note:'Extra hot'});const second=o.items[1].id;
    let t=await send();ok(t.ticket_number===2&&t.instructions.length===1&&t.instructions[0].order_item_id===second,'add-on only');
    await edit(firstItem,3);t=await send();ok(t.instructions[0].action==='ADD'&&t.instructions[0].quantity===1,'quantity increase delta');
    await edit(firstItem,1);t=await send();ok(t.instructions[0].action==='CANCEL'&&t.instructions[0].quantity===2,'quantity decrease delta');
    await edit(firstItem,1,'Less sweet');t=await send();
    ok(t.instructions[0].action==='CHANGE'&&t.instructions[0].before.note==='No ice'&&t.instructions[0].after.note==='Less sweet'&&t.instructions[0].prior_instruction_id,'linked note replacement');
    await db.exec(`insert into option_choices(id,option_group_id,label,value,price_delta) values('${id(61)}','${id(50)}','Regular','regular',0);`);
    o=await call('pos_configure_item',{...args(),p_item_id:firstItem,...line,p_quantity:1,p_choices:[id(61)],p_item_note:'Less sweet'});
    t=await send();ok(t.instructions[0].action==='CHANGE'&&t.instructions[0].after.options[0].label==='Regular','modifier replacement');

    await edit(firstItem,1,'Changed again');o=await call('pos_remove_item',{...args(),p_item_id:second});
    o=await call('pos_add_item',{...args(),...line,p_quantity:3});const third=o.items.find(i=>i.id!==firstItem).id;
    t=await send();ok(t.instructions.map(i=>i.action).sort().join(',')==='ADD,CANCEL,CHANGE','mixed authoritative actions');
    const splitTotal=o.total;o=await call('pos_split_item',{...args(),p_item_id:third,p_quantity:1});const split=o.split_item_id;
    ok(o.items.find(i=>i.id===third).quantity===2&&o.items.find(i=>i.id===split).quantity===1&&o.total===splitTotal,'stable partial-unit split preserves total');
    await edit(split,1,'Only this unit');t=await send();
    ok(t.instructions.length===2&&t.instructions.some(i=>i.order_item_id===third&&i.action==='CANCEL'&&i.quantity===1)
      &&t.instructions.some(i=>i.order_item_id===split&&i.action==='ADD'&&i.after.note==='Only this unit'),'partial replacement explicit cancel/add');
    await fail('pos_split_item',{...args(),p_item_id:third,p_quantity:2},'POS_INVALID_INPUT');
    o=await call('pos_update_header',{...args(),p_customer:'New name',p_type:'pickup',p_note:'New order note'});
    t=await send();ok(t.instructions.length===1&&t.instructions[0].scope==='ORDER'&&t.instructions[0].action==='CHANGE','header-only explicit update');
    // Hold has no kitchen delta and sending while HELD is prohibited.
    o=await call('pos_hold_order',args());await fail('pos_send_kitchen',args(),'POS_STATE_INVALID');
    o=await call('pos_resume_order',args());ok(o.kitchen.pending_count===0,'hold/resume no false preparation');
    const beforeRead=await snapshot();assert.deepEqual(await call('pos_get_kitchen_ticket',{p_submission_id:first.id}),first);
    assert.deepEqual(await snapshot(),beforeRead);count++;
    // Read old snapshot after current catalog and order changes; never re-resolve it.
    await db.exec("update products set name='Renamed',archived_at=now(); update option_choices set label='Renamed choice';");
    assert.deepEqual(await call('pos_get_kitchen_ticket',{p_submission_id:first.id}),first);count++;
    await assert.rejects(db.query('update pos_kitchen_submissions set actor_label=$1 where id=$2',['Tamper',first.id]),e=>e.detail==='POS_KITCHEN_IMMUTABLE');count++;
    await assert.rejects(db.query('delete from pos_kitchen_instructions where submission_id=$1',[first.id]),e=>e.detail==='POS_KITCHEN_IMMUTABLE');count++;
    await db.exec(`update pos_staff_access set is_active=false where user_id='${id(2)}';`);
    await fail('pos_send_kitchen',args(),'POS_ACCESS_DENIED');await fail('pos_send_kitchen',firstArgs,'POS_ACCESS_DENIED');
    await fail('pos_get_kitchen_ticket',{p_submission_id:first.id},'POS_ACCESS_DENIED');
    await db.exec(`update pos_staff_access set is_active=true where user_id='${id(2)}';update staff set is_active=false where id='${id(10)}';`);
    await fail('pos_send_kitchen',args(),'POS_ACCESS_DENIED');
    await db.exec(`update staff set is_active=true where id='${id(10)}';`);
    f.setUser(null);await fail('pos_send_kitchen',args(),'POS_AUTH_REQUIRED');f.setUser(id(3));await fail('pos_send_kitchen',args(),'POS_ACCESS_DENIED');f.setUser(id(2));
    // Actual public website contracts after P1B, not merely a manually seeded row.
    await db.exec('set role anon');
    const payload={submission_key:id(900),customer_name:'Web Guest',customer_phone:'09000000000',fulfillment_type:'dine_in',
      subtotal:160,total:160,items:[{product_name:'Website Latte',quantity:1,unit_price:160,line_total:160}]};
    const web=(await db.query('select submit_public_order($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
    const webReplay=(await db.query('select submit_public_order($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
    ok(web.tracking_token&&web.order_number===webReplay.order_number,'website submit/retry with P1B');
    const tracking=(await db.query('select get_public_order_tracking($1::uuid) result',[web.tracking_token])).rows[0].result;
    ok(JSON.stringify(tracking).includes(web.order_number),'website tracking with P1B');
    ok((await db.query('select request_public_order_cancellation($1::uuid,$2) result',[web.tracking_token,'Changed plans'])).rows[0].result.ok,'website cancel request with P1B');
    await db.exec('reset role');
    const webId=(await db.query('select id from orders where order_number=$1',[web.order_number])).rows[0].id;
    const beforeWeb=await snapshot();await fail('pos_send_kitchen',{...args(),p_order_id:webId},'POS_NOT_FOUND');
    assert.deepEqual(await snapshot(),beforeWeb);count++;
    await db.exec(`select set_config('request.jwt.claim.sub','${id(1)}',false);set role authenticated;`);
    ok((await db.query('select * from orders where id=$1',[webId])).rows.length===1,'Incoming Orders reads website with P1B');
    await db.exec('reset role');
    await db.exec(`set role authenticated;`);
    await assert.rejects(db.query('select * from pos_kitchen_submissions'),e=>e.code==='42501');count++;
    await db.exec('reset role');
    ok(!(await db.query("select has_function_privilege('anon','public.pos_send_kitchen(uuid,uuid,bigint)','EXECUTE') allowed")).rows[0].allowed,'anon execute denied');
    for(const file of ['POS_PHASE_P1B_SCHEMA.sql','POS_PHASE_P1B_BACKEND.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../admin',file),'utf8'));
    assert.deepEqual(await call('pos_get_kitchen_ticket',{p_submission_id:first.id}),first);count++;
    // Never-sent removals do not create preparation/cancellation instructions.
    await db.exec('update products set archived_at=null;');
    o=await call('pos_add_item',{...args(),...line,p_quantity:1});const unsent=o.items[o.items.length-1].id;
    o=await call('pos_remove_item',{...args(),p_item_id:unsent});
    ok(o.kitchen.pending_count===0,'unsent add/remove produces no ticket');
    for(const item of [...o.items])o=await call('pos_remove_item',{...args(),p_item_id:item.id});
    t=await send();ok(t.instructions.every(i=>i.action==='CANCEL')&&o.items.length===0,'removed last items still send cancellations');
    const beforeSmoke=await snapshot();
    await db.exec(fs.readFileSync(path.join(__dirname,'../admin/POS_PHASE_P1B_VERIFY.sql'),'utf8'));count++;
    await db.exec(fs.readFileSync(path.join(__dirname,'../admin/POS_PHASE_P1B_SMOKE_TEST.sql'),'utf8'));
    assert.deepEqual(await snapshot(),beforeSmoke);count++;
    console.log(count+' offline kitchen database checks passed (serialized; no simultaneous-transaction claim).');
  }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
