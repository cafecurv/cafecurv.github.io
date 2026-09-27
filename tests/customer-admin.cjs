// C2A actual SQL execution in isolated PGlite; no network or production access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixture } = require('./pos-database.cjs');
const sql = name => fs.readFileSync(path.join(__dirname, '../admin', name), 'utf8');

async function run() {
  const { db, id, rpc } = await fixture();
  let checks = 0, sequence = 8000;
  const check = (value, label) => { assert.ok(value, label); checks++; };
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const query = async (s, args = []) => (await db.query(s, args)).rows;
  const as = async (role, user, s, args = []) => {
    await query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
    await db.exec('set role ' + role);
    try { return await query(s, args); } finally { await db.exec('reset role'); }
  };
  const call = async (name, args = [], role = 'authenticated', user = id(1)) => {
    assert.match(name, /^customer_admin_(list|detail|order_items)$/);
    return (await as(role, user, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args))[0].result;
  };
  const fail = async (fn, code, detail) => {
    await assert.rejects(fn, e => e.code === code && (!detail || e.detail === detail)); checks++;
  };
  const payload = extra => ({ submission_key: id(sequence++), customer_name: 'Original Alice', customer_phone: '09171234567',
    fulfillment_type: 'delivery', delivery_option: 'curv_rider', delivery_address: 'Old address', payment_method: 'gcash',
    subtotal: 160, total: 160, items: [{ product_name: 'Saved Bowl', category_name: 'Food', variant_label: 'Large',
      quantity: 2, unit_price: 80, line_total: 160, options: { spice: 'Mild' }, item_note: 'No onions', sort_order: 0 }], ...extra });
  const submit = async p => (await as('anon', null, 'select public.submit_public_order($1::jsonb) result', [JSON.stringify(p)]))[0].result;
  const order = async number => (await query('select * from public.orders where order_number=$1', [number]))[0];
  const state = async () => query(`select
    (select jsonb_agg(to_jsonb(c) order by id) from public.customers c) customers,
    (select jsonb_agg(to_jsonb(o) order by id) from public.orders o) orders,
    (select jsonb_agg(to_jsonb(i) order by id) from public.order_items i) items`);
  const definitions = async () => query(`select oid::regprocedure::text signature,pg_get_functiondef(oid) definition,
    proowner,proacl::text,proconfig from pg_proc where oid in (
    'public.submit_public_order(jsonb)'::regprocedure,'public.get_public_order_tracking(uuid)'::regprocedure,
    'customer_private.normalize_phone(text)'::regprocedure,'customer_private.link_website_order(uuid)'::regprocedure) order by oid`);
  const customerKeys = ['customer_id','latest_name','normalized_phone','latest_delivery_address','first_order_at',
    'last_order_at','created_at','submitted_order_count','completed_order_count','repeat_customer'].sort();
  try {
    await db.exec(sql('INCOMING_ORDERS_PHASE_O7E_TRACKING_DETAILS.sql'));
    const historical = await submit(payload({}));
    await db.exec(sql('CUSTOMER_PHASE_C1B_SCHEMA.sql'));
    await db.exec(sql('CUSTOMER_PHASE_C1B_BACKEND.sql'));
    const first = await submit(payload({}));
    const a1 = await order(first.order_number);
    const second = await submit(payload({ customer_name: 'Latest Alice', delivery_address: '100%_ Lane' }));
    const a2 = await order(second.order_number);
    const third = await submit(payload({ customer_name: 'Bob', customer_phone: '09175555555', delivery_address: 'Harbor Road' }));
    const b = await order(third.order_number);
    await query("update public.orders set status='completed',created_at='2026-01-01' where id=$1", [a1.id]);
    await query("update public.orders set status='cancelled',created_at='2026-01-02' where id=$1", [a2.id]);
    await query(`insert into public.order_items(order_id,product_name,quantity,unit_price,line_total)
      values($1,'Second saved item',1,0,0)`, [a1.id]);
    // Deliberately link a legitimate POS fixture to prove the read boundary independently of C1B.
    const pos = await rpc('pos_create_order', { p_key: id(sequence++), p_size: id(40), p_choices: [id(60)],
      p_quantity: 1, p_customer: 'Counter', p_type: 'dine_in', p_note: '', p_item_note: '' });
    assert.equal(pos.error, null);
    await query('update public.orders set customer_id=$1 where id=$2', [a1.customer_id, pos.data.id]);
    await query("update public.customers set created_at='2026-01-01',last_order_at='2026-10-01' where id=$1", [a1.customer_id]);
    await query("update public.customers set created_at='2026-02-01',last_order_at='2026-11-01' where id=$1", [b.customer_id]);
    const baseline = await state(), baselineDefinitions = await definitions();
    const track = () => as('anon', null, 'select * from public.get_public_order_tracking($1::uuid)', [first.tracking_token]);
    const beforeTracking = await track();
    await db.exec(sql('CUSTOMER_PHASE_C2A_BACKEND.sql'));
    await db.exec(sql('CUSTOMER_PHASE_C2A_BACKEND.sql'));
    equal(await state(), baseline, 'migration and reapplication write no business data');
    equal(await definitions(), baselineDefinitions, 'submission/tracking/private helpers and security metadata untouched');
    equal(await track(), beforeTracking, 'tracking response unchanged');
    for (const [name, args] of [['customer_admin_list', []], ['customer_admin_detail', [a1.customer_id]],
      ['customer_admin_order_items', [a1.customer_id, a1.id]]]) {
      await fail(() => call(name, args, 'anon', null), '42501');
      await fail(() => call(name, args, 'authenticated', id(3)), '42501', 'CUSTOMER_FORBIDDEN');
      await fail(() => call(name, args, 'authenticated', null), '42501', 'CUSTOMER_FORBIDDEN');
      check(!!await call(name, args), 'owner succeeds: ' + name);
    }
    for (const role of ['anon', 'authenticated']) {
      for (const user of [null, id(1), id(3)]) {
        await fail(() => as(role, user, 'select * from public.customers'), '42501');
        await fail(() => as(role, user, "select customer_private.normalize_phone('09171234567')"), '42501');
        await fail(() => as(role, user, 'select customer_private.link_website_order(null::uuid)'), '42501');
      }
    }
    check((await query("select relrowsecurity from pg_class where oid='public.customers'::regclass"))[0].relrowsecurity, 'customer RLS remains enabled');
    equal((await query("select count(*)::int n from pg_policies where schemaname='public' and tablename='customers'"))[0].n, 0, 'no customer policies');
    const security = await query("select prosecdef,provolatile,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon_exec from pg_proc where proname like 'customer_admin_%'");
    check(security.length === 3 && security.every(p => p.prosecdef && p.provolatile === 's' && p.proconfig.includes('search_path=pg_catalog') && !p.anon_exec), 'all three functions have safe metadata');
    await fail(() => call('customer_admin_list', ['x'.repeat(201)], 'authenticated', id(3)), '42501', 'CUSTOMER_FORBIDDEN');
    await fail(() => call('customer_admin_detail', [id(99999)], 'authenticated', id(3)), '42501', 'CUSTOMER_FORBIDDEN');
    await fail(() => call('customer_admin_order_items', [null,null], 'authenticated', id(3)), '42501', 'CUSTOMER_FORBIDDEN');
    await query('delete from public.admin_profiles where id=$1', [id(1)]);
    await fail(() => call('customer_admin_list'), '42501', 'CUSTOMER_FORBIDDEN');
    await query("insert into public.admin_profiles(id,full_name) values($1,'Fixture Owner')", [id(1)]);
    let list = await call('customer_admin_list');
    equal(list.total_count, 2, 'two linked contacts; historical matching phone creates no extra contact');
    equal((await order(historical.order_number)).customer_id, null, 'historical order remains unlinked');
    equal([list.limit,list.offset,list.has_more], [25,0,false], 'list defaults');
    const alice = list.customers.find(c => c.customer_id === a1.customer_id);
    const bob = list.customers.find(c => c.customer_id === b.customer_id);
    equal(Object.keys(alice).sort(), customerKeys, 'list safe projection exactly');
    equal([alice.submitted_order_count, alice.completed_order_count, alice.repeat_customer], [2,1,true], 'header counts include cancelled; exclude POS, unlinked and item multiplication');
    equal([bob.submitted_order_count,bob.completed_order_count,bob.repeat_customer], [1,0,false], 'one order not repeat');
    for (const search of ['latest ALICE', '+639171234567', '639171234567', '09171234567', '100%_ Lane', '%', '_']) {
      const found = await call('customer_admin_list', [search]);
      equal(found.customers.map(c => c.customer_id), [a1.customer_id], 'literal/normalized search ' + search);
    }
    equal((await call('customer_admin_list', ["' OR true --"])).total_count, 0, 'SQL input is literal');
    equal((await call('customer_admin_list', ['missing'])).customers, [], 'empty search result');
    equal((await call('customer_admin_list', ['', 'repeat'])).customers.map(c => c.customer_id), [a1.customer_id], 'repeat filter');
    equal((await call('customer_admin_list', ['', 'one_time'])).customers.map(c => c.customer_id), [b.customer_id], 'one_time filter');
    for (const [sort, expected] of [['recent',[b.customer_id,a1.customer_id]], ['most_orders',[a1.customer_id,b.customer_id]],
      ['newest',[b.customer_id,a1.customer_id]], ['oldest',[a1.customer_id,b.customer_id]]]) {
      equal((await call('customer_admin_list', ['', 'all', sort])).customers.map(c => c.customer_id), expected, sort + ' ordering');
    }
    const page1 = await call('customer_admin_list', ['', 'all', 'recent', 1, 0]);
    const page2 = await call('customer_admin_list', ['', 'all', 'recent', 1, 1]);
    equal([page1.has_more,page2.has_more,page1.total_count,page2.total_count], [true,false,2,2], 'list pagination metadata');
    equal([page1.customers[0].customer_id,page2.customers[0].customer_id], [b.customer_id,a1.customer_id], 'distinct list pages');
    equal((await call('customer_admin_list', ['', 'all', 'recent',50,100000])).customers, [], 'bounded out-of-range page');
    for (const args of [['x'.repeat(201)], ['', 'invalid'], ['', 'all', 'id; drop table customers'],
      ['',null], ['','all',null], ['','all','recent',0], ['','all','recent',51], ['','all','recent',null],
      ['','all','recent',25,-1], ['','all','recent',25,100001], ['','all','recent',25,null]]) {
      await fail(() => call('customer_admin_list', args), '22023', 'CUSTOMER_INPUT_INVALID');
    }
    let detail = await call('customer_admin_detail', [a1.customer_id]);
    equal(detail.customer, alice, 'detail and list summary agree');
    equal([detail.limit,detail.offset,detail.total_count,detail.has_more], [20,0,2,false], 'history defaults/counts');
    equal(detail.orders.map(o => o.order_id), [a2.id,a1.id], 'only selected website history newest first');
    equal(Object.keys(detail.orders[0]).sort(), ['order_id','order_number','created_at','status','fulfillment_type',
      'payment_method','payment_status','total','customer_name','customer_phone','delivery_address'].sort(), 'order safe projection exactly');
    equal([detail.customer.latest_name,detail.orders[1].customer_name,detail.orders[1].delivery_address],
      ['Latest Alice','Original Alice','Old address'], 'latest and historical snapshots distinct');
    equal(detail.orders.map(o => o.status), ['cancelled','completed'], 'historical statuses preserved');
    equal((await call('customer_admin_detail', [b.customer_id])).orders.map(o => o.order_id), [b.id], 'other customer isolated');
    const history1 = await call('customer_admin_detail', [a1.customer_id,1,0]);
    const history2 = await call('customer_admin_detail', [a1.customer_id,1,1]);
    equal([history1.orders[0].order_id,history2.orders[0].order_id,history1.has_more,history2.has_more], [a2.id,a1.id,true,false], 'history pages');
    for (const args of [[null], [a1.customer_id,0], [a1.customer_id,51], [a1.customer_id,null],
      [a1.customer_id,20,-1], [a1.customer_id,20,100001], [a1.customer_id,20,null]]) {
      await fail(() => call('customer_admin_detail', args), '22023', 'CUSTOMER_INPUT_INVALID');
    }
    await fail(() => call('customer_admin_detail',[id(99999)]), 'P0002','CUSTOMER_NOT_FOUND');
    const items = await call('customer_admin_order_items', [a1.customer_id,a1.id]);
    equal(items.items.length, 2, 'selected items only');
    const saved = items.items.find(i => i.product_name === 'Saved Bowl');
    equal(Object.keys(saved).sort(), ['product_name','category_name','variant_label','quantity','unit_price','line_total','options','item_note','sort_order'].sort(), 'item safe projection exactly');
    equal([saved.options,saved.item_note,saved.quantity,saved.unit_price,saved.line_total], [{spice:'Mild'},'No onions',2,80,160], 'saved item snapshots');
    for (const args of [[b.customer_id,a1.id],[a1.customer_id,b.id],[a1.customer_id,pos.data.id],[a1.customer_id,id(99999)],[a1.customer_id,(await order(historical.order_number)).id]]) {
      await fail(() => call('customer_admin_order_items',args),'P0002','CUSTOMER_ORDER_NOT_FOUND');
    }
    await fail(() => call('customer_admin_order_items',[null,a1.id]),'22023','CUSTOMER_INPUT_INVALID');
    await fail(() => call('customer_admin_order_items',[a1.customer_id,null]),'22023','CUSTOMER_INPUT_INVALID');
    equal((await call('customer_admin_detail',[a1.customer_id,50,100000])).orders,[], 'history out-of-range page empty');
    await db.exec('begin transaction read only');
    try {
      check(!!await call('customer_admin_list'), 'list works in enforced read-only transaction');
      check(!!await call('customer_admin_detail',[a1.customer_id]), 'detail works in enforced read-only transaction');
      check(!!await call('customer_admin_order_items',[a1.customer_id,a1.id]), 'items work in enforced read-only transaction');
    } finally { await db.exec('rollback'); }
    equal(await state(), baseline, 'all successful/failed reads leave all business rows unchanged');
    // Tie fixtures: equal dates and equal counts must use ID rather than unstable arrival order.
    await query("update public.customers set created_at='2026-01-01',last_order_at='2026-12-01'");
    await query('update public.orders set customer_id=null where id=$1',[a2.id]);
    for (const sort of ['recent','most_orders','newest','oldest']) {
      equal((await call('customer_admin_list',['','all',sort])).customers.map(c=>c.customer_id), [a1.customer_id,b.customer_id].sort(), 'stable customer ties '+sort);
    }
    await query("update public.orders set customer_id=$1,created_at='2026-01-01' where id=$2",[a1.customer_id,a2.id]);
    equal((await call('customer_admin_detail',[a1.customer_id])).orders.map(o=>o.order_id),[a1.id,a2.id].sort(),'stable order ties');
    const newPayload = payload({customer_phone:'09178888888',customer_name:'Post C2A'});
    const newResult = await submit(newPayload);
    equal(Object.keys(newResult).sort(), ['order_number','tracking_token'], 'submission response unchanged');
    check(!!(await order(newResult.order_number)).customer_id, 'C1B linking still works after C2A');
    const beforeReplay = await state();
    equal(await submit(newPayload),newResult,'idempotent response unchanged');
    equal(await state(),beforeReplay,'idempotent replay still writes nothing');
    await db.exec(sql('CUSTOMER_PHASE_C2A_VERIFY.sql'));
    const beforeSmoke = await state();
    await db.exec(sql('CUSTOMER_PHASE_C2A_SMOKE_TEST.sql'));
    equal(await state(),beforeSmoke,'read-only smoke changes no data');
    console.log(`${checks} C2A assertions passed.`);
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
