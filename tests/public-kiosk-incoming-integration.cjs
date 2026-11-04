// Protected kiosk contract -> actual persisted SQL -> unchanged independent Incoming Orders.
// Browser Auth/read transport mocked. Real Auth/PostgREST is a separate maintained suite.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const repoRoot=process.env.CURV_KIOSK_REPO_ROOT||path.resolve(__dirname,'..');
const {v2Fixture,id,query}=require(path.join(repoRoot,'tests/public-submission-v2-fixture.cjs'));
const root=repoRoot,sourceRoot=process.env.CURV_KIOSK_SOURCE_ROOT||root,origin='https://curv.test';
const clone=x=>JSON.parse(JSON.stringify(x));
(async()=>{const {db}=await v2Fixture();let browser;const contexts=[],evidence={adminReads:[],adminWrites:[]};let assertions=0;
const check=(g,x,m)=>{assert.ok(x,m);assertions++;};const equal=(g,a,b,m)=>{assert.deepEqual(a,b,m);assertions++;};
const quoteIdentifier=x=>'"'+x.replaceAll('"','""')+'"';const q=(s,p=[])=>query(db,s,p);
  async function adminRead(spec) {
    evidence.adminReads.push(clone(spec));
    const allowed = ['orders', 'order_items', 'order_delivery_snapshots', 'order_courier_confirmations', 'admin_profiles'];
    if (!allowed.includes(spec.table)) return { data: [], error: null };
    if (spec.write) { evidence.adminWrites.push(spec); return { data: null, error: { code: '42501', message: 'Read-only integration fixture' } }; }
    try {
      const columns = spec.columns === '*' ? '*' : spec.columns.split(',').map(quoteIdentifier).join(',');
      let rows = await q('select ' + columns + ' from public.' + quoteIdentifier(spec.table));
      // Filtering follows server semantics, including columns absent from the projection.
      const complete = await q('select * from public.' + quoteIdentifier(spec.table));
      rows = rows.filter((_, index) => spec.filters.every(([kind, column, value]) => {
        const actual = complete[index][column];
        return kind === 'eq' ? actual === value : kind === 'in' ? value.includes(actual) : true;
      }));
      // Intentionally malformed REST projection for the missing-financial-field negative case.
      if (spec.omitPayment && spec.table === 'orders') rows = rows.map(({ payment_status, ...rest }) => rest);
      return { data: spec.single ? (rows[0] || null) : rows, count: rows.length, error: null };
    } catch (error) {
      return { data: null, error: { code: error.code, message: error.message } };
    }
  }


  async function openAdmin(order, { omitPayment = false } = {}) {
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('adminRead', spec => adminRead({ ...spec, omitPayment }));
    await page.addInitScript(() => {
      window.adminQueryLog = [];
      const chain = table => {
        const spec = { table, columns: '*', filters: [], single: false, write: false };
        let proxy;
        proxy = new Proxy({}, { get: (_, key) => {
          if (key === 'then') return (resolve, reject) => { adminQueryLog.push(structuredClone(spec)); return adminRead(spec).then(resolve, reject); };
          return (...args) => {
            if (key === 'select') spec.columns = args[0];
            if (['eq', 'in'].includes(key)) spec.filters.push([key, ...args]);
            if (['single', 'maybeSingle'].includes(key)) spec.single = true;
            if (['insert', 'update', 'delete', 'upsert'].includes(key)) spec.write = true;
            return proxy;
          };
        } }); return proxy;
      };
      const channel = { on() { return this; }, subscribe() { return this; }, unsubscribe() {} };
      window.supabase = { createClient: () => ({ from: chain,
        rpc: async () => ({ data: { website_ordering_enabled: true }, error: null }),
        channel: () => channel, removeChannel: async () => {},
        auth: { getSession: async () => ({ data: { session: { user: { id: 'independent-fixture-owner', email: 'owner@example.test' } } } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) }
      }) };
      sessionStorage.setItem('integration-admin-sentinel', 'admin-only');
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && ['/admin/incoming-orders.html', '/admin/admin.js', '/admin/admin.css', '/admin/delivery-navigation.js', '/admin/delivery-courier.js'].includes(url.pathname)) {
        return route.fulfill({ path: path.join(root, url.pathname.slice(1)) });
      }
      return route.abort();
    });
    await page.goto(origin + '/admin/incoming-orders.html');
    const card = page.locator('[data-order-list] [data-order-id="' + order.id + '"]');
    await card.waitFor(); await card.locator('.order-ticket-summary').click();
    await card.getByText('Simple sushi', { exact: true }).waitFor();
    return { page, card, errors };
  }

async function call(user,name,args=[]){await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:user===id(1)?id(910001):id(910000)})]);await db.exec('set role authenticated');try{return (await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args))[0].r;}finally{await db.exec('reset role');}}
try{
 await db.exec("create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;grant execute on function auth.jwt() to authenticated;");
 await q('insert into auth.sessions values($1,$2),($3,$4)',[id(910000),id(3),id(910001),id(1)]);
 for(const file of ['KIOSK_V2_SCHEMA.sql','KIOSK_V2_BACKEND.sql'])await db.exec(fs.readFileSync(path.join(sourceRoot,'admin',file),'utf8'));
 await call(id(1),'kiosk_owner_mode',['on']);await call(id(1),'kiosk_owner_device',[id(3),true,new Date(Date.now()+3600000).toISOString(),false]);
 browser=await chromium.launch({channel:'msedge',headless:true});let last;
 for(const [index,type] of ['dine_in','pickup'].entries()){
  const begun=await call(id(3),'kiosk_begin');
  const p={kiosk_contract_version:1,submission_key:id(920000+index),customer_name:'Integration Guest',fulfillment_type:type,customer_notes:'Integration order note',items:[{product_id:id(1000),product_size_id:id(1100),option_choice_ids:[],quantity:2,item_note:'Integration item note'}]};
  const quoted=await call(id(3),'kiosk_quote',[begun.generation_id,JSON.stringify(p)]);p.review_fingerprint=quoted.quote.review_fingerprint;
  await call(id(3),'kiosk_admit',[begun.generation_id,JSON.stringify(p)]);const accepted=await call(id(3),'kiosk_submit',[begun.generation_id,p.submission_key]);
  equal('receipt',Object.keys(accepted.receipt),['order_number'],'no tracking bearer token to customer');
  const order=(await q('select * from orders where order_number=$1',[accepted.receipt.order_number]))[0];last=order;
  equal('handoff',order.fulfillment_type,type,'exact fulfillment persisted');equal('handoff',order.customer_phone,'','phone-free pickup and dine-in');equal('handoff',order.payment_method,'counter','counter only');equal('handoff',order.payment_status,'unpaid','unpaid');equal('handoff',Number(order.total),20.2,'authoritative total');
  const item=(await q('select * from order_items where order_id=$1',[order.id]))[0];equal('snapshot',item.product_name,'Simple sushi','server label');equal('snapshot',Number(item.unit_price),10.1,'server unit price');equal('snapshot',item.quantity,2,'quantity');
  const shown=await openAdmin(order);const text=await shown.card.textContent();
  check('admin',text.includes(order.order_number)&&text.includes('Integration Guest'),'Incoming Orders shows actual nickname and number');check('admin',text.includes('Integration item note')&&text.includes('Integration order note'),'item and order notes');check('admin',/20\.20/.test(text),'recorded total');
  check('admin',await shown.card.getByRole('button',{name:'Accept',exact:true}).isEnabled(),'normal status workflow available');check('admin',await shown.card.getByRole('button',{name:'Mark as Paid',exact:true}).isEnabled(),'explicit staff payment workflow preserved');equal('admin',await shown.card.getByRole('button',{name:'Save courier fee',exact:true}).count(),0,'no courier workflow invented');
  await shown.page.context().close();
  const closed=await call(id(3),'kiosk_close',[begun.generation_id,false]);equal('privacy',closed.state,'closed','customer closure verified');const old=await call(id(3),'kiosk_recover',[begun.generation_id,p.submission_key]);equal('privacy',old,{state:'closed'},'closed generation has no receipt');
 }
 // Two P5-only malformed-projection checks are held separately with their failing baseline evidence.
 equal('writes',evidence.adminWrites.length,0,'presentation performs no writes');
 console.log(assertions+' protected kiosk-to-Incoming integration assertions passed; actual disposable SQL, admin source unchanged.');
}finally{for(const c of contexts)await c.close().catch(()=>{});if(browser)await browser.close();await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
