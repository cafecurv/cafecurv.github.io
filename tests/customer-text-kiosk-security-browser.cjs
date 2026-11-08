// Actual menu/bootstrap/onboarding/controller. All HTTP and Auth transport mocked.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.CURV_KIOSK_SOURCE_ROOT||path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'menu/index.html'),'utf8');const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{let count=0;const groups={};const check=(v,m,g='flow')=>{assert.ok(v,m);count++;groups[g]=(groups[g]||0)+1;};
 const browser=await chromium.launch({channel:'msedge',headless:true});
 async function open({legacy=false,authorized=true,mode='normal',storageDenied=false}={}){
  const context=await browser.newContext();const page=await context.newPage();await page.clock.install();const probeRequests=[];page.on('request',r=>{if(r.url().includes('/customer-text-probe'))probeRequests.push(r.url());});
  const db={generation:id(100),device:id(200),attempt:null,closed:false,orders:0,mode,authorized,calls:[]};
  const quote=p=>({pricing_contract_version:2,pricing_fingerprint_version:1,pricing_policy_version:'fixture',currency:'PHP',review_fingerprint:'a'.repeat(64),subtotal:p.items.reduce((n,i)=>n+150*i.quantity,0).toFixed(2),items:p.items.map(i=>({...i,product_name:db.label||'Server coffee',category_name:db.label||'Coffee',size_label:db.label||'Regular',base_price:'150.00',option_total:'0.00',unit_price:'150.00',line_total:(150*i.quantity).toFixed(2),options:[{group_name:db.label||'Milk',label:db.label||'Full cream'}]}))});
  await context.exposeFunction('kioskFixtureRpc',async(name,a)=>{
   db.calls.push({name,args:structuredClone(a)});
   if(!db.authorized)return {data:null,error:{details:'KIOSK_DEVICE_UNAVAILABLE'}};
   if(name==='kiosk_context')return {data:{contract_version:1,device_id:db.device,generation_id:db.closed?null:db.generation,state:db.attempt?.receipt?'accepted':db.attempt?'admitted':'draft',submission_key:db.attempt?.key,receipt:db.attempt?.receipt,accepted_at:db.attempt?.accepted_at}};
   if(name==='kiosk_begin'){if(db.closed){db.generation=id(Number(db.generation.slice(-12))+1);db.closed=false;db.attempt=null;}return {data:{generation_id:db.generation,device_id:db.device}};}
   if(name==='kiosk_quote')return {data:{ok:true,quote:quote(a.p_payload)}};
   if(name==='kiosk_admit'){
    if(db.mode==='lost-admit'){db.mode='normal';return {error:{details:'network'}};}
    if(db.attempt&&db.attempt.key!==a.p_payload.submission_key)return {error:{details:'KIOSK_KEY_CONFLICT'}};
    db.attempt=db.attempt||{key:a.p_payload.submission_key,payload:structuredClone(a.p_payload)};return {data:{state:'admitted',submission_key:a.p_payload.submission_key}};
   }
   if(name==='kiosk_submit'){
    if(db.mode==='price-change'){db.mode='normal';return {data:{state:'price_changed',quote:{...quote(db.attempt.payload),review_fingerprint:'b'.repeat(64)}}};}
    if(db.mode==='held')return new Promise(resolve=>{db.release=()=>{db.mode='normal';db.attempt.receipt={order_number:'C-9001'};db.attempt.accepted_at=new Date().toISOString();db.orders=1;resolve({data:{state:'accepted',receipt:db.attempt.receipt,accepted_at:db.attempt.accepted_at}});};});
    if(db.mode==='unavailable')return {error:{details:'KIOSK_DEVICE_UNAVAILABLE'}};
    if(!db.attempt.receipt){db.attempt.receipt={order_number:'C-9001'};db.attempt.accepted_at=await page.evaluate(()=>new Date().toISOString());db.orders++;}
    if(db.mode==='lost-response'){db.mode='normal';return {error:{details:'network'}};}
    return {data:{state:'accepted',receipt:db.attempt.receipt,accepted_at:db.attempt.accepted_at}};
   }
   if(name==='kiosk_recover')return {data:db.closed?{state:'closed'}:db.attempt?.receipt?{state:'accepted',receipt:db.attempt.receipt,accepted_at:db.attempt.accepted_at}:db.attempt?{state:'admitted'}:{state:'unknown'}};
   if(name==='kiosk_confirm_price')return {data:{state:'admitted'}};
   if(name==='kiosk_close'){
    if(a.p_draft&&db.attempt||!a.p_draft&&!db.attempt?.receipt)return {error:{details:'KIOSK_UNCERTAIN'}};
    db.closed=true;return {data:{state:'closed'}};
   }
   return {error:{details:'KIOSK_INPUT_INVALID'}};
  });
  await context.addInitScript(({legacy,storageDenied})=>{
   window.CURV_KIOSK_CONFIG={enabled:true,supabaseUrl:'https://device.test',publishableKey:'non-production-mock-key'};
   localStorage.setItem('curv-customer-details-v1',JSON.stringify({version:1,savedAt:new Date().toISOString(),name:'Personal device guest',phone:'09171234567',address:'Personal address',fulfillment:'pickup',payment:'gcash'}));
   localStorage.setItem('curv-latest-public-order','personal recent sentinel');sessionStorage.setItem('curv-pending-order-v2','personal recovery sentinel');
   if(legacy)sessionStorage.setItem('curv-kiosk:curv-pending-order-v2','legacy unresolved sentinel');
   if(storageDenied){const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='curv-kiosk-v2:pending')throw Error('denied');return set.call(this,k,v);};}
   const result={data:[],error:null};let query;query=new Proxy({}, {get:(_,key)=>key==='then'?Promise.resolve(result).then.bind(Promise.resolve(result)):()=>query});
   const publicClient={from:()=>query,rpc:async()=>({data:{website_ordering_enabled:true},error:null})};let callback;
   const device={rpc:(name,args)=>kioskFixtureRpc(name,args),auth:{getSession:async()=>({data:{session:{access_token:'mock-device-only'}},error:null}),onAuthStateChange:fn=>{callback=fn;return {data:{subscription:{unsubscribe(){}}}};}}};
   window.kioskSignOut=()=>callback?.('SIGNED_OUT');
   window.supabase={createClient:url=>url==='https://device.test'?device:publicClient};
  },{legacy,storageDenied});
  await context.route('**/*',r=>{
   const u=new URL(r.request().url());if(u.origin!=='https://curv.test')return r.abort();
   if(u.pathname==='/menu/'||u.pathname==='/menu')return r.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/blank')return r.fulfill({contentType:'text/html',body:'<!doctype html><title>Other page</title>'});
   if(u.pathname.startsWith('/kiosk/')){const file=path.join(root,u.pathname);if(fs.existsSync(file))return r.fulfill({path:file,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});}
   return r.abort();
  });
  await page.goto('https://curv.test/menu/?kiosk=1');
  return {context,page,db,probeRequests};
 }
 async function onboard(f,name='Alex <&> ♡',mode='TO GO'){
  const p=f.page;await p.getByRole('heading',{name:"hey, what's your name?"}).waitFor();
  await p.getByLabel('Your nickname').fill(name);await p.getByRole('button',{name:'Continue',exact:true}).click();
  await p.getByRole('button',{name:mode,exact:true}).click();
  await p.evaluate(()=>{isWebsiteOrderingEnabled=true;isPublicOrderTechnicalAvailable=true;cart=[{key:'fixture',name:'Local estimate coffee',price:.01,qty:1,product_id:'00000000-0000-4000-8000-000000001000',product_size_id:'00000000-0000-4000-8000-000000001100',option_choice_ids:[],options:{note:'Less ice'}}];renderCart();if(!document.getElementById('formFloat').classList.contains('open'))toggleForm();});
 }
 async function review(f){await f.page.locator('#submitOrderBtn').click();await f.page.getByRole('button',{name:'Continue & Submit'}).waitFor();}
 async function confirm(f){await f.page.getByRole('button',{name:'Continue & Submit'}).click();}
 async function success(f){await f.page.getByRole('heading',{name:'order received!'}).waitFor();}

 try{
  const names=['<svg onload="window.textProbe=1">', '\" onfocus=\"window.textProbe=2', "O’Malley & café 日本語 ♡ 🧋"];
  const note='<img src="/customer-text-probe" onerror="window.textProbe=3"> \" \' \nLess ice 🧋';
  for(const name of names){
   const f=await open(),p=f.page;await p.evaluate(()=>{window.textProbe=0;});await onboard(f,name);
   f.db.label=note;
   check((await p.locator('#kioskBanner').textContent()).includes(name),'nickname safe literal banner','nickname');
   await p.evaluate(t=>{cart[0].options.note=t;cart[0].key=configurationCartKey({product_id:cart[0].product_id,product_size_id:cart[0].product_size_id,option_choice_ids:[]},t);renderCart();document.getElementById('f-notes').value=t;},note);
   check((await p.locator('.cart-item-opts').textContent()).includes(note),'kiosk literal item note','cart');
   check(await p.locator('#cartItems img,#cartItems svg,#kioskBanner svg').count()===0,'kiosk no injected cart/name elements','cart');
   await review(f);
   check(await p.locator('#orderConfirmBody img,#orderConfirmBody svg').count()===0,'kiosk review escapes server labels/options and customer note','review');
   check((await p.locator('#orderConfirmBody').textContent()).includes(note),'kiosk review retains literal note','review');
   await confirm(f);await success(f);
   check(f.db.attempt.payload.customer_name===name&&f.db.attempt.payload.items[0].item_note===note&&f.db.attempt.payload.customer_notes===note,'frozen payload retains text','submit');
   check((await p.locator('.kiosk-order-number').textContent())==='C-9001','receipt retains actual verified number','receipt');
   check(await p.evaluate(()=>window.textProbe===0)&&f.probeRequests.length===0,'no payload script or network activation','execution');
   await p.getByRole('button',{name:'Done · New customer'}).click();await p.getByRole('heading',{name:"hey, what's your name?"}).waitFor();
   check(await p.evaluate(()=>cart.length===0&&document.getElementById('kioskNickname').value===''),'next customer isolated after hostile text','privacy');await f.context.close();
  }
  const f=await open(),p=f.page;await onboard(f);await p.evaluate(()=>{window.textProbe=0;});
  f.db.mode='held';await review(f);await confirm(f);await p.waitForFunction(()=>!!sessionStorage.getItem('curv-kiosk-v2:pending'));
  await p.evaluate(()=>{window.curvKioskAuth.rpc=async()=>({state:'accepted',receipt:{order_number:'<svg onload="window.textProbe=4">'},accepted_at:new Date().toISOString()});});
  await p.clock.fastForward(30001);await p.locator('#kioskRoot').getByRole('button',{name:'Recover previous order'}).click();
  check(await p.locator('.kiosk-order-number').count()===0,'malformed receipt number cannot become success','receipt');
  check(await p.evaluate(()=>window.textProbe===0)&&await p.locator('#kioskRoot svg').count()===0,'malformed receipt never becomes markup','execution');await f.context.close();
  console.log(JSON.stringify({suite:'customer-text-kiosk-security',assertions:count,groups,network:'all intercepted',credentials:'synthetic fixture only; none inspected'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
