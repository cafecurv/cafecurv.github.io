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
 const p=await open();await p.clock.setFixedTime(new Date('2026-09-28T02:00:00Z'));
 await p.evaluate(()=>{prepare();val('f-delivery').value='dine-in';val('f-contact').value='';syncOrderMethodFields();});
 check(await p.evaluate(()=>val('preferred-time-label').textContent==='When should we prepare your order?'&&!val('preferred-time-field').hidden),'dine-in preparation prompt visible');
 check(await p.evaluate(()=>val('contact-number-label').textContent.includes('optional')&&val('f-payment').value==='counter'&&val('f-payment').disabled),'optional phone and counter payment');
 check(await p.evaluate(()=>val('delivery-fields').hidden&&val('delivery-fee-info').hidden&&val('delivery-address-field').hidden),'delivery controls and fee hidden');
 await p.evaluate(()=>{val('f-name').value='';});check(await p.evaluate(()=>validatePublicOrderPayload(buildPublicOrderPayload()).includes('name')),'name required');
 await p.evaluate(()=>{val('f-name').value='Guest';setDeliveryTime('asap');});check(await p.evaluate(()=>validatePublicOrderPayload(buildPublicOrderPayload())===''),'blank phone ASAP valid');
 check(await p.evaluate(()=>{const p=buildPublicOrderPayload();return p.preparation_timing==='asap'&&p.requested_preparation_at===null&&p.pickup_time===null&&!('delivery_address'in p);}), 'ASAP payload no fabricated time/address');
 await p.evaluate(()=>setDeliveryTime('specific'));
 check(await p.evaluate(()=>!val('tabSpecific').disabled&&!val('f-delivery-time').disabled&&val('f-delivery-time').style.display==='block'),'specific time enabled');
 for(const time of ['','09:59','10:00','invalid']) {await p.evaluate(t=>val('f-delivery-time').value=t,time);check(await p.evaluate(()=>!!validatePublicOrderPayload(buildPublicOrderPayload())),'invalid/past/missing '+time);}
 await p.evaluate(()=>val('f-delivery-time').value='11:30');
 check(await p.evaluate(()=>{const p=buildPublicOrderPayload();return !validatePublicOrderPayload(p)&&p.requested_preparation_at==='2026-09-28T11:30:00+08:00'&&p.preparation_timing==='scheduled'&&p.pickup_time===null;}),'later today is Manila actual timestamp');
 check(await p.evaluate(()=>buildMessage().includes('Preparation: 11:30 AM')&&!buildMessage().includes('Preferred Pickup Time')),'copy summary preparation wording');
 for(const type of ['pickup','delivery-curv-rider']) {
 await p.evaluate(type=>{val('f-delivery').value=type;syncOrderMethodFields();},type);
 check(await p.evaluate(()=>validatePublicOrderPayload(buildPublicOrderPayload())==='Please fill in your contact number.'),type+' phone required again');
 check(await p.evaluate(()=>!('preparation_timing'in buildPublicOrderPayload())&&buildPublicOrderPayload().pickup_time==='11:30 AM'),type+' existing time contract unchanged');
 }
 await p.evaluate(()=>{setSubmitOrderStatus('Please fill in your delivery address.','error');val('f-delivery').value='dine-in';syncOrderMethodFields();});
 check(await p.evaluate(()=>val('submitOrderStatus').textContent===''),'switch clears irrelevant address error');
 await p.evaluate(()=>{setSubmitOrderStatus('Please fill in your name.','error');syncOrderMethodFields();});check(await p.evaluate(()=>val('submitOrderStatus').textContent.includes('name')),'switch preserves relevant name error');
 await p.evaluate(async()=>{setDeliveryTime('asap');await submitPublicOrder();});check(await p.evaluate(()=>isOrderSubmittedLocked&&calls.at(-1).payload.customer_phone===''&&calls.at(-1).payload.preparation_timing==='asap'),'ASAP real submission path');
 await p.close();const scheduled=await open();await scheduled.clock.setFixedTime(new Date('2026-09-28T02:00:00Z'));
 await scheduled.evaluate(async()=>{prepare();val('f-delivery').value='dine-in';val('f-contact').value='';syncOrderMethodFields();setDeliveryTime('specific');val('f-delivery-time').value='12:00';await submitPublicOrder();});
 check(await scheduled.evaluate(()=>isOrderSubmittedLocked&&calls.at(-1).payload.requested_preparation_at==='2026-09-28T12:00:00+08:00'),'scheduled real submission path');await scheduled.close();

 const retry=await open();await retry.clock.setFixedTime(new Date('2026-09-28T15:00:00Z'));
 await retry.evaluate(async()=>{prepare();val('f-delivery').value='dine-in';val('f-contact').value='';syncOrderMethodFields();setDeliveryTime('specific');val('f-delivery-time').value='23:30';publicMenuSupabaseClient.rpc=async(name,args)=>{calls.push(structuredClone(args.order_payload));return {error:{message:'Connection lost'}};};await submitPublicOrder();});
 await retry.clock.setFixedTime(new Date('2026-09-28T16:01:00Z'));
 await retry.evaluate(async()=>{syncAnytimeOrderState();publicMenuSupabaseClient.rpc=async(name,args)=>{calls.push(structuredClone(args.order_payload));return {data:{order_number:'C-REPLAY',tracking_token:'00000000-0000-4000-8000-000000000123'}};};await submitPublicOrder();});
 check(await retry.evaluate(()=>isOrderSubmittedLocked&&calls.length===2&&calls[0].submission_key===calls[1].submission_key&&calls[0].requested_preparation_at===calls[1].requested_preparation_at),'ambiguous scheduled retry after Manila midnight preserves timestamp/key');await retry.close();
 console.log(count+' dine-in form assertions passed; network intercepted.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
