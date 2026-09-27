// Offline UI contract tests. All network requests intercepted; no live Supabase.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname,'..');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 let count=0; const check=(v,m)=>{assert.ok(v,m);count++;};
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   const malicious='<script>alert(1)</script>';
   window.calls=[];window.pending=[];window.config={empty:true,hold:{},error:{}};
   let session={user:{id:'owner'},access_token:'first'};const listeners=[];
   window.switchSession=(id)=>{session=id?{user:{id},access_token:id}:null;listeners.forEach(fn=>fn('SIGNED_IN',session));};
   const customers=Array.from({length:26},(_,i)=>({customer_id:'c'+i,latest_name:i===1?'':i===0?malicious:'Contact '+i,
     normalized_phone:'+639171234567',latest_delivery_address:'LongAddress'.repeat(45),first_order_at:'2026-01-01',last_order_at:'2026-09-28',created_at:'2026-01-01',
     submitted_order_count:21,completed_order_count:1,repeat_customer:i!==1}));
   window.customersFixture=customers;
   const rpc=async(name,args={})=>{
     if(!name.startsWith('customer_admin_'))return {data:[],error:null};
     const call={name,args};window.calls.push(call);
     let data;
     if(name==='customer_admin_list'){
       let rows=window.config.empty?[]:customers;
       if(args.p_search==='missing')rows=[];
       data={customers:rows.slice(args.p_offset,args.p_offset+args.p_limit),offset:args.p_offset,limit:args.p_limit,total_count:rows.length,has_more:args.p_offset+args.p_limit<rows.length};
     }else if(name==='customer_admin_detail'){
       const orders=Array.from({length:21},(_,i)=>({order_id:'o'+i,order_number:'C-'+i,created_at:'2026-09-28',status:i===0?'cancelled':'completed',fulfillment_type:'delivery',payment_method:'gcash',payment_status:'unpaid',total:160,
         customer_name:'Historical Name',customer_phone:'09170000000',delivery_address:null}));
       data={customer:customers.find(c=>c.customer_id===args.p_customer_id),orders:orders.slice(args.p_offset,args.p_offset+args.p_limit),offset:args.p_offset,total_count:21,has_more:args.p_offset===0};
     }else data={items:[{product_name:malicious,category_name:'Saved category',variant_label:'Large',quantity:2,unit_price:80,line_total:160,options:{Option:malicious},item_note:malicious}]};
     const error=window.config.error[name];delete window.config.error[name];
     if(window.config.hold[name]) await new Promise(resolve=>window.pending.push({name,args,resolve}));
     return {data:error?null:data,error};
   };
   const chain=new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>Promise.resolve({data:[],count:0,error:null}).then(resolve):()=>chain});
   window.supabase={createClient:()=>({rpc,from:()=>chain,channel:()=>chain,removeChannel:async()=>{},auth:{
     getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{listeners.push(fn);return {data:{subscription:{unsubscribe(){}}}};},
     signOut:async()=>{window.switchSession(null);return {};},signInWithPassword:async()=>({data:{session}})
   }})};
 });
 await page.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.origin==='https://curv.test'&&['/admin/customers.html','/admin/customers.js','/admin/admin.js','/admin/admin.css'].includes(u.pathname)) return route.fulfill({path:path.join(root,u.pathname.slice(1))});
   return route.abort();
 });
 const calls=()=>page.evaluate(()=>window.calls);
 const last=async()=> (await calls()).at(-1);
 const ready=()=>page.waitForFunction(()=>document.querySelector('#customer-list')?.getAttribute('aria-busy')==='false');
 const refresh=async()=>{await page.click('#customers-refresh');await ready();};
 try {
  await page.goto('https://curv.test/admin/customers.html');await page.getByText('No customer records yet.').waitFor();
  check(await page.locator('#customers-locked').isHidden(),'authorized empty state');
  check((await page.locator('#customer-list').innerText()).includes('once they’re linked'),'empty explains linkage');
  for(const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:900});
    const boxes=await page.evaluate(()=>{
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,height:r.height};};
      return {search:rect('#customer-search'),sort:rect('#customer-sort'),refresh:rect('#customers-refresh'),chips:[...document.querySelectorAll('[data-customer-filter]')].map(n=>n.getBoundingClientRect().height),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    check(!boxes.overflow,'toolbar overflow '+width);
    check([boxes.search,boxes.sort,boxes.refresh].every(b=>Math.abs(b.height-44)<1),'44px controls '+width);
    check(Math.abs(boxes.sort.top-boxes.refresh.top)<1,'Sort/Refresh baseline '+width);
    check(width<601||Math.abs(boxes.search.top-boxes.sort.top)<1,'desktop search baseline '+width);
    check(boxes.chips.every(h=>Math.abs(h-44)<1),'chip heights '+width);
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'curv-polish-'+width+'.png')});
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(require('node:os').tmpdir(),'curv-customers-empty.png')});
  check(await page.locator('.admin-nav [data-nav-item="incoming-orders"] + [data-nav-item="customers"]').count()===1,'desktop placement');
  await page.click('.mobile-more-button');await page.locator('.mobile-more-list a[href="customers.html"]').waitFor();check(await page.locator('.mobile-more-list a[href="customers.html"]').isVisible(),'mobile More');await page.click('[data-more-close].mobile-more-close');await page.locator('.mobile-more-list a[href="customers.html"]').waitFor({state:'hidden'});
  await page.evaluate(()=>window.config.empty=false);await refresh();
  check(await page.locator('.customer-card').count()===25,'bounded first page');
  await page.screenshot({path:path.join(require('node:os').tmpdir(),'curv-customers-list.png')});
  check(await page.getByRole('heading',{name:'Name unavailable'}).count()===1,'blank fallback');
  check(await page.locator('.customer-repeat').count()===24,'server repeat flags');
  check((await page.locator('.customer-card').first().innerText()).includes('21 submitted orders'),'server counts');
  check(await page.locator('.customer-card script').count()===0,'name escaped');
  check(await page.locator('#customer-list-pages button').first().isDisabled(),'previous disabled');
  await page.locator('#customer-list-pages button').last().click();await ready();
  check((await last()).args.p_offset===25,'list next offset');check(await page.locator('.customer-card').count()===1,'last page');
  check(await page.locator('#customer-list-pages button').last().isDisabled(),'has_more honored');
  await page.fill('#customer-search','first');await page.fill('#customer-search','final search');
  await page.waitForTimeout(450);await ready();
  check((await last()).args.p_search==='final search'&&(await last()).args.p_offset===0,'search server/reset');
  check((await calls()).filter(c=>c.args.p_search==='first').length===0,'debounce');
  for(const f of ['repeat','one_time','all']){await page.click(`[data-customer-filter="${f}"]`);await ready();check((await last()).args.p_filter===f&&(await last()).args.p_offset===0,'filter '+f);}
  for(const s of ['most_orders','newest','oldest','recent']){await page.selectOption('#customer-sort',s);await ready();check((await last()).args.p_sort===s&&(await last()).args.p_offset===0,'sort '+s);}
  check(page.url()==='https://curv.test/admin/customers.html','no URL PII');
  await page.fill('#customer-search','missing');await page.getByText('No customers match your search.').waitFor();check(true,'distinct no matches');
  // The older held response must not overwrite a newer completed search.
  await page.evaluate(()=>window.config.hold.customer_admin_list=true);
  await page.fill('#customer-search','old request');await page.waitForFunction(()=>window.pending.length===1);
  await page.evaluate(()=>window.config.hold.customer_admin_list=false);
  await page.fill('#customer-search','missing');await page.getByText('No customers match your search.').waitFor();
  await page.evaluate(()=>window.pending.shift().resolve());await page.waitForTimeout(50);
  check(await page.getByText('No customers match your search.').isVisible(),'stale list discarded');
  await page.fill('#customer-search','');await page.waitForTimeout(450);await ready();
  await page.locator('.customer-card').first().click();await page.getByText('First linked order',{exact:true}).waitFor();
  check(await page.getByText('Unverified contact record grouped by submitted phone number.').isVisible(),'unverified note');
  check(await page.locator('#customer-detail').getByText('Only linked website orders are shown. Earlier orders were not backfilled.').isVisible(),'historical limitation');
  check(await page.locator('.customer-order').count()===20,'history page limit');
  check(await page.locator('.customer-order').first().getByText('Historical Name',{exact:true}).isVisible(),'name snapshot');
  check(await page.locator('.customer-order').first().getByText('09170000000',{exact:true}).isVisible(),'phone snapshot');
  check(await page.locator('.customer-order').first().getByText('Unavailable',{exact:true}).isVisible(),'null address never substituted');
  check((await calls()).filter(c=>c.name==='customer_admin_order_items').length===0,'items lazy');
  await page.locator('.customer-items summary').first().click();await page.locator('.customer-item').first().waitFor();
  check((await last()).args.p_customer_id==='c0'&&(await last()).args.p_order_id==='o0','both identifiers');
  check((await page.locator('.customer-item').first().innerText()).includes('2 × <script>alert(1)</script>'),'item snapshots as text');
  check((await page.locator('.customer-item').first().innerText()).includes('Option: <script>alert(1)</script>'),'options as text');
  check(await page.locator('#customer-detail script').count()===0,'no injected script');
  const n=(await calls()).length;await page.locator('.customer-items summary').first().click();await page.locator('.customer-items summary').first().click();await page.waitForTimeout(50);check((await calls()).length===n,'item cache');
  await page.evaluate(()=>window.config.error.customer_admin_order_items={code:'P0002'});
  await page.locator('.customer-items summary').nth(1).click();await page.getByText('Could not load saved items').waitFor();check(true,'item error');
  await page.locator('.customer-items').nth(1).getByRole('button',{name:'Retry'}).click();await page.locator('.customer-items').nth(1).locator('.customer-item').waitFor();
  check(true,'item retry');
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:900});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scroll '+width);
    await page.evaluate(()=>scrollTo(0,0));
    if(width===390||width===1280) await page.screenshot({path:path.join(require('node:os').tmpdir(),'curv-customers-'+width+'.png'),fullPage:false});
  }
  await page.click('[data-admin-theme-toggle]');check(await page.locator('html').getAttribute('data-admin-theme')==='light','theme');await page.screenshot({path:path.join(require('node:os').tmpdir(),'curv-customers-light.png')});
  await page.locator('#customer-detail .customer-pagination button').last().click();await page.waitForFunction(()=>document.querySelectorAll('.customer-order').length===1);
  check((await last()).args.p_offset===20&&(await last()).args.p_customer_id==='c0','history pagination retains customer');
  await page.click('#customers-back');check(await page.locator('.customer-card').count()===25,'back keeps list');
  await page.fill('#customer-search','preserved');await page.waitForTimeout(450);await ready();
  await page.selectOption('#customer-sort','oldest');await ready();await page.click('[data-customer-filter="repeat"]');await ready();
  await page.locator('#customer-list-pages button').last().click();await ready();await page.locator('.customer-card').first().click();await page.getByText('First linked order',{exact:true}).waitFor();await page.click('#customers-back');
  check(await page.inputValue('#customer-search')==='preserved'&&await page.inputValue('#customer-sort')==='oldest','back preserves search/sort');
  check(await page.locator('[data-customer-filter="repeat"]').getAttribute('aria-pressed')==='true'&&await page.locator('.customer-card').count()===1,'back preserves filter/page');
  // Network failure is retryable, not a false empty state.
  await page.evaluate(()=>window.config.error.customer_admin_list={code:'NETWORK'});await refresh();await page.getByText('Could not load customers',{exact:true}).waitFor();
  await page.locator('#customer-list').getByRole('button',{name:'Retry'}).click();await ready();check(await page.locator('.customer-card').count()===1,'list retry');
  await page.evaluate(()=>window.config.error.customer_admin_list={code:'42501'});await page.click('#customers-refresh');await page.locator('#customers-locked').waitFor();
  check(await page.locator('.customer-card').count()===0&&await page.locator('#customers-list-view').isHidden(),'authorization loss clears');
  await page.evaluate(()=>window.switchSession('nextOwner'));await ready();
  // Hold an item response across an account switch.
  await page.locator('.customer-card').first().click();await page.getByText('First linked order',{exact:true}).waitFor();
  await page.evaluate(()=>window.config.hold.customer_admin_order_items=true);await page.locator('.customer-items summary').first().click();await page.waitForFunction(()=>window.pending.length===1);
  await page.evaluate(()=>{window.config.empty=true;window.switchSession('thirdOwner');});await page.getByText('No customer records yet.').waitFor();
  await page.evaluate(()=>window.pending.shift().resolve());await page.waitForTimeout(50);
  check(await page.locator('.customer-item').count()===0&&await page.locator('.customer-summary').count()===0,'account change discards late items');
  await page.evaluate(()=>{window.config.empty=false;window.config.hold.customer_admin_list=true;});
  await page.click('#customers-refresh');await page.waitForFunction(()=>window.pending.length===1);
  await page.click('[data-owner-account-toggle]');await page.click('[data-sign-out]');
  await page.evaluate(()=>window.pending.shift().resolve());await page.waitForTimeout(50);
  check(await page.locator('.customer-card').count()===0&&await page.locator('#customers-list-view').isHidden(),'logout discards late list');
  check(await page.inputValue('#customer-search')==='','logout clears search');
  check(await page.evaluate(()=>![...Object.values(localStorage),...Object.values(sessionStorage)].some(v=>/Historical Name|LongAddress|639171234567|preserved/.test(v))),'no customer storage');
  check(await page.locator('[data-customers-page]').getByRole('button',{name:/^(Accept|Prepare|Complete|Cancel|Mark paid|Refund|Export|Delete|Edit)$/}).count()===0,'no mutations');
  await page.evaluate(()=>{window.config.hold={};window.config.error.customer_admin_list={code:'42501'};window.switchSession('nonOwner');});
  await page.waitForFunction(()=>document.querySelector('#customers-lock-message').textContent.includes('Owner access is required'));
  check(await page.locator('#customers-list-view').isHidden(),'non-owner locked');
  await page.evaluate(()=>{window.config.empty=false;window.switchSession('restoredOwner');});await ready();
  await page.evaluate(()=>window.config.hold.customer_admin_detail=true);
  await page.locator('.customer-card').first().click();await page.waitForFunction(()=>window.pending.length===1);
  await page.click('#customers-back');await page.evaluate(()=>window.config.hold.customer_admin_detail=false);
  await page.locator('.customer-card').nth(1).click();await page.getByText('First linked order',{exact:true}).waitFor();
  await page.evaluate(()=>window.pending.shift().resolve());await page.waitForTimeout(50);
  check(await page.locator('.customer-summary h2').textContent()==='Name unavailable','late previous detail discarded');
  const source=fs.readFileSync(path.join(root,'admin/customers.js'),'utf8');
  check(!/localStorage|sessionStorage|console\.|innerHTML|\.from\(/.test(source),'controller has no storage, logging, raw HTML or table reads');
  check([...source.matchAll(/read\('([^']+)'/g)].every(m=>['customer_admin_list','customer_admin_detail','customer_admin_order_items'].includes(m[1])),'only approved read contracts');
  check(errors.length===0,'no page errors: '+errors.join(';'));
  console.log(`${count} offline Customers UI assertions passed.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
