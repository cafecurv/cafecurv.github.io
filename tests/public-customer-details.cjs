// Offline C1A profile and real submission-path checks; no live requests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const html = fs.readFileSync(path.resolve(__dirname, '../menu/index.html'), 'utf8');
 const browser = await chromium.launch({ channel: 'msedge', headless: true });
 let count = 0;
 const check = (v, m) => { assert(v, m); count++; };
 const key = 'curv-customer-details-v1';
 const profile = { version: 1, name: '<b>Ana</b>', phone: '09171234567', address: '123 Example Street', fulfillment: 'delivery', deliveryOption: 'lalamove', payment: 'gcash', savedAt: new Date().toISOString() };
 async function open(seed, mode = '') {
  const page = await browser.newPage();
  await page.route('**/*', r => r.request().url() === 'https://curv.test/menu/' ? r.fulfill({ contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') }) : r.abort());
  await page.goto('https://curv.test/menu/');
  await page.evaluate(({seed, mode, key}) => {
   window.fetch = () => { throw Error('Live fetch forbidden'); };
   window.WebSocket = class { constructor() { throw Error('Live socket forbidden'); } };
   if (seed !== undefined) localStorage.setItem(key, seed);
   if (mode === 'read-fail') Storage.prototype.getItem = () => { throw Error('Storage denied'); };
   if (mode === 'prefilled') { document.getElementById('f-name').value = 'Manual name'; document.getElementById('f-delivery').value = 'pickup'; }
  }, { seed, mode, key });
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) await page.addScriptTag({ content: m[1] });
  await page.evaluate(() => {
   closeForm();
   window.val = id => document.getElementById(id);
   window.profileRead = () => JSON.parse(localStorage.getItem(CUSTOMER_DETAILS_KEY));
   window.prepare = () => {
    val('f-name').value = 'Ana'; val('f-contact').value = '09171234567'; val('f-address').value = '123 Example Street';
    val('f-delivery').value = 'delivery-lalamove'; val('f-payment').value = 'gcash'; syncOrderMethodFields();
    val('f-notes').value = 'Never remember this note';
    cart.length = 0; cart.push({key:'fixture',id:'fixture',name:'Fixture',variant:'Each',category_name:'Fixture',qty:1,price:150,options:{note:'Private item note'}});
    isWebsiteOrderingEnabled = true;
    confirmOrderBeforeSubmit = async () => true;
    // Time-of-day availability is covered by existing tests; make this fixture deterministic.
    getPreferredTimeValidationMessage = () => '';
    window.calls = [];
    window.resultMode = 'success';
    publicMenuSupabaseClient = { rpc: async (name, args) => {
      calls.push({name, payload: structuredClone(args.order_payload)});
      if (resultMode === 'failure') return {error:{message:'Offline fixture failure',code:'22023'}};
      if (resultMode === 'pending') return new Promise(resolve => { window.finishSubmission = resolve; });
      return {data:{order_number:'C-12345',tracking_token:'00000000-0000-4000-8000-000000000123'}};
    }};
    window.supabase = {createClient:()=>publicMenuSupabaseClient};
   };
  });
  return page;
 }
 try {
  let p = await open();
  check(await p.evaluate(() => !val('remember-customer-details').checked), 'default opt-out');
  await p.evaluate(async () => { prepare(); await submitPublicOrder(); });
  check(await p.evaluate(() => !profileRead() && isOrderSubmittedLocked), 'successful order without opt-in has no profile');
  await p.close();
  p = await open();
  await p.evaluate(async () => { prepare(); val('remember-customer-details').checked = true; resultMode='failure'; await submitPublicOrder(); });
  check(await p.evaluate(() => !profileRead() && !isOrderSubmittedLocked), 'failed submission never saves');
  await p.evaluate(async () => { resultMode='success'; await submitPublicOrder(); });
  let stored = await p.evaluate(() => profileRead());
  check(JSON.stringify(Object.keys(stored).sort()) === JSON.stringify(Object.keys(profile).sort()), 'strict field allowlist excludes cart/notes/tokens/keys/totals');
  check(stored.name === 'Ana' && stored.address === profile.address && stored.payment === 'gcash', 'successful opt-in saves reusable fields');
  check(await p.evaluate(() => calls[0].payload.submission_key === calls[1].payload.submission_key), 'validation retry keeps existing submission key');
  check(await p.evaluate(() => !('version' in calls[1].payload) && !('savedAt' in calls[1].payload) && !('remember' in calls[1].payload)), 'profile excluded from RPC payload');
  check(await p.evaluate(() => isOrderSubmittedLocked && !isSubmittingPublicOrder), 'success locking preserved');
  await p.close();
  p = await open(JSON.stringify(profile));
  if(process.env.CURV_PROFILE_SCREENSHOT) { await p.setViewportSize({width:390,height:844}); await p.evaluate(()=>{isWebsiteOrderingEnabled=true;toggleForm();}); await p.locator('#customer-details-memory').screenshot({path:process.env.CURV_PROFILE_SCREENSHOT}); }
  check(await p.evaluate(() => val('f-name').value === '<b>Ana</b>' && !val('f-name').querySelector('b')), 'prefill uses plain input values');
  check(await p.evaluate(() => val('f-contact').value === '09171234567' && val('f-address').value === '123 Example Street'), 'contact/address prefill');
  check(await p.evaluate(() => val('f-delivery').value === 'delivery-lalamove' && val('f-payment').value === 'gcash'), 'preferences prefill');
  check(await p.evaluate(() => val('remember-customer-details').checked && !val('forget-customer-details').hidden), 'remembered UI shown');
  await p.evaluate(() => { val('f-name').value='Edited'; initializeCustomerDetails(); });
  check(await p.evaluate(() => val('f-name').value === 'Edited'), 'reinitializing cannot overwrite edits');
  await p.evaluate(() => val('forget-customer-details').click());
  check(await p.evaluate(() => !profileRead() && !val('remember-customer-details').checked), 'forget removes and opts out');
  check(await p.evaluate(() => val('f-name').value === 'Edited' && val('f-address').value === '123 Example Street'), 'forget preserves form values');
  await p.evaluate(async () => { prepare(); await submitPublicOrder(); });
  check(await p.evaluate(() => !profileRead()), 'forgotten profile not recreated');
  await p.close();
  p = await open(JSON.stringify(profile));
  await p.evaluate(() => { val('remember-customer-details').checked=false; val('remember-customer-details').dispatchEvent(new Event('change')); });
  check(await p.evaluate(() => !profileRead()), 'unchecking removes immediately');
  await p.evaluate(async () => { prepare(); await submitPublicOrder(); });
  check(await p.evaluate(() => !profileRead()), 'unchecked success stays forgotten');
  await p.close();
  for (const seed of ['{broken', JSON.stringify({...profile,version:2}), JSON.stringify({...profile,name:'x'.repeat(201)})]) {
   p = await open(seed);
   check(await p.evaluate(() => !val('f-name').value && !val('remember-customer-details').checked), 'invalid stored profile ignored');
   await p.close();
  }
  p = await open(JSON.stringify({...profile,fulfillment:'unknown',payment:'paid',deliveryOption:'helicopter'}));
  check(await p.evaluate(() => val('f-delivery').value === 'dine-in' && val('f-payment').value === 'counter'), 'unknown enums ignored; dine-in still forces counter');
  await p.close();
  p = await open(JSON.stringify(profile),'prefilled');
  check(await p.evaluate(() => val('f-name').value === 'Manual name' && val('f-delivery').value === 'pickup'), 'existing autofill/manual fields preserved');
  await p.close();
  for (const mode of ['pickup','dine-in']) {
   p = await open(JSON.stringify(profile));
   await p.evaluate(mode => { prepare(); val('f-delivery').value=mode; syncOrderMethodFields(); },mode);
   check(await p.evaluate(() => !('delivery_address' in buildPublicOrderPayload())), mode+' omits address from payload');
   check(await p.evaluate(() => val('f-address').value === '123 Example Street'), mode+' preserves current address');
   if(mode==='dine-in') check(await p.evaluate(() => buildPublicOrderPayload().payment_method==='counter' && val('f-payment').disabled), 'dine-in overrides preference');
   await p.evaluate(async () => { await submitPublicOrder(); });
   check(await p.evaluate(() => profileRead().address === '123 Example Street' && profileRead().payment === 'gcash'), mode+' success preserves saved address/payment');
   await p.close();
  }
  p = await open(JSON.stringify(profile));
  await p.evaluate(() => { prepare(); for(const method of ['pickup','dine-in','delivery-lalamove']) {val('f-delivery').value=method;syncOrderMethodFields();} });
  check(await p.evaluate(() => buildPublicOrderPayload().delivery_address === '123 Example Street' && !val('f-address').disabled), 'switching back restores editable real address');
  check(await p.evaluate(() => !document.querySelector('[data-customer-type]') && buildMessage().includes('123 Example Street')), 'legacy shortcut removed including copied order');
  await p.evaluate(() => val('f-address').value='Returning customer');
  check(await p.evaluate(() => !!validatePublicOrderPayload(buildPublicOrderPayload())), 'literal legacy placeholder rejected');
  await p.close();
  for(const mode of ['read-fail','write-fail']) {
   p = await open(undefined,mode);
   await p.evaluate(async mode => { prepare();val('remember-customer-details').checked=true;if(mode==='write-fail') Storage.prototype.setItem=()=>{throw Error('Quota exceeded');};await submitPublicOrder(); },mode);
   check(await p.evaluate(() => isOrderSubmittedLocked && lastSubmittedPublicOrderSignature.length>0), mode+' never prevents successful order');
   await p.close();
  }
  p = await open();
  await p.evaluate(() => { prepare(); val('remember-customer-details').checked=true; resultMode='pending'; window.pendingSubmission=submitPublicOrder(); });
  await p.waitForFunction(() => !!window.finishSubmission);
  check(await p.evaluate(() => !profileRead()), 'no save while awaiting server confirmation');
  await p.evaluate(async () => { finishSubmission({data:{order_number:'C-12345',tracking_token:'00000000-0000-4000-8000-000000000123'}});await pendingSubmission; });
  check(await p.evaluate(() => !!profileRead()), 'save only after full confirmation');
  check(await p.evaluate(async () => {
   const payload=buildPublicOrderPayload();const signature=JSON.stringify(payload);const digest=await getPublicSubmissionSignatureDigest(signature);
   saveCustomerDetailsAfterSuccess(captureCustomerDetails());
   return signature===JSON.stringify(buildPublicOrderPayload()) && digest===await getPublicSubmissionSignatureDigest(JSON.stringify(buildPublicOrderPayload()));
  }), 'profile saving leaves payload/fingerprint unchanged');
  await p.close();
  p = await open();
  await p.evaluate(async () => { prepare(); val('remember-customer-details').checked=true; confirmOrderBeforeSubmit=async()=>false; await submitPublicOrder(); });
  check(await p.evaluate(() => !profileRead() && calls.length===0), 'canceled confirmation does not save or submit');
  await p.evaluate(async () => { confirmOrderBeforeSubmit=async()=>true; publicMenuSupabaseClient.rpc=async()=>({data:{order_number:'C-12345'}}); await submitPublicOrder(); });
  check(await p.evaluate(() => !profileRead() && !isOrderSubmittedLocked), 'incomplete server confirmation cannot save');
  await p.close();
  p = await open(JSON.stringify(profile));
  await p.evaluate(() => { Storage.prototype.removeItem=()=>{throw Error('Denied');}; val('forget-customer-details').click(); });
  check(await p.evaluate(() => !val('remember-customer-details').checked && val('customer-details-status').textContent.includes('could not remove')), 'failed removal reported honestly and disables remembering');
  await p.close();

  // Order-form cleanup: tracking is a read-only mock, never a live connection.
  p = await open(JSON.stringify(profile));
  await p.evaluate(() => {
    prepare(); calls.length=0;
    window.trackedOrder={order_number:'C-12345',status:'accepted'};
    window.trackingMode='success';
    publicMenuSupabaseClient.rpc=async(name,args)=>{
      calls.push({name,args});
      if(trackingMode==='throw') throw Error('Temporary network failure');
      if(trackingMode==='error') return {error:{message:'Temporary failure'}};
      if(trackingMode==='missing') return {data:[]};
      if(trackingMode==='pending') return new Promise(resolve=>{window.finishTracking=resolve;});
      return {data:[structuredClone(trackedOrder)]};
    };
    window.seedRecent=(age=0)=>saveLatestSubmittedOrder({...getSubmittedOrderInfo('C-12345','delivery',150,'00000000-0000-4000-8000-000000000123'),submittedAt:new Date(Date.now()-age).toISOString()});
    sessionStorage.setItem(PUBLIC_SUBMISSION_KEY_STORAGE_KEY,'preserved-key');
    sessionStorage.setItem(PUBLIC_SUBMISSION_SIGNATURE_STORAGE_KEY,'preserved-signature');
    sessionStorage.setItem(PUBLIC_SUBMISSION_FAILURE_STORAGE_KEY,'ambiguous');
    seedRecent();
  });
  await p.evaluate(()=>refreshRecentOrderReminder());
  check(await p.evaluate(()=>!val('recentOrderReminder').hidden && val('recentOrderReminder').textContent.includes('C-12345')), 'active recent order remains visible');
  const trackingUrl=await p.locator('#recentOrderReminder a').first().getAttribute('href');
  check(trackingUrl.includes('/track/?t='), 'active order retains original tracking shortcut');
  for(const status of ['completed','cancelled']) {
    await p.evaluate(async status=>{seedRecent();trackedOrder.status=status;await refreshRecentOrderReminder();},status);
    check(await p.evaluate(()=>!localStorage.getItem(RECENT_ORDER_STORAGE_KEY) && val('recentOrderReminder').hidden && !val('recentOrderReminder').innerHTML),status+' clears only local shortcut cleanly');
    check(await p.evaluate(()=>!!profileRead()),status+' preserves customer profile');
    check(await p.evaluate(()=>sessionStorage.getItem(PUBLIC_SUBMISSION_KEY_STORAGE_KEY)==='preserved-key' && sessionStorage.getItem(PUBLIC_SUBMISSION_SIGNATURE_STORAGE_KEY)==='preserved-signature' && sessionStorage.getItem(PUBLIC_SUBMISSION_FAILURE_STORAGE_KEY)==='ambiguous'),status+' preserves submission state');
    check(await p.evaluate(async url=>{const r=await publicMenuSupabaseClient.rpc('get_public_order_tracking',{p_tracking_token:new URL(url).searchParams.get('t')});return r.data[0].order_number==='C-12345' && getTrackingUrl(latestSubmittedOrder.trackingToken)===url;},trackingUrl),status+' leaves existing tracking URL and server fixture usable');
  }
  check(await p.evaluate(()=>calls.every(c=>c.name==='get_public_order_tracking')), 'lifecycle performs only tracking reads');
  await p.evaluate(()=>{seedRecent(24*60*60*1000+1);renderRecentOrderReminder();});
  check(await p.evaluate(()=>!localStorage.getItem(RECENT_ORDER_STORAGE_KEY) && val('recentOrderReminder').hidden), '24-hour-old reference expires');
  for(const mode of ['error','throw','missing']) {
    await p.evaluate(async mode=>{seedRecent();trackingMode=mode;await refreshRecentOrderReminder();},mode);
    check(await p.evaluate(()=>!!localStorage.getItem(RECENT_ORDER_STORAGE_KEY) && !val('recentOrderReminder').hidden),mode+' cannot erase nonexpired reference');
  }
  await p.evaluate(()=>{const info=getSubmittedOrderInfo('Legacy','pickup',1,'');delete info.submittedAt;localStorage.setItem(RECENT_ORDER_STORAGE_KEY,JSON.stringify(info));renderRecentOrderReminder();});
  check(await p.evaluate(()=>!!localStorage.getItem(RECENT_ORDER_STORAGE_KEY) && !loadLatestSubmittedOrder().submittedAt), 'unknown legacy age is not invented or treated as confidently expired');
  await p.evaluate(()=>{seedRecent(24*60*60*1000-100);renderRecentOrderReminder();});
  await p.waitForFunction(()=>!localStorage.getItem('curv-latest-public-order'));
  check(await p.evaluate(()=>val('recentOrderReminder').hidden), 'open-page expiry timer removes shortcut');
  await p.evaluate(()=>{seedRecent();trackingMode='pending';window.pendingRefresh=refreshRecentOrderReminder();});
  await p.waitForFunction(()=>!!window.finishTracking);
  await p.evaluate(async()=>{saveLatestSubmittedOrder(getSubmittedOrderInfo('C-NEW','pickup',2,'00000000-0000-4000-8000-000000000124'));finishTracking({data:[{status:'completed'}]});await pendingRefresh;});
  check(await p.evaluate(()=>loadLatestSubmittedOrder().orderNumber==='C-NEW'), 'late terminal response cannot clear newer order');
  check(await p.evaluate(()=>val('submitOrderBtn').previousElementSibling===val('customer-details-memory') && val('customer-details-memory').previousElementSibling.id==='special-requests-field'), 'remember group follows notes directly before submit');
  check(await p.evaluate(()=>val('customer-details-memory').contains(val('customer-details-help')) && val('remember-customer-details').getAttribute('aria-describedby')==='customer-details-help'), 'helper remains with checkbox and accessibility association');
  check(await p.evaluate(()=>val('customer-details-memory').contains(val('customer-details-status')) && val('customer-details-memory').contains(val('forget-customer-details'))), 'feedback and forget stay in lower form group');
  await p.evaluate(()=>{val('f-name').value='Typed name';val('forget-customer-details').click();});
  check(await p.evaluate(()=>val('f-name').value==='Typed name' && !profileRead() && loadLatestSubmittedOrder().orderNumber==='C-NEW'), 'forget preserves typed values and recent order independently');
  check(await p.evaluate(()=>val('customer-details-status').textContent.length>0), 'forget feedback appears in relocated group');
  await p.evaluate(async()=>{cart=[];await submitPublicOrder();});
  check(await p.evaluate(()=>val('submitOrderStatus').textContent==='Please add at least one item to your order.'), 'empty submit displays missing-item validation');
  await p.evaluate(()=>addItem('Fixture','Each',150,null));
  check(await p.evaluate(()=>cart.length===1 && val('submitOrderStatus').textContent==='' && !val('submitOrderStatus').classList.contains('error')), 'real add-item action immediately clears stale cart error');
  await p.evaluate(()=>{setSubmitOrderStatus('Please enter a valid phone number.','error');updateQty(cart[0].key,1);});
  check(await p.evaluate(()=>val('submitOrderStatus').textContent==='Please enter a valid phone number.'), 'quantity changes preserve unrelated phone error');
  await p.evaluate(()=>{setSubmitOrderStatus('Please enter a delivery address.','error');addItem('Second','Each',100,null);});
  check(await p.evaluate(()=>val('submitOrderStatus').textContent==='Please enter a delivery address.'), 'adding items preserves unrelated address error');
  await p.evaluate(async()=>{for(const item of [...cart])removeItem(item.key);await submitPublicOrder();});
  check(await p.evaluate(()=>!cart.length && val('submitOrderStatus').textContent==='Please add at least one item to your order.'), 'removing last item allows missing-item validation again');
  await p.evaluate(()=>{addItem('Fixture','Each',150,null);updateQty(cart[0].key,1);renderCart();});
  check(await p.evaluate(()=>!val('submitOrderStatus').textContent.includes('at least one item')), 'valid cart remains free of stale missing-item message');
  for(const width of [320,390,768,1280]) {
    await p.setViewportSize({width,height:900});
    await p.evaluate(()=>{val('formFloat').classList.add('open');val('formBody').classList.remove('minimized');});
    check(await p.evaluate(()=>{const g=val('customer-details-memory'),b=val('submitOrderBtn'),body=val('formBody');return g.getBoundingClientRect().bottom<=b.getBoundingClientRect().top && body.scrollWidth<=body.clientWidth+1;}),width+' lower form fits without horizontal overflow');
  }
  await p.close();
  console.log(count+' C1A/order-form assertions passed; all network requests intercepted.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
