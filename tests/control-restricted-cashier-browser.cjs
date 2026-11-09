const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://curv.test';
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const openOrder = {
  id: id(1), order_number:'C-FIXTURE-1', status:'submitted', source:'website',
  customer_name:'Fixture Guest', fulfillment_type:'dine_in', payment_status:'unpaid',
  payment_method:'counter', subtotal:125, total:125, currency:'PHP',
  customer_cancel_status:'none', created_at:new Date().toISOString(),
};
const historyOrder = { ...openOrder, id:id(2), order_number:'C-FIXTURE-2', status:'completed' };
const reviewOrder = { ...openOrder, id:id(3), order_number:'C-FIXTURE-3', customer_cancel_status:'requested' };
const inventory = {
  stock:[{item_id:id(4),item_name:'Fixture Beans',category_id:id(5),category_name:'Fixture Ingredients',
    unit_abbreviation:'g',usable_stock:6,expired_stock:0,current_stock:6,low_stock_threshold:7,
    is_low_stock:true,is_active:true,stock_revision:'1'}],
  categories:[{id:id(5),name:'Fixture Ingredients',is_active:true}],
  units:[{id:id(6),name:'Gram',abbreviation:'g',is_active:true}],
  low:[{item_id:id(4),item_name:'Fixture Beans'}], expiry:[],
};

async function session(browser, role, { orders = structuredClone([openOrder,historyOrder,reviewOrder]), checkAccess, holdOrderRead, readInventory } = {}) {
  const context = await browser.newContext({serviceWorkers:'block'});
  const calls = [];
  let loseStockResponse = true;
  await context.exposeFunction('cashierFixture', async (kind,name,args,identity) => {
    calls.push({kind,name,args,identity});
    const ok = data => ({data,error:null});
    const role = identity?.role;
    const inventoryRead = readInventory?.(name,identity,ok);
    if (inventoryRead !== undefined) return inventoryRead;
    if (kind === 'table') {
      if (role!=='owner' || name!=='orders') return ok([]);
      let rows = orders.filter(row=>args.filters.every(({method,key,value}) =>
        method==='eq' ? row[key]===value : value.includes(row[key])));
      if (args.update) {
        for (const row of rows) Object.assign(row,args.update);
        rows = args.returning ? rows.map(row=>({id:row.id})) : null;
      }
      const result = ok(structuredClone(args.single ? rows[0] || null : rows));
      if (!args.update) await holdOrderRead?.(args,identity);
      return result;
    }
    if (name==='curv_control_access') return checkAccess ? checkAccess(identity,ok) : ok(role);
    if (name==='pos_get_access') return {data:null,error:{details:'POS_ACCESS_DENIED'}};
    if (name==='is_admin') return ok(role==='owner');
    if (name==='get_public_store_status') return ok({website_ordering_enabled:true});
    if (name==='kiosk_owner_status') return ok({mode:'on',devices:[]});
    if (role!=='cashier') return ok([]);
    switch (name) {
      case 'control_cashier_orders':
        return ok(orders.filter(o=>(!args?.p_statuses||args.p_statuses.includes(o.status))
          &&(!args?.p_order_id||args.p_order_id===o.id)));
      case 'control_cashier_order_items':
        return ok(args.p_order_ids.map(order_id=>({order_id,product_name:'Fixture Coffee',quantity:1,unit_price:125,line_total:125,options:{}})));
      case 'control_cashier_advance_order':
        orders.find(o=>o.id===args.p_order_id).status=args.p_next;
        return ok(null);
      case 'control_cashier_inventory': return ok(inventory);
      case 'control_cashier_movements': return ok([]);
      case 'control_cashier_stock':
        if (loseStockResponse) {
          loseStockResponse = false;
          return {data:null,error:{message:'Synthetic response loss'}};
        }
        return ok({item_name:'Fixture Beans'});
      default: return {data:null,error:{details:'CASHIER_ACCESS_DENIED',message:'Access denied.'}};
    }
  });
  await context.addInitScript(({role}) => {
    const identityKey = 'fixture-control-account';
    let identity = JSON.parse(sessionStorage.getItem(identityKey) || JSON.stringify({role,uid:'synthetic-'+role}));
    const authSession = () => identity.role === 'signed-out' ? null : {
      user:{id:identity.uid,email:identity.uid+'@example.test'},access_token:'fixture-only',
    };
    const listeners = new Set();
    window.setFixtureAccount = (role, uid = 'synthetic-'+role, event = 'SIGNED_IN') => {
      identity = { role, uid };
      sessionStorage.setItem(identityKey, JSON.stringify(identity));
      if (event) listeners.forEach(fn=>fn(event, authSession()));
    };
    window.fixtureInventoryResponses = [];
    const send = (kind,name,args) => {
      const account = identity;
      return window.cashierFixture(kind,name,args,account).then(result=>{
        if (name.startsWith('inventory_') || name==='curv_control_access') {
          window.setTimeout(()=>window.fixtureInventoryResponses.push({name,uid:account.uid}),0);
        }
        return result;
      });
    };
    const build = name => {
      const request = { filters: [] };
      let chain;
      chain=new Proxy({}, {get:(_,key)=>key==='then'
        ? (resolve,reject)=>send('table',name,request).then(resolve,reject)
        : (...args)=>{
          if (key==='eq'||key==='in') request.filters.push({method:key,key:args[0],value:args[1]});
          if (key==='update') request.update=args[0];
          if (key==='select') request.returning=args[0];
          if (key==='maybeSingle') request.single=true;
          return chain;
        }});
      return chain;
    };
    window.fixtureOrderRealtime = null;
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session:authSession()}}),
        onAuthStateChange:fn=>{
          listeners.add(fn);
          queueMicrotask(()=>fn('INITIAL_SESSION',authSession()));
          return {data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};
        },
      },
      rpc:(name,args)=>send('rpc',name,args),
      from:build,
      channel:name=>{
        void window.cashierFixture('channel',name);
        return {
          name,
          on(_event,_filter,callback){
            if (name==='incoming-orders-admin') window.fixtureOrderRealtime=callback;
            return this;
          },
          subscribe(){return this;},
        };
      },
      removeChannel:channel=>{void window.cashierFixture('removed-channel',channel.name,null,identity);},
    })};
  },{role});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin!==origin || !/^\/admin\/[a-z-]+\.(html|js|css)$/.test(url.pathname)) return route.abort();
    const file=path.join(root,url.pathname.slice(1));
    return fs.existsSync(file)?route.fulfill({path:file}):route.abort();
  });
  return {context,calls,page:await context.newPage()};
}

test('cashier Control navigation, queue, and Inventory use only scoped APIs', async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const {context,page,calls} = await session(browser,'cashier');
    try {
      await page.goto(origin+'/admin/incoming-orders.html');
      await page.getByText(openOrder.order_number,{exact:true}).first().waitFor();
      assert.equal(await page.locator('[data-owner-account-label]').textContent(),'Cashier');
      assert.deepEqual(await page.locator('.admin-nav-link:visible').evaluateAll(links=>links.map(l=>l.getAttribute('href')).sort()),
        ['incoming-orders.html','inventory.html']);
      const review=page.locator('[data-order-id="'+reviewOrder.id+'"]');
      await review.locator('.order-ticket-summary').click();
      await review.getByText('Owner review required for this order.').waitFor();
      assert.equal(await review.getByRole('button',{name:'Accept',exact:true}).count(),0);
      const open=page.locator('[data-order-id="'+openOrder.id+'"]');
      await open.locator('.order-ticket-summary').click();
      await open.getByRole('button',{name:'Accept',exact:true}).click();
      await page.waitForFunction(()=>document.body.textContent.includes('moved to accepted'));
      assert.ok(calls.some(c=>c.name==='control_cashier_advance_order'&&c.args.p_expected==='submitted'&&c.args.p_next==='accepted'));
      assert.equal(await page.getByRole('button',{name:/mark (as )?(paid|unpaid)|^cancel$/i}).count(),0);
      assert.equal(await page.locator('[data-kiosk-controls]').isVisible(),false);
      assert.equal(await page.locator('[data-website-ordering-control]').isVisible(),false);
      assert.ok(!calls.some(c=>c.kind==='channel'||c.kind==='table'&&['orders','order_items'].includes(c.name)));
      await page.locator('#order-search-input').fill(historyOrder.order_number);
      await page.locator('[data-order-search-results]').getByText(historyOrder.order_number,{exact:true}).waitFor();
      await page.locator('#order-search-input').press('Escape');
      await page.locator('[data-order-history-toggle]').click();
      await page.locator('[data-order-filter="completed"]').click();
      await page.getByText(historyOrder.order_number,{exact:true}).first().waitFor();
      await page.goto(origin+'/admin/inventory.html');
      await page.getByText('Fixture Beans',{exact:true}).first().waitFor();
      assert.equal(await page.locator('[data-owner-account-label]').textContent(),'Cashier');
      for (const operation of ['receive-stock','use-stock','record-waste','count-stock']) {
        assert.equal(await page.locator('[data-inventory-drawer-open="'+operation+'"]').first().isVisible(),true);
      }
      for (const operation of ['add-item','opening-balance']) {
        assert.equal(await page.locator('[data-inventory-drawer-open="'+operation+'"]').first().isVisible(),false);
      }
      assert.equal(await page.locator('#receive-stock-cost').isVisible(),false);
      assert.ok(calls.some(c=>c.name==='control_cashier_movements'));
      assert.ok(!calls.some(c=>c.kind==='table'&&c.name.startsWith('inventory_')));
      const receive = async () => {
        await page.locator('[data-inventory-drawer-open="receive-stock"]').first().click();
        await page.locator('#receive-stock-item').selectOption(id(4));
        await page.locator('#receive-stock-quantity').fill('2');
        await page.locator('#receive-stock-reference').fill('Synthetic retry reference');
        await page.locator('[data-receive-stock-submit]').click();
      };
      await receive();
      await page.locator('[data-receive-stock-status]').filter({hasNotText:'Receiving stock...'}).waitFor();
      const stockCalls = () => calls.filter(c => c.name==='control_cashier_stock');
      assert.equal(stockCalls().length,1);
      assert.ok(!Object.hasOwn(stockCalls()[0].args.p_input,'p_cost_per_unit'));
      assert.equal(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('Synthetic retry reference')),false);
      await page.reload();
      await page.getByText('Fixture Beans',{exact:true}).first().waitFor();
      await receive();
      await page.getByText(/received for Fixture Beans/).waitFor();
      assert.equal(stockCalls().length,2);
      assert.equal(stockCalls()[0].args.p_request_id,stockCalls()[1].args.p_request_id);
      assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('curv-control-cashier:stock:')).length),0);
      for (const target of ['index','menu-manager','customers','recipes','team','attendance']) {
        await page.goto(origin+'/admin/'+target+'.html');
        await page.waitForURL(origin+'/admin/incoming-orders.html');
      }
      await page.goto(origin+'/admin/pos.html');
      await page.getByText('You don’t have permission to perform this POS action.').waitFor();
      assert.equal(await page.locator('#workspace').isHidden(),true);
      assert.ok(!calls.some(c=>c.name.startsWith('customer_admin_') || c.name.startsWith('inventory_recipes')));
    } finally { await context.close(); }

    const unauthorized=await session(browser,'denied');
    try {
      await unauthorized.page.goto(origin+'/admin/incoming-orders.html');
      await unauthorized.page.locator('[data-order-list]').getByRole('heading',{name:'Access denied'}).waitFor();
      assert.equal(await unauthorized.page.locator('[data-owner-account-label]').textContent(),'Access denied');
      assert.ok(!unauthorized.calls.some(c=>c.kind==='table'&&c.name==='orders'));
      await unauthorized.page.goto(origin+'/admin/index.html');
      await unauthorized.page.locator('[data-owner-account-label]').getByText('Access denied',{exact:true}).waitFor();
      await unauthorized.page.goto(origin+'/admin/inventory.html');
      await unauthorized.page.getByText('Access denied. This account is not authorized for Inventory.').waitFor();
    } finally { await unauthorized.context.close(); }
  } finally { await browser.close(); }
});

function holdAccess() {
  let release;
  const result = new Promise(resolve=>{release=resolve;});
  return {result,release};
}

async function withBrowser(run) {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try { await run(browser); } finally { await browser.close(); }
}

async function until(predicate) {
  for (let i=0; i<200 && !predicate(); i++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(predicate(),'Expected fixture activity did not occur');
}



function inventoryFixtureRead(name, identity, ok) {
  const stock = inventory.stock.map(item => ({ ...item, item_name: identity.uid + ' stock' }));
  const movements = [{
    movement_id:id(44), item_id:id(4), item_name:stock[0].item_name, unit_abbreviation:'g',
    movement_type:'stock_in', quantity:2, reference_text:identity.uid + ' movement',
    created_at:new Date().toISOString(),
  }];
  switch (name) {
    case 'inventory_stock_summary': return ok(stock);
    case 'inventory_categories': return ok(inventory.categories);
    case 'inventory_units': return ok(inventory.units);
    case 'inventory_movement_log':
    case 'control_cashier_movements': return ok(movements);
    case 'control_cashier_inventory': return ok({ ...inventory, stock });
  }
}

function inventoryPageState(page, { role, uid, event, fields = [] } = {}) {
  return page.evaluate(({ role, uid, event, fields }) => {
    if (role) window.setFixtureAccount(role, uid, event);
    const text = selector => document.querySelector(selector).textContent.trim();
    return {
      stock: text('[data-inventory-list]'),
      movements: text('[data-movement-list]'),
      drawerOpen: !document.querySelector('[data-inventory-drawer-layer]').hidden,
      drawersVisible: document.querySelectorAll('[data-inventory-drawer]:not([hidden])').length,
      actionsDisabled: document.querySelector('[data-inventory-drawer-open="receive-stock"]').disabled,
      values: fields.map(selector => document.querySelector(selector).value),
      drawerStatus: [...document.querySelectorAll('[data-inventory-drawer] .inventory-form-status')]
        .map(node => node.textContent.trim()).filter(Boolean),
      openingSummary: text('[data-opening-balance-confirm-summary]'),
      countSummary: text('[data-count-stock-confirm-summary]'),
    };
  }, { role, uid, event, fields });
}

async function waitForInventory(page, uid) {
  await page.locator('[data-inventory-list]').getByText(uid + ' stock', {exact:true}).waitFor();
  await page.locator('[data-movement-list]').getByText(uid + ' movement', {exact:true}).waitFor();
}

function assertClearedInventory(state, values = []) {
  assert.deepEqual(state, {
    stock:'', movements:'', drawerOpen:false, drawersVisible:0, actionsDisabled:true,
    values, drawerStatus:[], openingSummary:'', countSummary:'',
  });
}

test('Inventory clears history and Receive Stock drafts before account verification', async () => {
  await withBrowser(async browser => {
    let gate;
    const {context,page,calls} = await session(browser,'owner',{
      readInventory:inventoryFixtureRead,
      checkAccess:(identity,ok)=>gate?.uid===identity.uid ? gate.result : ok(identity.role),
    });
    const fields = ['#receive-stock-reference','#receive-stock-cost','#receive-stock-notes'];
    const empty = fields.map(()=>'');
    const waitForAccess = (uid, after) =>
      until(()=>calls.slice(after).some(call=>call.name==='curv_control_access'&&call.identity?.uid===uid));
    try {
      await page.goto(origin+'/admin/inventory.html');
      for (const role of ['cashier','denied','signed-out']) {
        await waitForInventory(page,'synthetic-owner');
        await page.locator('[data-inventory-drawer-open="receive-stock"]').first().click();
        await page.locator(fields[0]).fill('Private owner reference');
        await page.locator(fields[1]).fill('12.34');
        await page.locator(fields[2]).fill('Private owner note');
        if (role==='cashier') {
          gate = {...holdAccess(),uid:'synthetic-owner'};
          const after = calls.length;
          const responsesBefore = await page.evaluate(()=>window.fixtureInventoryResponses.length);
          const sameOwner = await inventoryPageState(page,{role:'owner',event:'TOKEN_REFRESHED',fields});
          assert.deepEqual(sameOwner.values,['Private owner reference','12.34','Private owner note']);
          assert.ok(sameOwner.drawerOpen && sameOwner.movements.includes('synthetic-owner movement'));
          await waitForAccess(gate.uid,after);
          gate.release({data:'owner',error:null});
          await page.waitForFunction(({after})=>window.fixtureInventoryResponses
            .slice(after).some(response=>response.name==='curv_control_access'&&response.uid==='synthetic-owner'),
          {after:responsesBefore});
          assert.deepEqual(await inventoryPageState(page,{fields}),sameOwner);
        }
        const uid = 'synthetic-'+role;
        gate = {...holdAccess(),uid};
        const after = calls.length;
        assertClearedInventory(await inventoryPageState(page,{
          role,uid,event:role==='signed-out'?'SIGNED_OUT':'SIGNED_IN',fields,
        }),empty);
        if (role!=='signed-out') {
          await waitForAccess(uid,after);
          assertClearedInventory(await inventoryPageState(page,{fields}),empty);
        }
        gate.release({data:role,error:null});
        if (role==='cashier') {
          await waitForInventory(page,uid);
          await page.locator('[data-inventory-drawer-open="receive-stock"]').first().click();
          assert.deepEqual((await inventoryPageState(page,{fields})).values,empty);
          await page.locator(fields[0]).fill('Cashier draft');
          gate = {...holdAccess(),uid:'synthetic-owner'};
          const beforeOwner = calls.length;
          assertClearedInventory(await inventoryPageState(page,{role:'owner',fields}),empty);
          await waitForAccess(gate.uid,beforeOwner);
          assertClearedInventory(await inventoryPageState(page,{fields}),empty);
          gate.release({data:'owner',error:null});
        } else {
          await page.locator('[data-owner-account-label]').getByText(role==='denied'?'Access denied':'Sign in',{exact:true}).waitFor();
          assertClearedInventory(await inventoryPageState(page,{fields}),empty);
          await page.evaluate(()=>window.setFixtureAccount('owner'));
        }
      }
      await waitForInventory(page,'synthetic-owner');
    } finally { gate?.release(); await context.close(); }
  });
});

test('Inventory clears other operation drawers, validation and pending confirmations on sign-out', async () => {
  await withBrowser(async browser => {
    const {context,page} = await session(browser,'owner',{readInventory:inventoryFixtureRead});
    try {
      await page.goto(origin+'/admin/inventory.html');
      for (const [drawer,field] of [
        ['add-item','#add-item-name'],['use-stock','#use-stock-notes'],['record-waste','#record-waste-notes'],
        ['opening-balance','#opening-balance-batch-ref'],['count-stock','#count-stock-notes'],
      ]) {
        await waitForInventory(page,'synthetic-owner');
        await page.locator('[data-inventory-drawer-open="'+drawer+'"]').first().click();
        const fieldInput = page.locator(field);
        await fieldInput.fill('Private '+drawer+' draft');
        const operation = page.locator('[data-inventory-drawer="'+drawer+'"]');
        if (drawer==='opening-balance' || drawer==='count-stock') {
          await operation.locator('#'+drawer+'-item').selectOption(id(4));
          await operation.locator('#'+drawer+'-quantity').fill('2');
          await operation.locator('[data-'+drawer+'-submit]').click();
          await operation.locator('[data-'+drawer+'-confirm]').waitFor();
          assert.match(await operation.locator('[data-'+drawer+'-confirm-summary]').textContent(),/synthetic-owner stock/);
        } else {
          await operation.locator('form').dispatchEvent('submit');
          await operation.locator('.inventory-form-status').waitFor();
        }
        assertClearedInventory(await inventoryPageState(page,{
          role:'signed-out',event:'SIGNED_OUT',fields:[field],
        }),['']);
        await page.evaluate(()=>window.setFixtureAccount('owner'));
      }
      await waitForInventory(page,'synthetic-owner');
    } finally { await context.close(); }
  });
});

test('Inventory rejects late stock, movement and role responses across rapid account switches', async () => {
  await withBrowser(async browser => {
    const stock = holdAccess();
    const movements = holdAccess();
    const cashierAccess = holdAccess();
    const held = { inventory_stock_summary:stock, inventory_movement_log:movements };
    const {context,page,calls} = await session(browser,'owner',{
      readInventory:(name,identity,ok)=>{
        const value = inventoryFixtureRead(name,identity,ok);
        return identity.uid==='synthetic-owner' && held[name] ? held[name].result.then(()=>value) : value;
      },
      checkAccess:(identity,ok)=>identity.uid==='synthetic-cashier' ? cashierAccess.result : ok(identity.role),
    });
    const delivered = (name,uid) => page.waitForFunction(({name,uid})=>
      window.fixtureInventoryResponses.some(result=>result.name===name&&result.uid===uid),{name,uid});
    try {
      await page.goto(origin+'/admin/inventory.html');
      await until(()=>Object.keys(held).every(name=>
        calls.some(call=>call.name===name&&call.identity?.uid==='synthetic-owner')));
      assertClearedInventory(await inventoryPageState(page,{role:'cashier'}));
      await until(()=>calls.some(call=>call.name==='curv_control_access'&&call.identity?.uid==='synthetic-cashier'));
      movements.release();
      await delivered('inventory_movement_log','synthetic-owner');
      assertClearedInventory(await inventoryPageState(page));

      await page.evaluate(()=>{
        window.setFixtureAccount('denied','synthetic-skipped');
        window.setFixtureAccount('owner','synthetic-final');
      });
      await waitForInventory(page,'synthetic-final');
      stock.release();
      cashierAccess.release({data:'cashier',error:null});
      await delivered('inventory_stock_summary','synthetic-owner');
      await delivered('curv_control_access','synthetic-cashier');
      const final = await inventoryPageState(page);
      assert.match(final.stock,/synthetic-final stock/);
      assert.match(final.movements,/synthetic-final movement/);
      assert.doesNotMatch(final.stock + final.movements,/synthetic-owner/);
      assert.equal(final.actionsDisabled,false);
      assert.ok(!calls.some(call=>['control_cashier_inventory','control_cashier_movements'].includes(call.name)));
      assert.ok(!calls.some(call=>call.name.startsWith('inventory_')&&call.identity?.uid==='synthetic-skipped'));
    } finally { stock.release(); movements.release(); cashierAccess.release(); await context.close(); }
  });
});

test('owner notifications leave no customer payload in browser storage and authorize cross-page navigation', async () => {
  await withBrowser(async browser=>{
    let gate;
    const uid='synthetic-owner';
    const targetKey='curvIncomingOrdersOpenId:'+uid;
    const {context,page,calls} = await session(browser,'owner',{
      checkAccess: (identity,ok)=>gate?.uid===identity.uid ? gate.result : ok(identity.role),
    });
    try {
      const bell=page.getByRole('button',{name:'Notifications',exact:true});
      const panel=page.locator('#incoming-order-notification-panel');
      const label=page.locator('[data-owner-account-label]');
      const notify=()=>page.evaluate(({order,uid})=>window.curvHandleIncomingOrderDetected(order,uid),{order:openOrder,uid});
      const storageHasCustomer=()=>page.evaluate(guest=>
        [sessionStorage,localStorage].some(storage=>JSON.stringify(storage).includes(guest)),openOrder.customer_name);
      const waitForAccess=(id,after)=>until(()=>calls.slice(after).some(call=>call.name==='curv_control_access'&&call.identity?.uid===id));
      const goToOwnerDashboard=async()=>{
        const after=calls.length;
        await page.goto(origin+'/admin/index.html');
        await label.getByText('Owner',{exact:true}).waitFor();
        await until(()=>calls.slice(after).some(call=>call.name==='incoming-orders-nav-badge'));
      };

      await goToOwnerDashboard();
      await notify();
      await bell.click();
      await panel.getByText(openOrder.customer_name,{exact:true}).waitFor();
      assert.equal(await storageHasCustomer(),false);
      gate={uid,...holdAccess()};
      let after=calls.length;
      await panel.getByRole('button',{name:new RegExp(openOrder.order_number)}).click();
      await page.waitForURL(origin+'/admin/incoming-orders.html');
      await waitForAccess(uid,after);
      assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),targetKey),openOrder.id);
      assert.equal(await page.evaluate(id=>window.curvGetIncomingOrderNotificationTarget(id),uid),null);
      assert.equal(calls.slice(after).some(call=>call.kind==='table'&&call.name==='orders'),false);
      assert.equal(await storageHasCustomer(),false);
      gate.release({data:'owner',error:null});
      gate=null;
      const order=page.locator('[data-order-id="'+openOrder.id+'"]');
      await order.getByText('Preparation',{exact:true}).waitFor();
      assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),targetKey),null);
      await notify();

      // Simulate an account change between documents, with caches left by the old release.
      await page.evaluate(({order,uid,targetKey})=>{
        for (const storage of [sessionStorage,localStorage]) {
          for (const prefix of ['curvIncomingOrdersUnseen','curvIncomingOrdersUnseenSummaries','curvIncomingOrdersNotificationTarget']) {
            storage.setItem(prefix,order.customer_name);
            storage.setItem(prefix+':'+uid,JSON.stringify({customerName:order.customer_name,id:order.id}));
          }
        }
        sessionStorage.setItem(targetKey,order.id);
        window.setFixtureAccount('denied','synthetic-denied',null);
      },{order:openOrder,uid,targetKey});
      gate={uid:'synthetic-denied',...holdAccess()};
      after=calls.length;
      await page.reload();
      await waitForAccess('synthetic-denied',after);
      await bell.click();
      assert.equal(await panel.isHidden(),true);
      assert.equal(await panel.locator('.notification-item').count(),0);
      assert.equal(await storageHasCustomer(),false);
      assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),targetKey),null);
      assert.equal(await page.evaluate(id=>window.curvGetIncomingOrderNotificationTarget(id),uid),null);
      gate.release({data:'denied',error:null});
      gate=null;
      await label.getByText('Access denied',{exact:true}).waitFor();

      for (const event of ['TOKEN_REFRESHED','SIGNED_OUT']) {
        after=calls.length;
        await page.evaluate(()=>window.setFixtureAccount('owner'));
        await until(()=>calls.slice(after).some(call=>call.name==='incoming-orders-nav-badge'));
        await notify();
        await bell.click();
        await panel.getByText(openOrder.customer_name,{exact:true}).waitFor();
        if (event==='TOKEN_REFRESHED') {
          await page.evaluate(()=>window.setFixtureAccount('denied','synthetic-owner','TOKEN_REFRESHED'));
          await panel.waitFor({state:'hidden'});
        } else {
          const hidden=await page.evaluate(()=>{
            window.setFixtureAccount('signed-out','', 'SIGNED_OUT');
            return document.querySelector('#incoming-order-notification-panel').hidden;
          });
          assert.equal(hidden,true);
        }
        assert.equal(await panel.locator('.notification-item').count(),0);
        assert.equal(await storageHasCustomer(),false);
      }
    } finally { gate?.release({data:'denied',error:null}); await context.close(); }
  });
});


test('legacy notification cleanup removes every scoped and unscoped key in both storage areas', async () => {
  await withBrowser(async browser=>{
    const {context,page,calls}=await session(browser,'owner');
    const prefixes=['curvIncomingOrdersUnseen','curvIncomingOrdersUnseenSummaries','curvIncomingOrdersNotificationTarget'];
    const ownerUid='synthetic-owner';
    const soundKey='curvIncomingOrdersSoundEnabled';
    const unrelated={
      'fixture-retained-left':'first value',
      'curvIncomingOrdersUnseenArchive':'unrelated lookalike',
      'fixture-retained-right':'last value',
    };
    const readStorage=()=>page.evaluate(({prefixes,unrelated,soundKey,customer,orderNumber})=>
      Object.fromEntries(['sessionStorage','localStorage'].map(name=>{
        const storage=window[name];
        return [name,{
          legacyKeys:Object.keys(storage).filter(key=>prefixes.some(prefix=>key===prefix||key.startsWith(prefix+':'))),
          hasPreviousPayload:[customer,orderNumber].some(value=>JSON.stringify(storage).includes(value)),
          unrelated:Object.fromEntries(Object.keys(unrelated).map(key=>[key,storage.getItem(key)])),
          sound:storage.getItem(soundKey),
        }];
      })),{prefixes,unrelated,soundKey,customer:openOrder.customer_name,orderNumber:openOrder.order_number});
    const cleanStorage={
      sessionStorage:{legacyKeys:[],hasPreviousPayload:false,unrelated,sound:null},
      localStorage:{legacyKeys:[],hasPreviousPayload:false,unrelated,sound:'false'},
    };
    const observations=[];
    try {
      await page.goto(origin+'/admin/incoming-orders.html');
      await page.locator('[data-owner-account-label]').getByText('Owner',{exact:true}).waitFor();
      for (const [role,reverse] of [['denied',false],['cashier',true]]) {
        await page.evaluate(({prefixes,ownerUid,order,unrelated,soundKey,role,reverse})=>{
          const summary={[order.id]:{id:order.id,customerName:order.customer_name,orderNumber:order.order_number,amount:order.total}};
          const payloads=[[order.id],summary,{key:order.id,id:order.id,status:'submitted'}];
          const retained=Object.entries(unrelated);
          for (const [name,storage] of [['sessionStorage',sessionStorage],['localStorage',localStorage]]) {
            const entries=prefixes.flatMap((prefix,index)=>[
              [prefix,JSON.stringify(payloads[index])],
              [retained[index][0],retained[index][1]],
              [prefix+':'+ownerUid,JSON.stringify(payloads[index])],
              [prefix+':synthetic-previous-owner',JSON.stringify(payloads[index])],
            ]);
            if (reverse !== (name==='localStorage')) entries.reverse();
            for (const [key] of entries) storage.removeItem(key);
            for (const [key,value] of entries) storage.setItem(key,value);
          }
          localStorage.setItem(soundKey,'false');
          sessionStorage.setItem('curvIncomingOrdersOpenId:'+ownerUid,order.id);
          sessionStorage.setItem('curvIncomingOrdersOpenId:synthetic-'+role,order.id);
          window.setFixtureAccount(role,'synthetic-'+role,null);
        },{prefixes,ownerUid,order:openOrder,unrelated,soundKey,role,reverse});

        const before=calls.length;
        await page.reload();
        const label=role==='cashier'?'Cashier':'Access denied';
        await page.locator('[data-owner-account-label]').getByText(label,{exact:true}).waitFor();
        await page.waitForFunction(()=>!Object.keys(sessionStorage).some(key=>key.startsWith('curvIncomingOrdersOpenId:')));
        observations.push(await readStorage());
        assert.equal(await page.evaluate(uid=>window.curvGetIncomingOrderNotificationTarget(uid),ownerUid),null);
        assert.equal(await page.evaluate(uid=>window.curvGetIncomingOrderNotificationTarget(uid),'synthetic-'+role),null);
        assert.equal(await page.locator('#incoming-order-notification-panel .notification-item').count(),0);
        assert.ok(!calls.slice(before).some(call=>call.kind==='table'&&call.name==='orders'
          || call.name==='control_cashier_orders'&&call.args?.p_order_id));
      }

      await page.reload();
      await page.locator('[data-owner-account-label]').getByText('Cashier',{exact:true}).waitFor();
      observations.push(await readStorage());
      assert.deepEqual(observations,[cleanStorage,cleanStorage,cleanStorage]);
    } finally { await context.close(); }
  });
});

test('Incoming Orders removes queue, detail, and history synchronously across account handoffs', async () => {
  await withBrowser(async browser=>{
    let gate;
    let pendingSummary;
    const owner='synthetic-owner';
    const {context,page,calls} = await session(browser,'owner',{
      checkAccess:(identity,ok)=>gate?.uid===identity.uid ? gate.result : ok(identity.role),
      holdOrderRead:(args,identity)=>identity.uid===owner && args.returning==='status,payment_status,total,currency,created_at'
        ? pendingSummary?.result : undefined,
    });
    try {
      const label=page.locator('[data-owner-account-label]');
      const bell=page.getByRole('button',{name:'Notifications',exact:true});
      const panel=page.locator('#incoming-order-notification-panel');
      const ticket=page.locator('[data-order-id="'+openOrder.id+'"]');
      const queue=page.locator('[data-order-list]');
      const search=page.locator('#order-search-input');
      const resultPanel=page.locator('#order-search-results');
      const waitForAccess=(uid,after)=>until(()=>calls.slice(after).some(call=>call.name==='curv_control_access'&&call.identity?.uid===uid));
      const expectImmediateClear=async(role,uid,event='SIGNED_IN')=>{
        const visible=await page.evaluate(({role,uid,event,guest,number,history})=>{
          window.setFixtureAccount(role,uid,event);
          const nodes=[...document.querySelectorAll('[data-order-list], [data-order-detail], [data-order-search-results], #incoming-order-notification-panel, [data-orders-auth-status]')];
          const text=nodes.map(node=>node.textContent).join(' ');
          return {
            containsPreviousOrder:[guest,number,history].some(value=>text.includes(value)),
            detailCount:document.querySelectorAll('[data-order-id], .notification-item').length,
            searchValue:document.querySelector('#order-search-input').value,
            searchDisabled:document.querySelector('#order-search-input').disabled,
            historyOpen:!document.querySelector('[data-order-history-filters]').hidden,
          };
        },{role,uid,event,guest:openOrder.customer_name,number:openOrder.order_number,history:historyOrder.order_number});
        assert.deepEqual(visible,{containsPreviousOrder:false,detailCount:0,searchValue:'',searchDisabled:true,historyOpen:false});
      };
      const openViaNotification=async()=>{
        await page.evaluate(({order,owner})=>window.curvHandleIncomingOrderDetected(order,owner),{order:openOrder,owner});
        await bell.click();
        await panel.getByRole('button',{name:new RegExp(openOrder.order_number)}).click();
        await ticket.getByText('Preparation',{exact:true}).waitFor();
      };

      await page.goto(origin+'/admin/incoming-orders.html');
      await label.getByText('Owner',{exact:true}).waitFor();
      await until(()=>calls.some(call=>call.name==='incoming-orders-nav-badge'));
      await until(()=>calls.some(call=>call.name==='incoming-orders-admin'));
      await page.locator('[data-order-history-toggle]').click();
      await page.locator('[data-order-filter="completed"]').click();
      await queue.getByText(historyOrder.order_number,{exact:true}).first().waitFor();
      await openViaNotification();
      await search.fill(historyOrder.order_number);
      await resultPanel.getByText(historyOrder.order_number,{exact:true}).waitFor();

      pendingSummary=holdAccess();
      let after=calls.length;
      await page.evaluate(order=>window.fixtureOrderRealtime({new:order}),openOrder);
      await until(()=>calls.slice(after).some(call=>call.name==='orders'&&call.args?.returning==='status,payment_status,total,currency,created_at'));
      gate={uid:'synthetic-denied',...holdAccess()};
      after=calls.length;
      await expectImmediateClear('denied','synthetic-denied');
      await waitForAccess('synthetic-denied',after);
      pendingSummary.release();
      pendingSummary=null;
      await bell.click();
      assert.equal(await ticket.count(),0);
      assert.equal(await panel.isHidden(),true);
      assert.equal(await resultPanel.locator('[role="option"]').count(),0);
      assert.equal(await page.locator('[data-order-filter-count="active"]').first().textContent(),'0');
      assert.ok(calls.slice(after).some(call=>call.kind==='removed-channel'&&call.name==='incoming-orders-admin'));
      assert.ok(!calls.slice(after).some(call=>call.kind==='table'&&call.name==='orders'));
      gate.release({data:'denied',error:null});
      gate=null;
      await label.getByText('Access denied',{exact:true}).waitFor();

      after=calls.length;
      await page.evaluate(()=>window.setFixtureAccount('owner'));
      await until(()=>calls.slice(after).some(call=>call.name==='incoming-orders-nav-badge'));
      await openViaNotification();
      const staleOwner={uid:owner,...holdAccess()};
      gate=staleOwner;
      after=calls.length;
      await page.evaluate(()=>window.setFixtureAccount('owner','synthetic-owner','TOKEN_REFRESHED'));
      await waitForAccess(owner,after);

      gate={uid:'synthetic-cashier',...holdAccess()};
      after=calls.length;
      await expectImmediateClear('cashier','synthetic-cashier');
      await waitForAccess('synthetic-cashier',after);
      staleOwner.release({data:'owner',error:null});
      assert.equal(await ticket.count(),0);
      gate.release({data:'cashier',error:null});
      gate=null;
      await label.getByText('Cashier',{exact:true}).waitFor();
      await ticket.locator('.order-ticket-summary').click();
      await ticket.getByText('Preparation',{exact:true}).waitFor();
      assert.equal(await panel.locator('.notification-item').count(),0);
      assert.ok(calls.slice(after).some(call=>call.name==='control_cashier_orders'));

      gate={uid:owner,...holdAccess()};
      after=calls.length;
      await expectImmediateClear('owner',owner);
      await waitForAccess(owner,after);
      assert.equal(await ticket.count(),0);
      gate.release({data:'owner',error:null});
      gate=null;
      await label.getByText('Owner',{exact:true}).waitFor();
      await ticket.locator('.order-ticket-summary').waitFor();
      await page.locator('[data-order-history-toggle]').click();
      await page.locator('[data-order-filter="completed"]').click();
      await queue.getByText(historyOrder.order_number,{exact:true}).first().waitFor();

      // Losing the owner role for the same UID also clears loaded history.
      await page.evaluate(()=>window.setFixtureAccount('denied','synthetic-owner','TOKEN_REFRESHED'));
      await label.getByText('Access denied',{exact:true}).waitFor();
      assert.equal(await queue.locator('[data-order-id]').count(),0);
      assert.equal(await resultPanel.locator('[role="option"]').count(),0);
    } finally {
      pendingSummary?.release();
      gate?.release({data:'denied',error:null});
      await context.close();
    }
  });
});

test('stale owner Accept preserves cashier Preparing and reports a conflict', async () => {
  await withBrowser(async browser=>{
    const orders=structuredClone([openOrder]);
    const owner=await session(browser,'owner',{orders});
    const cashier=await session(browser,'cashier',{orders});
    try {
      const openTicket = async page => {
        const ticket=page.locator('[data-order-id="'+openOrder.id+'"]');
        await ticket.locator('.order-ticket-summary').click();
        return ticket;
      };
      const status=owner.page.locator('[data-orders-auth-status]');
      await owner.page.goto(origin+'/admin/incoming-orders.html');
      const stale=await openTicket(owner.page);
      await stale.getByRole('button',{name:'Accept',exact:true}).waitFor();
      await cashier.page.goto(origin+'/admin/incoming-orders.html');
      const current=await openTicket(cashier.page);
      await current.getByRole('button',{name:'Accept',exact:true}).click();
      await cashier.page.locator('[data-orders-auth-status]').getByText(/moved to accepted/).waitFor();
      await current.locator('.order-ticket-summary').click();
      await current.getByRole('button',{name:'Mark Preparing',exact:true}).click();
      await cashier.page.locator('[data-orders-auth-status]').getByText(/moved to preparing/).waitFor();

      await stale.getByRole('button',{name:'Accept',exact:true}).click();
      await status.getByText(/changed before your update/).waitFor();
      assert.equal(orders[0].status,'preparing');
      const writes=()=>owner.calls.filter(call=>call.name==='orders'&&call.args?.update);
      assert.equal(writes().length,1);
      assert.deepEqual(writes()[0].args.filters.map(({key,value})=>[key,value]),[['id',openOrder.id],['status','submitted']]);
      assert.doesNotMatch(await status.textContent(),/moved to accepted/);
      await stale.getByRole('button',{name:'Mark Ready',exact:true}).click();
      await status.getByText(/moved to ready/).waitFor();
      assert.equal(orders[0].status,'ready');
      assert.equal(writes().length,2);
    } finally { await owner.context.close(); await cashier.context.close(); }
  });
});

for (const [section,url] of [['Team','/admin/team.html'],['Attendance','/admin/attendance.html']]) {
  test(section+' direct URL waits for verified owner access and clears on revocation', async () => {
    await withBrowser(async browser=>{
      let gate=holdAccess();
      const checkAccess=()=>gate.result;
      const protectedRead=call=>call.name==='timekeeping_admin_list_staff'||call.name==='attendance_effective_sessions';
      const cashier=await session(browser,'cashier',{checkAccess});
      try {
        await cashier.page.goto(origin+url);
        if (section==='Attendance') await cashier.page.waitForURL(origin+'/admin/team.html#attendance');
        await until(()=>cashier.calls.some(call=>call.name==='curv_control_access'));
        assert.equal(cashier.calls.some(protectedRead),false);
        gate.release({data:'cashier',error:null});
        await cashier.page.waitForURL(origin+'/admin/incoming-orders.html');
        assert.equal(cashier.calls.some(protectedRead),false);
      } finally { gate.release({data:'denied',error:null}); await cashier.context.close(); }

      gate=holdAccess();
      const owner=await session(browser,'owner',{checkAccess});
      try {
        await owner.page.goto(origin+url);
        if (section==='Attendance') await owner.page.waitForURL(origin+'/admin/team.html#attendance');
        await until(()=>owner.calls.some(call=>call.name==='curv_control_access'));
        const content=owner.page.locator(section==='Team'?'[data-team-content]':'[data-attendance-content]');
        assert.equal(await content.isHidden(),true);
        assert.equal(owner.calls.some(protectedRead),false);
        gate.release({data:'owner',error:null});
        await content.waitFor({state:'visible'});
        const expected=section==='Team'?'timekeeping_admin_list_staff':'attendance_effective_sessions';
        assert.ok(owner.calls.some(call=>call.name===expected));

        gate=holdAccess();
        const before=owner.calls.length;
        await owner.page.evaluate(()=>window.setFixtureAccount('owner','synthetic-owner','TOKEN_REFRESHED'));
        await until(()=>owner.calls.slice(before).some(call=>call.name==='curv_control_access'));
        gate.release({data:null,error:{message:'Synthetic authorization failure'}});
        await content.waitFor({state:'hidden'});
        assert.equal(owner.calls.slice(before).some(protectedRead),false);
        if (section==='Team') await owner.page.locator('[data-team-status]').getByText(/Owner access is required/).waitFor();
      } finally { gate.release({data:'denied',error:null}); await owner.context.close(); }
    });
  });
}
