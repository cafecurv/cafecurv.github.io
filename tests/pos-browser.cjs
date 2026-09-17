// Offline browser + actual embedded SQL integration, including response loss.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./pos-database.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const f=await fixture();const browser=await chromium.launch({channel:process.env.CURV_BROWSER_CHANNEL||'msedge',headless:true});
  let lose=null,checks=0;const ok=(v,label)=>{assert.ok(v,label);checks++;};
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});const pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(e.message));
    await page.exposeFunction('fixtureRpc',async(name,args)=>{
      const result=await f.rpc(name,args);
      if(name===lose&&!result.error){lose=null;return {error:{message:'Failed to fetch'}};}
      return result;
    });
    await page.addInitScript(({user})=>{
      window.supabase={createClient:()=>({rpc:(name,args)=>window.fixtureRpc(name,args),auth:{
        getSession:async()=>({data:{session:{user:{id:user}}}}),onAuthStateChange:()=>{},
        signOut:async()=>({}),signInWithPassword:async()=>({data:{session:{user:{id:user}}}})
      }})};
    },{user:f.id(2)});
    await page.route('**/*',route=>{
      const u=new URL(route.request().url());
      const files={'/admin/pos.html':'admin/pos.html','/admin/pos.js':'admin/pos.js','/admin/pos.css':'admin/pos.css','/admin/admin.css':'admin/admin.css'};
      if(u.origin==='https://curv.test'&&files[u.pathname])return route.fulfill({path:path.join(root,files[u.pathname])});
      return route.abort();
    });
    await page.goto('https://curv.test/admin/pos.html');await page.getByText('Ready to take orders.').waitFor();
    ok(await page.locator('#owner-link').isHidden(),'cashier has no owner navigation');
    await page.locator('#customer').fill('UI Customer');
    await page.locator('#products button').click();await page.locator('#item-note').fill('No ice');
    lose='pos_create_order';await page.locator('#save-item').click();await page.locator('#recovery').waitFor();
    ok((await f.db.query(`select count(*)::int n from orders where source='pos'`)).rows[0].n===1,'lost create response committed once');
    ok(await page.locator('#save-item').isDisabled(),'uncertain request blocks duplicate click');
    await page.reload();await page.locator('#recovery').waitFor();await page.locator('#retry').click();
    await page.waitForFunction(()=>document.getElementById('order-number').textContent.startsWith('C-')&&document.getElementById('recovery').hidden);
    ok((await f.db.query(`select count(*)::int n from orders where source='pos'`)).rows[0].n===1,'reload + retry keeps one order');
    ok((await page.locator('#items').innerText()).includes('No ice'),'first note survives');
    await page.locator('#products button').click();lose='pos_add_item';await page.locator('#save-item').click();await page.locator('#recovery').waitFor();
    await page.locator('#retry').click();await page.waitForFunction(()=>document.querySelectorAll('.pos-line').length===2&&document.getElementById('recovery').hidden);
    ok((await f.db.query(`select count(*)::int n from order_items`)).rows[0].n===2,'add retry keeps two lines');
    await page.getByRole('button',{name:'Edit quantity / note'}).first().click();
    await page.locator('#quantity').fill('3');await page.locator('#item-note').fill('Less sweet');await page.locator('#save-item').click();
    await page.waitForFunction(()=>document.querySelector('.pos-line strong').textContent.startsWith('3'));
    ok((await page.locator('#items').innerText()).includes('Less sweet'),'edit saved');
    // Another device changes header. The stale UI must reject its own update.
    let current=(await f.rpc('pos_list_open_orders')).data[0];
    await f.rpc('pos_update_header',{p_key:f.id(701),p_order_id:current.id,p_revision:current.revision,p_customer:'Other device',p_type:'pickup',p_note:''});
    await page.locator('#customer').fill('Proposed name');await page.locator('#save-header').click();
    await page.getByText(/This order changed on another device/).waitFor();
    ok(await page.locator('#customer').inputValue()==='Proposed name','stale header proposal preserved');
    await page.locator('#save-header').click();await page.getByText('Order saved.',{exact:true}).waitFor();
    await page.locator('#hold').click();await page.locator('#resume').waitFor();
    ok(await page.locator('#customer').isDisabled(),'held order edits disabled');
    await page.locator('#new-order').click();await page.locator('#open-orders').click();await page.locator('#open-list button').click();
    await page.locator('#resume').click();await page.locator('#hold').waitFor();
    await page.reload();await page.getByText('Ready to take orders.').waitFor();
    ok(await page.locator('.pos-line').count()===2,'server order survives reload');
    await page.setViewportSize({width:390,height:844});
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile no horizontal overflow');
    ok(!(await page.locator('body').innerText()).includes('Mark paid'),'no financial action');
    ok(pageErrors.length===0,'no browser exceptions: '+pageErrors.join(';'));
    console.log(checks+' offline POS browser/SQL checks passed.');
  }finally{await browser.close();await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
