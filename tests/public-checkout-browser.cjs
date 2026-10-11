// Offline browser -> actual local D0B4/D0B5 SQL. Never contacts Supabase.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const {v2Fixture,id,certify,query}=require('./public-submission-v2-fixture.cjs');
(async()=>{const {db}=await v2Fixture();const browser=await chromium.launch({channel:'msedge',headless:true});let n=0;
const check=(v,m)=>{assert.ok(v,m);n++;};const equal=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
const html=fs.readFileSync(path.join(__dirname,'../menu/index.html'),'utf8'),controller=fs.readFileSync(path.join(__dirname,'../menu/authoritative-checkout.js'),'utf8');
const q=(s,p=[])=>query(db,s,p);const count=async()=>(await q('select count(*)::int n from orders'))[0].n;
async function open(){const page=await browser.newPage();const calls=[];let mode='normal';
 await page.exposeFunction('fixtureRpc',async(name,args)=>{calls.push({name,args:structuredClone(args)});
  if(name==='quote_public_cart'){
   if(mode==='quote-error')return {error:{message:'secret database diagnostic'}};
   return {data:(await q('select quote_public_cart($1) v',[JSON.stringify(args.p_request)]))[0].v};
  }
  if(name==='submit_public_order_v2'){
   if(mode==='before-loss'){mode='normal';throw Error('private network error');}
   if(mode==='retry'){mode='normal';return {data:{ok:false,error:{code:'ORDER_RETRY_REQUIRED'}}};}
   if(mode==='conflict')return {data:{ok:false,error:{code:'ORDER_SUBMISSION_KEY_CONFLICT',message:'secret'}}};
   if(mode==='price-change'){mode='normal';await q('update product_sizes set price=price+1 where id=$1',[id(1100)]);await certify(db,1000);}
   const data=(await q('select submit_public_order_v2($1) v',[JSON.stringify(args.p_request)]))[0].v;
   if(mode==='after-loss'){mode='normal';throw Error('response lost');}
   return {data};
  }
  return {data:{website_ordering_enabled:true}};
 });
 await page.route('**/*',r=>r.request().url()==='https://curv.test/menu/'?r.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}):r.abort());
 const boot=async()=>{
  await page.goto('https://curv.test/menu/');
  for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())await page.addScriptTag({content:m[1]});
  await page.addScriptTag({content:controller});
  await page.evaluate(({product,size})=>{
   window.supabase={createClient:()=>publicMenuSupabaseClient};publicMenuSupabaseClient={rpc:(name,args)=>fixtureRpc(name,args)};
   isWebsiteOrderingEnabled=true;isPublicOrderTechnicalAvailable=true;
   document.getElementById('f-name').value='Browser Guest';document.getElementById('f-contact').value='';
   document.getElementById('f-delivery').value='dine-in';syncOrderMethodFields();setDeliveryTime('asap');
   cart=[{key:'fixture',name:'FORGED LOCAL NAME',price:0.01,qty:1,product_id:product,product_size_id:size,option_choice_ids:[],options:{note:'Please wrap'}}];renderCart();
  },{product:id(1000),size:id(1100)});
 };
 await boot();return {page,calls,boot,setMode:m=>{mode=m;},submits:()=>calls.filter(c=>c.name==='submit_public_order_v2')};
}
const start=async f=>{await f.page.evaluate(()=>{window.attempt=submitPublicOrder();});};
const confirm=async f=>{await f.page.getByRole('button',{name:/Continue & Submit|Confirm Updated Order/}).click();await f.page.waitForFunction(()=>!curvCheckout.state.busy);};
const pending=f=>f.page.evaluate(()=>JSON.parse(sessionStorage.getItem(curvCheckout.storageKey)));
try{
 let f=await open();await start(f);await f.page.getByRole('button',{name:'Continue & Submit'}).waitFor();
 check((await f.page.locator('#orderConfirmBody').textContent()).includes('Simple sushi'),'server label rendered');check(!(await f.page.locator('#orderConfirmBody').textContent()).includes('FORGED'),'local name excluded');
 const quoteCall=f.calls.find(c=>c.name==='quote_public_cart');equal(Object.keys(quoteCall.args.p_request.items[0]).sort(),['item_note','option_choice_ids','product_id','product_size_id','quantity'],'stable-only quote');
 check((await f.page.locator('#orderConfirmBody').textContent()).includes('10.10'),'authoritative subtotal wins');
 for(const width of [320,390,768,1280]){
  await f.page.setViewportSize({width,height:844});
  check(await f.page.locator('.order-confirm-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'review has no horizontal overflow at '+width);
  if(width===390&&process.env.CURV_CHECKOUT_SCREENSHOT)await f.page.locator('.order-confirm-card').screenshot({path:process.env.CURV_CHECKOUT_SCREENSHOT});
 }
 await f.page.evaluate(()=>submitPublicOrder());equal(f.submits().length,0,'duplicate click during review no submit');
 await confirm(f);equal(f.submits().length,1,'one submit');const request=f.submits()[0].args.p_request;
 check(!('subtotal' in request.payload)&&!('unit_price' in request.payload.items[0]),'no browser money in request');equal(request.payload.customer_phone,'','blank dine-in phone');equal(request.payload.preparation_timing,'asap','ASAP');equal(request.payload.requested_preparation_at,null,'no fabricated timestamp');equal(request.payload.payment_method,'counter','counter');
 equal(await pending(f),null,'success clears frozen request');check(await f.page.evaluate(()=>isOrderSubmittedLocked),'success UI locked');await f.page.close();
 for(const mode of ['after-loss','before-loss','retry']){
  f=await open();const before=await count();f.setMode(mode);await start(f);await confirm(f);const saved=await pending(f);check(!!saved,'frozen uncertain request retained '+mode);equal(saved.request,f.submits()[0].args.p_request,'exact frozen body');
  // Change the current form/cart, then reload for one case. Recovery must still
  // use original body, not reconstruct it from edited fields or current prices.
  await f.page.evaluate(()=>{cart[0].qty=9;document.getElementById('f-name').value='Changed intent';renderCart();});
  if(mode==='after-loss')await f.boot();
  if(mode==='after-loss'){
   await q('update store_settings set website_ordering_enabled=false');
   await f.page.evaluate(()=>{setWebsiteOrderingStatus(false);syncAnytimeOrderState();});
   check(!(await f.page.locator('#orderBarButton').isDisabled()),'paused menu permits pending recovery');
   check(!(await f.page.locator('#submitOrderBtn').isDisabled()),'paused form permits replay');
  }
  await start(f);await f.page.evaluate(()=>attempt);equal(f.submits()[1].args.p_request,saved.request,'same frozen body/key recovery '+mode);equal(await count(),before+1,'one order only '+mode);await f.page.close();
  if(mode==='after-loss')await q('update store_settings set website_ordering_enabled=true');
 }
 f=await open();f.setMode('price-change');await start(f);await confirm(f);const saved=await pending(f);equal(saved.state,'price_changed','known non-created state');equal(f.submits().length,1,'no automatic resubmit');
 check((await f.page.locator('#orderConfirmBody').textContent()).includes('11.10'),'fresh quote displayed');const oldFingerprint=saved.request.payload.review_fingerprint;
 await f.page.getByRole('button',{name:'Review & Continue',exact:true}).click();await f.page.getByRole('button',{name:'Confirm Updated Order'}).waitFor();equal((await pending(f)).request.payload.review_fingerprint,oldFingerprint,'hash unchanged until explicit confirmation');
 await confirm(f);equal(f.submits()[1].args.p_request.payload.submission_key,saved.request.payload.submission_key,'same key after price update');check(f.submits()[1].args.p_request.payload.review_fingerprint!==oldFingerprint,'confirmed new hash');await f.page.close();
 f=await open();f.setMode('price-change');await start(f);await confirm(f);const oldKey=(await pending(f)).request.payload.submission_key;
 await f.page.evaluate(()=>{cart[0].qty=2;renderCart();});await f.page.getByRole('button',{name:'Continue & Submit'}).waitFor();await confirm(f);check(f.submits()[1].args.p_request.payload.submission_key!==oldKey,'intent edit after PRICE_CHANGED rotates key');equal(f.submits()[1].args.p_request.payload.items[0].quantity,2,'edited qty');await f.page.close();
 f=await open();f.setMode('quote-error');await start(f);await f.page.evaluate(()=>attempt);equal(f.submits().length,0,'quote failure no submit');equal(await f.page.evaluate(()=>curvCheckout.state.status),'error','explicit quote error');check(!(await f.page.locator('#submitOrderStatus').textContent()).includes('secret'),'no diagnostics');f.setMode('normal');await start(f);await confirm(f);await f.page.close();
 f=await open();await start(f);await f.page.getByRole('button',{name:'Continue & Submit'}).waitFor();const quoteCount=f.calls.length;
 await f.page.evaluate(()=>{cart[0].qty=3;renderCart();});await f.page.waitForFunction(()=>curvCheckout.state.quote?.items[0].quantity===3);check(f.calls.length>quoteCount,'quantity mutation requotes');await confirm(f);await f.page.close();
 // Every semantic cart identity component invalidates review; cached display
 // fields do not. Changing customer intent reopens explicit confirmation.
 f=await open();await start(f);await f.page.getByRole('button',{name:'Continue & Submit'}).waitFor();const firstQuotes=f.calls.length;
 await f.page.evaluate(()=>{cart[0].price=999;cart[0].name='Another local label';renderCart();});equal(f.calls.length,firstQuotes,'local money/display does not reprice intent');
 await f.page.evaluate(()=>{cart[0].options.note='New note';renderCart();});await f.page.waitForFunction(()=>curvCheckout.state.quote?.items[0].item_note==='New note');check(f.calls.length>firstQuotes,'note mutation requotes');
 await f.page.evaluate(({p,s,c})=>{Object.assign(cart[0],{product_id:p,product_size_id:s,option_choice_ids:c});renderCart();},{p:id(1001),s:id(1101),c:[id(3000),id(3010)]});
 await f.page.waitForFunction(()=>curvCheckout.state.quote?.items[0].size_label==='Regular');check(true,'configuration mutation requotes');
 await f.page.evaluate(id=>{cart[0].option_choice_ids[0]=id;renderCart();},id(3001));await f.page.waitForFunction(()=>curvCheckout.state.quote?.subtotal==='125.00');check(true,'choice mutation requotes');
 await f.page.evaluate(id=>{cart[0].product_size_id=id;renderCart();},id(1102));await f.page.waitForFunction(()=>curvCheckout.state.quote?.subtotal==='145.00');check(true,'size mutation requotes');
 await f.page.locator('#f-name').evaluate(el=>{el.value='New customer intent';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await f.page.waitForFunction(()=>curvCheckout.state.reviewing&&document.querySelector('#orderConfirmBody').textContent.includes('New customer intent'));check(true,'customer edit requires new confirmation');await confirm(f);equal(f.submits()[0].args.p_request.payload.customer_name,'New customer intent','edited intent sent');await f.page.close();
 for(const method of ['pickup','delivery-lalamove']){
  f=await open();await f.page.evaluate(method=>{document.getElementById('f-contact').value='09171234567';document.getElementById('f-delivery').value=method;document.getElementById('f-address').value='Street address';document.getElementById('f-payment').value='gcash';syncOrderMethodFields();},method);
  await start(f);await f.page.getByRole('button',{name:'Continue & Submit'}).waitFor();if(method.startsWith('delivery'))check((await f.page.locator('#orderConfirmBody').textContent()).includes('confirmed separately'),'unresolved delivery wording');await confirm(f);
  const p=f.submits()[0].args.p_request.payload;equal(p.preparation_timing,null,'no dine-in timing for '+method);check(!('total' in p)&&!('delivery_fee' in p),'no finalized delivery money');await f.page.close();
 }
 f=await open();await f.page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===sessionStorage)throw Error('Denied');return set.call(this,k,v);};});await start(f);await confirm(f);equal(f.submits().length,0,'storage failure prevents unfrozen network request');await f.page.close();
 f=await open();await start(f);await f.page.getByRole('button',{name:'Continue & Submit'}).waitFor();
 await f.page.evaluate(()=>{
  window.originalRpc=publicMenuSupabaseClient.rpc;publicMenuSupabaseClient.rpc=()=>new Promise(()=>{});
  window.originalTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===30000?5:ms,...args);
 });await confirm(f);equal((await pending(f)).state,'ambiguous','timeout retains uncertain request');const timeoutRequest=(await pending(f)).request;
 await f.page.evaluate(()=>{publicMenuSupabaseClient.rpc=originalRpc;window.setTimeout=originalTimeout;});await start(f);await f.page.evaluate(()=>attempt);
 equal(f.submits()[0].args.p_request,timeoutRequest,'timeout retry exact frozen request');await f.page.close();
 f=await open();f.setMode('conflict');await start(f);await confirm(f);const conflict=await pending(f);await start(f);await f.page.evaluate(()=>attempt);equal(f.submits().length,1,'conflict blocks silent rotation');equal((await pending(f)).request,conflict.request,'conflict retained');await f.page.close();
 f=await open();await f.page.evaluate(()=>document.getElementById('remember-customer-details').checked=true);await start(f);check(await f.page.evaluate(()=>!localStorage.getItem('curv-customer-details-v1')),'no premature remembered profile');await confirm(f);
 const profile=await f.page.evaluate(()=>JSON.parse(localStorage.getItem('curv-customer-details-v1')));check(profile&&profile.name==='Browser Guest','C1A saves on success');check(!JSON.stringify(profile).includes('fingerprint')&&!JSON.stringify(profile).includes('submission_key'),'C1A isolated');await f.page.close();
 await q('update products set name=$1 where id=$2',['<img src=x onerror=alert(1)>',id(1000)]);
 f=await open();await start(f);await f.page.getByRole('button',{name:'Continue & Submit'}).waitFor();equal(await f.page.locator('#orderConfirmBody img').count(),0,'server name escaped');check((await f.page.locator('#orderConfirmBody').textContent()).includes('<img'),'escaped text visible');await f.page.getByRole('button',{name:'Edit Order',exact:true}).click();await f.page.close();
 console.log(n+' D0B6 browser/real-SQL assertions passed; all network intercepted.');
}finally{await browser.close();await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
