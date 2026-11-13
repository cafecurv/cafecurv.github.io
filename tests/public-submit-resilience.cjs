// Actual HTML, asset bootstrap and checkout; all network intercepted. No SQL.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = process.env.CURV_CHECKOUT_TEST_ROOT || path.resolve(__dirname, '..');
let n = 0;
const eq = (a,b,m) => { assert.deepEqual(a,b,m); n++; };
const ok = (v,m) => { assert.ok(v,m); n++; };
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  async function open() {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('curv-hto-seen','1');
      window.calls = [];
      window.fixtureSubtotal = "220.00";
      const realTimer = window.setTimeout; window.setTimeout = (fn,ms,...args) => realTimer(fn,ms===30000?100:ms,...args);
      window.testRpc = async (name,args) => {
        calls.push({name,args:structuredClone(args)});
        const request = args?.p_request;
        if (name === 'quote_public_cart') {
          const items = request.items;
          const merchandise = {pricing_contract_version:2,pricing_fingerprint_version:1,currency:'PHP',pricing_policy_version:'fixture',
            review_fingerprint:'a'.repeat(64),subtotal:fixtureSubtotal,delivery_fee:'60.00',final_total:(Number(fixtureSubtotal)+60).toFixed(2),items:items.map(i=>({...i,product_name:'Server item',size_label:'Each',category_name:'Food',
              unit_price:fixtureSubtotal,line_total:fixtureSubtotal,
              base_price:(Number(fixtureSubtotal)-(i.option_choice_ids.length?30:0)).toFixed(2),
              option_total:i.option_choice_ids.length?'30.00':'0.00',
              options:i.option_choice_ids.length?[{group_name:'Milk',label:'Soy milk',effective_price_delta:'30.00'}]:[]}))};
          return {data:{ok:true,quote:merchandise}};
        }
        if (name.startsWith('submit_public_order')) {
          return {data:{order_number:'C-TEST',tracking_token:'11111111-1111-4111-8111-111111111111',ok:true}};
        }
        return {data:{website_ordering_enabled:true}};
      };
    });
    await page.route('**/*',r => {
      const u = new URL(r.request().url());
      if (u.origin === 'https://curv.test' && ['/menu/','/menu/authoritative-checkout.js'].includes(u.pathname)) {
        return r.fulfill({path:path.join(root,u.pathname === '/menu/'?'menu/index.html':u.pathname.slice(1))});
      }
      return r.abort();
    });
    await page.goto('https://curv.test/menu/');
    await page.waitForFunction(()=>curvCheckoutBootstrap.status==='ready');
    await page.evaluate(()=>{
      publicMenuSupabaseClient={rpc:testRpc};window.supabase={createClient:()=>publicMenuSupabaseClient};
      isWebsiteOrderingEnabled=true;isPublicOrderTechnicalAvailable=true;
      document.querySelector('#f-name').value='Delivery Guest';document.querySelector('#f-contact').value='09171234567';
      document.querySelector('#f-delivery').value='delivery-curv-rider';document.querySelector('#f-payment').value='cod';
      syncOrderMethodFields();setDeliveryTime('asap');
      cart=[{key:'fixture',name:'Local item',price:1,qty:1,product_id:'00000000-0000-4000-8000-000000001000',product_size_id:'00000000-0000-4000-8000-000000001100',option_choice_ids:[],options:{}}];renderCart();
      document.querySelector('#formBody').style.display='block';
      toggleForm();
    });
    return page;
  }
  try {
    for (const [method, subtotal, allowed] of [
      ['delivery-curv-rider','199.99',false], ['delivery-curv-rider','200.00',true],
      ['delivery-lalamove','150.00',false], ['delivery-lalamove','200.00',true],
      ['pickup','100.00',true], ['dine-in','100.00',true]
    ]) {
      const p = await open();
      await p.evaluate(({method,subtotal})=>{
        window.fixtureSubtotal=subtotal;
        if (subtotal==='200.00') cart[0].option_choice_ids=['00000000-0000-4000-8000-000000002000'];
        document.querySelector('#f-delivery').value=method;
        document.querySelector('#f-address').value='Offline test address';
        syncOrderMethodFields();
      },{method,subtotal});
      await p.locator('#submitOrderBtn').click();
      if (allowed) {
        if (subtotal==='200.00') {
          await p.locator('#orderConfirmBody').getByText(/Soy milk/).waitFor();
          ok((await p.locator('#orderConfirmBody').textContent()).includes('Subtotal: ₱200.00'),'server-priced customization counts toward minimum');
        }
        await p.getByRole('button',{name:'Continue & Submit'}).click();
      }
      await p.waitForFunction(()=>!curvCheckout.state.busy);
      eq(await p.evaluate(()=>calls.map(c=>c.name)), allowed
        ? ['quote_public_cart','submit_public_order_v2'] : ['quote_public_cart'], method+' '+subtotal);
      if (!allowed) {
        ok((await p.locator('#submitOrderStatus').textContent()).includes(subtotal==='199.99'?'₱0.01':'₱50'), 'authoritative shortfall excludes fee');
        eq(await p.getByRole('button',{name:'Continue & Submit'}).count(),0,'blocked before confirmation');
        await p.locator('#f-delivery').selectOption('pickup');
        eq(await p.locator('#delivery-minimum').isVisible(),false,'switch to pickup hides notice');
        eq(await p.locator('#submitOrderStatus').textContent(),'','switch clears minimum error');
        await p.locator('#submitOrderBtn').click();
        await p.getByRole('button',{name:'Continue & Submit'}).click();
        await p.waitForFunction(()=>!curvCheckout.state.busy);
        eq(await p.evaluate(()=>calls.at(-1).args.p_request.payload.fulfillment_type),'pickup','pickup can submit below minimum');
      }
      await p.close();
    }
    {
      const p=await open();
      await p.setViewportSize({width:375,height:812});
      await p.evaluate(()=>{cart[0].price=100;renderCart();});
      const notice=p.locator('#delivery-minimum');
      ok((await notice.textContent()).includes('Minimum order: ₱200 (excluding delivery fee)'),'delivery minimum notice');
      const colors=[];
      for (const night of [false,true]) {
        await p.evaluate(night=>document.body.classList.toggle('night-mode',night),night);
        ok(await notice.evaluate(el=>{
          const r=el.getBoundingClientRect();
          return r.width>0&&r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;
        }),'mobile notice fits in both themes');
        colors.push(await notice.evaluate(el=>getComputedStyle(el).color));
      }
      ok(colors[0]!==colors[1],'notice color responds to night mode');
      ok((await p.locator('#delivery-minimum-remaining').textContent()).includes('₱100'),'one item shortfall');
      await p.locator('#cartItems').getByRole('button',{name:'+',exact:true}).click();
      eq(await p.locator('#delivery-minimum-remaining').textContent(),'','quantity reaches minimum');
      await p.locator('#cartItems').getByRole('button',{name:'−',exact:true}).click();
      ok((await p.locator('#delivery-minimum-remaining').textContent()).includes('₱100'),'quantity decrease restores shortfall');
      await p.close();
    }
    for (const method of ['delivery-curv-rider','pickup']) for (const payment of ['cod','gcash']) for (const remembered of [false,true]) for (const options of [false,true]) {
      const p=await open(); const errors=[];p.on('pageerror',e=>errors.push(e.message));
      await p.evaluate(({method,payment,remembered,options})=>{
        document.querySelector('#f-delivery').value=method;syncOrderMethodFields();setDeliveryTime('asap');
        document.querySelector('#f-payment').value=payment;document.querySelector('#f-address').value='Offline test address';
        if(remembered){document.querySelector('#remember-customer-details').checked=true;saveCustomerDetailsAfterSuccess(captureCustomerDetails());initializeCustomerDetails();}
        if(options)cart[0].option_choice_ids=['00000000-0000-4000-8000-000000002000'];
        renderCart();syncAnytimeOrderState();
      },{method,payment,remembered,options});
      await p.locator('#submitOrderBtn').click();
      await p.getByRole('button',{name:'Continue & Submit'}).click();
      await p.waitForFunction(()=>!curvCheckout.state.busy);
      const result=await p.evaluate(()=>({calls,status:document.querySelector('#submitOrderStatus').textContent,locked:isOrderSubmittedLocked,pending:curvCheckout.hasPending()}));
      eq(result.calls.map(c=>c.name),['quote_public_cart','submit_public_order_v2'],'only legacy quote and v2 submission');
      eq(result.locked,true,'accepted locks form');eq(result.pending,false,'accepted clears pending');eq(errors,[],'no page exception');
      ok(result.status.includes('Order received'),'success visible');
      ok(!JSON.stringify(result.calls[1]).includes('delivery_destination'),'no D1 pin payload');
      await p.close();
    }
    for (const fault of ['showOrderSuccessModal','renderRecentOrderReminder','clearPublicSubmissionState','localStorage']) {
      const p=await open(); await p.locator('#f-address').fill('Offline test address');
      await p.evaluate(fault=>{
        if(fault==='localStorage') { const set=Storage.prototype.setItem; Storage.prototype.setItem=function(...args){if(this===localStorage)throw Error('denied');return set.apply(this,args);}; }
        else window[fault]=()=>{throw Error('injected display failure');};
      },fault);
      await p.locator('#submitOrderBtn').click();await p.getByRole('button',{name:'Continue & Submit'}).click();await p.waitForFunction(()=>!curvCheckout.state.busy);
      const result=await p.evaluate(()=>({accepted:curvCheckout.state.accepted,locked:isOrderSubmittedLocked,status:document.querySelector('#submitOrderStatus').textContent,calls}));
      eq(result.locked,true,'accepted locked '+fault);ok(!!result.accepted,'accepted result retained');
      eq(result.accepted.submission_key,result.calls[1].args.p_request.payload.submission_key,'same accepted key');
      ok(!result.status.includes('try again'),'no false failure');
      if(fault!=='localStorage')ok(result.status.includes('couldn'), 'fallback visible');
      await p.evaluate(()=>submitPublicOrder());eq(await p.evaluate(()=>calls.length),2,'no duplicate network');await p.close();
    }
    for(const failure of ['network','uncertain','rejection','minimum','timeout','rpc-error']) {
      const p=await open();await p.locator('#f-address').fill('Offline test address');
      await p.evaluate(failure=>{
        const original=testRpc;
        publicMenuSupabaseClient.rpc=async(name,args)=>{
          if(!name.startsWith('submit_'))return original(name,args);
          calls.push({name,args:structuredClone(args)});
          if(failure==='timeout')return new Promise(()=>{});
          if(failure==='rpc-error')return {error:{code:'fixture',message:'private diagnostic'}};
          if(failure==='network')throw Error('lost response');
          if(failure==='minimum')return {data:{ok:false,error:{code:'DELIVERY_MINIMUM_NOT_MET'}}};
          return {data:failure==='uncertain'?{}:{error:{code:'ORDER_CART_INVALID'}}};
        };
      },failure);
      await p.locator('#submitOrderBtn').click();await p.getByRole('button',{name:'Continue & Submit'}).click();await p.waitForFunction(()=>!curvCheckout.state.busy);
      eq(await p.evaluate(()=>isOrderSubmittedLocked),false,'not falsely accepted');
      eq(await p.evaluate(()=>curvCheckout.hasPending()),true,'request retained');
      if(failure==='minimum') {
        const result=await p.evaluate(()=>({
          pending:JSON.parse(sessionStorage.getItem(curvCheckout.storageKey)),
          status:curvCheckout.state.status,
          calls:calls.map(c=>c.name)
        }));
        eq(result.pending.state,'validation','minimum rejection is definite');
        eq(result.status,'error','minimum rejection leaves reviewable error');
        eq(result.calls,['quote_public_cart','submit_public_order_v2'],'no automatic retry or duplicate submission');
        ok((await p.locator('#submitOrderStatus').textContent()).includes('Please update your cart'),'actionable minimum error');
        ok(!(await p.locator('#submitOrderBtn').textContent()).includes('Recover Previous Order'),'no uncertain recovery action');
        await p.evaluate(()=>updateQty('fixture',1));
        eq(await p.evaluate(()=>curvCheckout.hasPending()),false,'cart edit clears rejected attempt');
      } else if(failure!=='rejection') {
        const key=await p.evaluate(()=>calls[1].args.p_request.payload.submission_key);
        await p.evaluate(()=>{publicMenuSupabaseClient.rpc=testRpc;});
        await p.locator('#submitOrderBtn').click();await p.waitForFunction(()=>!curvCheckout.state.busy);
        eq(await p.evaluate(()=>calls.at(-1).args.p_request.payload.submission_key),key,'exact-key uncertain replay');
        eq(await p.evaluate(()=>isOrderSubmittedLocked),true,'recovery accepted');
      }
      await p.close();
    }
    const p=await open(); await p.locator('#f-address').fill('Offline test address');
    await p.evaluate(()=>{publicMenuSupabaseClient.rpc=()=>{throw Error('offline');};});
    await p.locator('#submitOrderBtn').click(); await p.waitForFunction(()=>!curvCheckout.state.busy);
    ok((await p.locator('#submitOrderStatus').textContent()).includes('Unable to check current prices'), 'offline quote fails closed');
    eq(await p.evaluate(()=>curvCheckout.hasPending()), false, 'offline quote creates no submission'); await p.close();
    console.log(n+' incident audit assertions passed; mocked RPC responses, all network intercepted, no SQL.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
