// Offline UI + actual SQL + real popup documents. window.print is stubbed:
// these checks prove rendering/recovery, never physical printer output.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const {kitchenFixture}=require('./pos-kitchen-fixture.cjs');
const {buildTicketHtml}=require('../admin/pos-kitchen.js');
const root=path.resolve(__dirname,'..');
(async()=>{
  const f=await kitchenFixture();const browser=await chromium.launch({channel:process.env.CURV_BROWSER_CHANNEL||'msedge',headless:true});
  let checks=0,lose=null;const ok=(v,label)=>{assert.ok(v,label);checks++;};
  const totals=async()=> (await f.db.query(`select
    (select count(*)::int from pos_kitchen_submissions) as tickets,
    (select count(*)::int from pos_kitchen_instructions) as lines,
    (select max(pos_revision)::int from orders where source='pos') as revision`)).rows[0];
  try{
    const longName='Long kitchen product '+('extra-long-name-'.repeat(14))+' <script>bad()</script>';
    const longOption='Long modifier '+('milk-'.repeat(35))+' <img src=x onerror=bad()>';
    await f.db.query('update products set name=$1',[longName]);await f.db.query('update option_choices set label=$1',[longOption]);
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.exposeBinding('fixtureRpc',async(_source,name,args)=>{
      const result=await f.rpc(name,args);if(name===lose&&!result.error){lose=null;return {error:{message:'Lost after commit'}};}return result;
    });
    await context.addInitScript(({user})=>{
      window.print=()=>{window.printRequests=(window.printRequests||0)+1;};
      window.supabase={createClient:()=>({rpc:(n,a)=>window.fixtureRpc(n,a),auth:{getSession:async()=>({data:{session:{user:{id:user}}}}),onAuthStateChange:()=>{},signOut:async()=>({})}})};
    },{user:f.id(2)});
    await context.route('**/*',route=>{
      const u=new URL(route.request().url());const files=['pos.html','pos.js','pos.css','admin.css','pos-kitchen.js'];
      const name=u.pathname.split('/').pop();
      if(u.origin==='https://curv.test'&&u.pathname==='/admin/'+name&&files.includes(name))return route.fulfill({path:path.join(root,'admin',name)});
      return route.abort();
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://curv.test/admin/pos.html');await page.getByText('Ready to take orders.').waitFor();
    await page.locator('#products button').click();await page.locator('#quantity').fill('2');
    await page.locator('#item-note').fill('No ice <img src=x onerror=bad()> & wrap '+('note '.repeat(25)));
    await page.locator('#save-item').click();await page.locator('.kitchen-marker').waitFor();
    ok(await page.locator('.kitchen-marker').innerText()==='NEW','new marker');
    ok(await page.locator('#send-kitchen').isEnabled(),'pending send enabled');
    lose='pos_send_kitchen';await page.locator('#send-kitchen').click();await page.locator('#recovery').waitFor();
    ok((await totals()).tickets===1,'lost send response committed one ticket');
    ok(await page.locator('#send-kitchen').isDisabled(),'uncertainty blocks send');
    await page.reload();await page.locator('#recovery').waitFor();
    let popupPromise=page.waitForEvent('popup');await page.locator('#retry').click();let popup=await popupPromise;
    await popup.getByText('TICKET #1',{exact:true}).waitFor();await page.getByText('✓ ALL ITEMS SENT',{exact:true}).waitFor();
    ok((await totals()).tickets===1,'reload retry reopens original ticket');
    ok(await page.locator('.kitchen-marker').innerText()==='✓ SENT'&&await page.locator('#send-kitchen').isDisabled(),'sent state and no pending button');
    ok((await popup.locator('main').innerText()).includes(longName),'long product text retained');
    ok((await popup.locator('main').innerText()).includes(longOption),'long option text retained');
    ok(await popup.locator('main script, main img').count()===0,'dynamic HTML escaped');
    ok(!(await popup.locator('main').innerText()).includes('₱')&&!/subtotal|payment method/i.test(await popup.locator('main').innerText()),'no prices or payment fields');
    await popup.emulateMedia({media:'print'});
    ok(await popup.locator('.controls').isHidden(),'print controls omitted from paper');
    ok(await popup.evaluate(()=>document.body.scrollWidth<=document.body.clientWidth+1),'long content wraps within 52mm');
    ok(await popup.evaluate(()=>Math.abs(document.body.getBoundingClientRect().width-52*96/25.4)<1),'52mm content width');
    const proof=path.join(root,'node_modules','.pos-printer-proof');fs.mkdirSync(proof,{recursive:true});
    await popup.screenshot({path:path.join(proof,'initial-ticket.png'),fullPage:true});
    const firstId=(await f.rpc('pos_get_order',{p_order_id:(await f.rpc('pos_list_open_orders')).data[0].id})).data.kitchen.last_submission_id;
    const firstSnapshot=(await f.rpc('pos_get_kitchen_ticket',{p_submission_id:firstId})).data;
    const html=buildTicketHtml({...firstSnapshot,submitted_at:'2026-09-16T10:42:00Z'});
    ok(html.includes('6:42')&&html.includes('PM'),'Manila-local time');
    ok(html.includes('size:58mm auto')&&html.includes('&lt;script&gt;bad()&lt;/script&gt;'),'58mm page and escape contract');
    await popup.close(); // Models a closed/canceled print view; no business state acknowledges paper.
    const beforeReprint=await totals();popupPromise=page.waitForEvent('popup');await page.locator('#reprint-kitchen').click();popup=await popupPromise;
    await popup.getByText('TICKET #1',{exact:true}).waitFor();assert.deepEqual(await totals(),beforeReprint);checks++;await popup.close();
    await page.locator('#products button').click();await page.locator('#save-item').click();
    await page.waitForFunction(()=>document.querySelectorAll('.kitchen-marker').length===2);
    ok((await page.locator('.kitchen-marker').allTextContents()).join(',')==='✓ SENT,NEW','only add-on pending');
    popupPromise=page.waitForEvent('popup');await page.locator('#send-kitchen').click();popup=await popupPromise;
    await popup.getByText('TICKET #2',{exact:true}).waitFor();ok(await popup.locator('.instruction').count()===1,'add-on prints only delta');await popup.close();
    await page.getByRole('button',{name:'Edit quantity / note'}).first().click();await page.locator('#quantity').fill('1');await page.locator('#save-item').click();
    await page.getByText('CANCEL PENDING',{exact:true}).waitFor();
    popupPromise=page.waitForEvent('popup');await page.locator('#send-kitchen').click();popup=await popupPromise;
    await popup.locator('.cancel').waitFor();ok((await popup.locator('.cancel').innerText()).startsWith('CANCEL\n1x'),'cancel is unmistakable delta');await popup.close();
    await page.getByRole('button',{name:'Edit quantity / note'}).first().click();await page.locator('#item-note').fill('New preparation');await page.locator('#save-item').click();
    await page.getByText('CHANGED',{exact:true}).waitFor();
    // Stale send: serialized local rejection, not a true concurrent-session test.
    let current=(await f.rpc('pos_get_order',{p_order_id:firstSnapshot.order_id})).data;
    await f.rpc('pos_update_header',{p_key:f.id(9900),p_order_id:current.id,p_revision:current.revision,p_customer:'Other device',p_type:'pickup',p_note:'Table changed'});
    const beforeStale=await totals();await page.locator('#send-kitchen').click();await page.getByText(/This order changed on another device/).waitFor();
    assert.deepEqual(await totals(),beforeStale);checks++;
    popupPromise=page.waitForEvent('popup');await page.locator('#send-kitchen').click();popup=await popupPromise;
    await popup.locator('.change').waitFor();ok((await popup.locator('.change').innerText()).includes('PREVIOUS PREPARATION')&&(await popup.locator('.change').innerText()).includes('REPLACE WITH'),'change includes before and after');
    await popup.screenshot({path:path.join(proof,'change-ticket.png'),fullPage:true});await popup.close();
    assert.deepEqual((await f.rpc('pos_get_kitchen_ticket',{p_submission_id:firstId})).data,firstSnapshot);checks++;
    await page.reload();await page.getByText('Ready to take orders.').waitFor();
    ok(await page.locator('#send-kitchen').isDisabled()&&(await page.locator('.kitchen-marker').allTextContents()).every(s=>s==='✓ SENT'),'refresh restores authoritative state');
    await page.getByRole('button',{name:'Edit quantity / note'}).first().click();await page.locator('#item-note').fill('After hold');await page.locator('#save-item').click();await page.getByText('CHANGED',{exact:true}).waitFor();
    await page.locator('#hold').click();await page.locator('#resume').waitFor();ok(await page.locator('#send-kitchen').isDisabled(),'held send disabled');
    await page.locator('#resume').click();await page.locator('#hold').waitFor();ok(await page.locator('#send-kitchen').isEnabled(),'resume retains pending kitchen update');
    await page.evaluate(()=>{window.open=()=>null;});await page.locator('#send-kitchen').click();
    await page.getByText('Kitchen ticket saved. Allow pop-ups and use Reprint Last Ticket to open it.').waitFor();
    ok(await page.locator('#send-kitchen').isDisabled(),'popup failure does not undo logical send');
    await page.setViewportSize({width:390,height:844});ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page wraps long content');
    ok(errors.length===0,'no browser exceptions: '+errors.join(';'));
    console.log(checks+' offline kitchen UI/renderer/recovery checks passed; physical print NOT tested.');
  }finally{await browser.close();await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
