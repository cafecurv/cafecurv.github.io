// Actual menu/bootstrap/onboarding/controller. All HTTP and Auth transport mocked.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.CURV_KIOSK_SOURCE_ROOT||path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'menu/index.html'),'utf8');const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{let count=0;const groups={};const check=(v,m,g='flow')=>{assert.ok(v,m);count++;groups[g]=(groups[g]||0)+1;};
 const browser=await chromium.launch({channel:'msedge',headless:true});
 async function open({legacy=false,authorized=true,mode='normal',storageDenied=false,touch=false,delayCatalog=false,holdController=false}={}){
  const context=await browser.newContext(touch?{hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}:{});const page=await context.newPage();await page.clock.install();
  const db={generation:id(100),device:id(200),attempt:null,closed:false,orders:0,mode,authorized,calls:[]};
  const quote=p=>({pricing_contract_version:2,pricing_fingerprint_version:1,pricing_policy_version:'fixture',currency:'PHP',review_fingerprint:'a'.repeat(64),subtotal:p.items.reduce((n,i)=>n+150*i.quantity,0).toFixed(2),items:p.items.map(i=>({...i,product_name:i.product_id===id(2)?'Sea Salt Cream Matcha Latte with Vanilla Sweet Cream Cold Foam':'Server coffee',category_name:'Coffee',size_label:'Regular',base_price:'150.00',option_total:'0.00',unit_price:'150.00',line_total:(150*i.quantity).toFixed(2),options:i.option_choice_ids.includes(id(80))?[{group_name:'Milk',label:'Oat milk'}]:[]}))});
  await context.exposeFunction('kioskFixtureRpc',async(name,a)=>{
   db.calls.push({name,args:structuredClone(a)});
   if(!db.authorized)return {data:null,error:{details:'KIOSK_DEVICE_UNAVAILABLE'}};
   if(name==='kiosk_context')return {data:{contract_version:1,device_id:db.device,generation_id:db.closed?null:db.generation,state:db.attempt?.receipt?'accepted':db.attempt?'admitted':'draft',submission_key:db.attempt?.key,receipt:db.attempt?.receipt,accepted_at:db.attempt?.accepted_at}};
   if(name==='kiosk_begin'){if(db.closed){db.generation=id(Number(db.generation.slice(-12))+1);db.closed=false;db.attempt=null;}return {data:{generation_id:db.generation,device_id:db.device}};}
   if(name==='kiosk_quote')return {data:{ok:true,quote:quote(a.p_payload)}};
   if(name==='kiosk_admit'){
    if(a.p_generation!==db.generation||db.closed)return {error:{details:'KIOSK_GENERATION_CONFLICT'}};
    if(db.attempt&&JSON.stringify({...db.attempt.payload,review_fingerprint:null})!==JSON.stringify({...a.p_payload,review_fingerprint:null}))return {error:{details:'KIOSK_KEY_CONFLICT'}};
    if(db.mode==='lost-admit'){db.mode='normal';return {error:{details:'network'}};}
    if(db.attempt&&db.attempt.key!==a.p_payload.submission_key)return {error:{details:'KIOSK_KEY_CONFLICT'}};
    db.attempt=db.attempt||{key:a.p_payload.submission_key,payload:structuredClone(a.p_payload)};return {data:{state:'admitted',submission_key:db.admissionKeyOverride===undefined?a.p_payload.submission_key:db.admissionKeyOverride}};
   }
   if(name==='kiosk_submit'){
    if(db.mode==='uncertain')return {error:{details:'network'}};
    if(db.mode==='price-change'){db.mode='normal';return {data:{state:'price_changed',quote:{...quote(db.attempt.payload),review_fingerprint:'b'.repeat(64)}}};}
    if(db.mode==='held')return new Promise(resolve=>{db.release=()=>{db.mode='normal';db.attempt.receipt={order_number:'C-9001'};db.attempt.accepted_at=new Date().toISOString();db.orders=1;resolve({data:{state:'accepted',receipt:db.attempt.receipt,accepted_at:db.attempt.accepted_at}});};});
    if(db.mode==='unavailable')return {error:{details:'KIOSK_DEVICE_UNAVAILABLE'}};
    if(!db.attempt.receipt){db.attempt.receipt={order_number:'C-9001'};db.attempt.accepted_at=await page.evaluate(()=>new Date().toISOString());db.orders++;}
    if(db.mode==='lost-response'){db.mode='normal';return {error:{details:'network'}};}
    return {data:{state:'accepted',receipt:db.attempt.receipt,accepted_at:db.attempt.accepted_at}};
   }
   if(name==='kiosk_recover'&&(a.p_generation!==db.generation||a.p_key!==db.attempt?.key))return {data:{state:'unknown'}};
   if(name==='kiosk_recover')return {data:db.closed?{state:'closed'}:db.attempt?.receipt?{state:'accepted',receipt:db.attempt.receipt,accepted_at:db.attempt.accepted_at}:db.attempt?{state:'admitted'}:{state:'unknown'}};
   if(name==='kiosk_confirm_price')return {data:{state:'admitted'}};
   if(name==='kiosk_close'){
    if(a.p_draft&&db.attempt||!a.p_draft&&!db.attempt?.receipt)return {error:{details:'KIOSK_UNCERTAIN'}};
    db.closed=true;return {data:{state:'closed'}};
   }
   return {error:{details:'KIOSK_INPUT_INVALID'}};
  });
  await context.addInitScript(({legacy,storageDenied,delayCatalog})=>{
   window.CURV_KIOSK_CONFIG={enabled:true,supabaseUrl:'https://device.test',publishableKey:'non-production-mock-key'};
   localStorage.setItem('curv-customer-details-v1',JSON.stringify({version:1,savedAt:new Date().toISOString(),name:'Personal device guest',phone:'09171234567',address:'Personal address',fulfillment:'pickup',payment:'gcash'}));
   localStorage.setItem('curv-latest-public-order','personal recent sentinel');sessionStorage.setItem('curv-pending-order-v2','personal recovery sentinel');
   if(legacy)sessionStorage.setItem('curv-kiosk:curv-pending-order-v2','legacy unresolved sentinel');
   if(storageDenied){const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='curv-kiosk-v2:pending')throw Error('denied');return set.call(this,k,v);};}
   const result={data:[],error:null};let query;query=new Proxy({}, {get:(_,key)=>key==='then'?Promise.resolve(result).then.bind(Promise.resolve(result)):()=>query});
   const loads=[];
   if(delayCatalog){
    window.holdFixtureCatalog=()=>{
     let release;
     const pending=new Promise(resolve=>{release=resolve;});
     loads.push({pending,release,tables:new Set()});
     return loads.length-1;
    };
    window.fixtureCatalogStarted=index=>loads[index]?.tables.has('public_menu_products');
    window.releaseFixtureCatalog=(index,rows)=>loads[index].release(rows);
    window.holdFixtureCatalog();
   }
   const publicClient={from:table=>{
    if(!delayCatalog)return query;
    const load=loads.at(-1);
    load.tables.add(table);
    const response=load.pending.then(rows=>({data:rows[table]||[],error:null}));
    let delayed;
    delayed=new Proxy({}, {get:(_,key)=>key==='then'?response.then.bind(response):()=>delayed});
    return delayed;
   },rpc:async()=>({data:{website_ordering_enabled:true},error:null})};let callback;
   const device={rpc:(name,args)=>kioskFixtureRpc(name,args),auth:{getSession:async()=>({data:{session:{access_token:'mock-device-only'}},error:null}),onAuthStateChange:fn=>{callback=fn;return {data:{subscription:{unsubscribe(){}}}};}}};
   window.kioskSignOut=()=>callback?.('SIGNED_OUT');
   window.supabase={createClient:url=>url==='https://device.test'?device:publicClient};
  },{legacy,storageDenied,delayCatalog});
  let releaseController;
  const controllerReady=holdController&&new Promise(resolve=>{releaseController=resolve;});
  await context.route('**/*',async r=>{
   const u=new URL(r.request().url());
   const jost=process.env.CURV_KIOSK_WELCOME_JOST;
   if(jost&&u.href==='https://fonts.gstatic.com/s/jost/v20/92zatBhPNqw73oTd4g.woff2'){
    return r.fulfill({path:jost,contentType:'font/woff2',headers:{'access-control-allow-origin':'https://curv.test'}});
   }
   if(u.origin!=='https://curv.test')return r.abort();
   if(holdController&&u.pathname==='/kiosk/checkout.js')await controllerReady;
   if(u.pathname==='/menu/'||u.pathname==='/menu')return r.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/blank')return r.fulfill({contentType:'text/html',body:'<!doctype html><title>Other page</title>'});
   if(u.pathname.startsWith('/kiosk/')){const file=path.join(root,u.pathname);if(fs.existsSync(file))return r.fulfill({path:file});}
   return r.abort();
  });
  await page.goto('https://curv.test/menu/?kiosk=1',holdController?{waitUntil:'domcontentloaded'}:undefined);
  return {context,page,db,releaseController};
 }
 const welcomeHeading = p => p.getByRole('heading', { name: 'Welcome to Curv!' });
 async function startWelcome(p) {
  await welcomeHeading(p).waitFor();
  await p.getByRole('button', { name: 'Tap to order' }).click();
  await p.getByLabel('Your nickname').waitFor();
 }
 async function onboard(f,name='Alex <&> ♡',mode='TO GO'){
  const p=f.page, nickname=p.getByLabel('Your nickname');
  await nickname.or(welcomeHeading(p)).waitFor();
  if (await welcomeHeading(p).isVisible()) await startWelcome(p);
  await p.getByLabel('Your nickname').fill(name);await p.getByRole('button',{name:'Continue',exact:true}).click();
  await p.getByRole('button',{name:mode,exact:true}).click();
  await p.evaluate(()=>{isWebsiteOrderingEnabled=true;isPublicOrderTechnicalAvailable=true;cart=[{key:'fixture',name:'Local estimate coffee',price:.01,qty:1,product_id:'00000000-0000-4000-8000-000000001000',product_size_id:'00000000-0000-4000-8000-000000001100',option_choice_ids:[],options:{note:'Less ice'}}];renderCart();if(!document.getElementById('formFloat').classList.contains('open'))toggleForm();});
 }
 async function review(f){await f.page.locator('#submitOrderBtn').click();await f.page.getByRole('button',{name:'Continue & Submit'}).waitFor();}
 async function confirm(f){await f.page.getByRole('button',{name:'Continue & Submit'}).click();}
 async function success(f){await f.page.getByRole('heading',{name:'order received!'}).waitFor();}
 async function verifyWelcomeMarquee(page, screenshots, size, verify){
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const tracks = page.locator('.kiosk-welcome-track');
  await page.locator('#kioskRoot .kiosk-card').evaluate(card => Promise.all(card.getAnimations().map(animation => animation.finished)));
  const liveMotion = await tracks.evaluateAll(async tracks => {
   const positions = () => tracks.map(track => track.getBoundingClientRect().left);
   const before = positions();
   await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
   return positions().map((x, index) => x - before[index]);
  });
  const directions = [1, -1, 1, -1];
  verify(liveMotion.length === 4 && liveMotion.every((delta, index) => delta * directions[index] > 0),
    'live animation moves right, left, right, left');

  const capture = async elapsed => {
   const frame = await tracks.evaluateAll((tracks, time) => {
    for (const track of tracks) {
     const animation = track.getAnimations()[0];
     animation.pause();
     animation.currentTime = time;
    }
    const bounds = element => {
     const { x, y, width, height } = element.getBoundingClientRect();
     return [x, y, width, height];
    };
    const root = document.getElementById('kioskRoot');
    return {
     elapsedMs: time,
     card: bounds(root.querySelector('.kiosk-card')),
     logo: bounds(root.querySelector('.kiosk-logo')),
     scroll: [scrollX, scrollY, root.scrollWidth, root.clientWidth],
     rows: tracks.map(track => {
      const style = getComputedStyle(track), row = track.parentElement.getBoundingClientRect();
      const [first, second] = track.children;
      const gap = parseFloat(getComputedStyle(first).columnGap);
      const visible = [...track.querySelectorAll('.kiosk-welcome-arch')].flatMap(tile => {
       const rect = tile.getBoundingClientRect();
       return rect.right > row.left + .1 && rect.left < row.right - .1
        ? [{ left: rect.left - row.left, right: rect.right - row.left, tone: tile.dataset.tone, name: tile.textContent }]
        : [];
      });
      const spans = [visible[0].left, ...visible.slice(1).map((tile, index) => tile.left - visible[index].right),
       row.width - visible.at(-1).right];
      return {
       translation: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41,
       cycleWidth: first.getBoundingClientRect().width,
       duplicate: first.innerHTML === second.innerHTML && Math.abs(first.getBoundingClientRect().width - second.getBoundingClientRect().width) < .1,
       maxGap: Math.max(...spans), gap, visible,
       timing: [style.animationDuration, style.animationTimingFunction, style.animationIterationCount, style.animationDirection]
      };
     })
    };
   }, elapsed);
   if (screenshots) await page.screenshot({ path: path.join(screenshots, size + '-marquee-t' + String(elapsed).padStart(5, '0') + 'ms.png') });
   return frame;
  };

  const frames = [];
  for (const elapsed of [0, 1000, 45900, 46000, 46100]) frames.push(await capture(elapsed));
  const [start, moving, beforeLoop, loop, afterLoop] = frames;
  const near = (a, b) => Math.abs(a - b) < .2;
  function hasLinearMotion(from, to, elapsed) {
   return to.rows.every((row, index) => {
    const delta = row.translation - from.rows[index].translation;
    const wrappedDelta = delta - Math.round(delta / row.cycleWidth) * row.cycleWidth;
    return near(wrappedDelta, directions[index] * row.cycleWidth * elapsed / 46000);
   });
  }
  verify(start.rows.every((row, index) => row.duplicate && row.timing.join(' ') ===
    '46s linear infinite ' + (index % 2 ? 'normal' : 'reverse')), 'four matched cycles use the prototype’s linear 46-second timing');
  verify(hasLinearMotion(start, moving, 1000) && hasLinearMotion(beforeLoop, loop, 100)
    && hasLinearMotion(loop, afterLoop, 100), 'all four rows keep direction and speed through the loop boundary');
  verify(start.rows.every((row, index) => {
   const next = loop.rows[index].visible;
   return row.visible.length === next.length && row.visible.every((tile, i) =>
    tile.name === next[i].name && tile.tone === next[i].tone && near(tile.left, next[i].left) && near(tile.right, next[i].right));
  }), 'full loop reproduces the original visible tiles and positions');
  verify(frames.every(frame => frame.rows.every(row => row.maxGap <= row.gap + .2)),
    'every frame keeps the normal tile spacing through the loop seam');
  verify(frames.every(frame => frame.card.every((value, index) => near(value, start.card[index]))
    && frame.logo.every((value, index) => near(value, start.logo[index]))
    && frame.scroll[0] === 0 && frame.scroll[1] === 0 && frame.scroll[2] <= frame.scroll[3]),
    'card and logo stay fixed without horizontal page scrolling');
  if (screenshots) fs.writeFileSync(path.join(screenshots, size + '-marquee-timing.json'), JSON.stringify(frames, null, 2) + '\n');
  await page.emulateMedia({ reducedMotion: 'reduce' });
 }
 async function catalogSurfaceRaces(){
  const catalogRows=revision=>{
   const product={id:id(610),name:'Race Brew '+revision,category_id:id(600),is_published:true,is_available:true,is_curv_pick:true};
   return {
    public_menu_categories:[{id:id(600),name:'Race Drinks',sort_order:0},{id:id(601),name:'Second Category',sort_order:1}],
    public_menu_products:[product,{id:id(611),name:'Second Brew',category_id:id(601),is_published:true,is_available:true}],
    public_menu_product_sizes:[{id:id(620),product_id:product.id,label:'Regular',price:145},{id:id(621),product_id:id(611),label:'Regular',price:155}],
    public_menu_option_groups:[{product_id:product.id,option_group_id:id(630),group_key:'extra',name:'Extra',
     selection_type:'single',is_required:false,min_selections:0,max_selections:1}],
    public_menu_option_choices:[{product_id:product.id,option_group_id:id(630),option_choice_id:id(631),label:'Oat milk',value:'oat',price_delta:5}]
   };
  };
  for(const [width,height] of [[1180,820],[1024,768],[820,1180],[768,1024]]){
   const size=width+'x'+height;
   const race=(ok,message)=>check(ok,message+' '+size,'catalog-surface-races');
   const ready=async()=>{
    const f=await open({touch:true,delayCatalog:true,mode:'uncertain'});
    await f.page.setViewportSize({width,height});
    await f.page.waitForFunction(()=>fixtureCatalogStarted(0));
    await onboard(f,'Catalog guest','FOR HERE');
    await f.page.locator('#f-notes').fill('Existing order note');
    await f.page.getByRole('button',{name:'Close cart'}).tap();
    return f;
   };
   const complete=async(p,index,revision)=>{
    await p.evaluate(({index,rows})=>releaseFixtureCatalog(index,rows),{index,rows:catalogRows(revision)});
    await p.waitForFunction(name=>document.querySelector('#curv-picks-supabase-mount').textContent.includes(name),'Race Brew '+revision);
   };
   const start=async p=>{
    const index=await p.evaluate(()=>{
     const index=holdFixtureCatalog();
     publicMenuFetchStarted=false;
     void fetchPublicMenuFromSupabase();
     return index;
    });
    await p.waitForFunction(index=>fixtureCatalogStarted(index),index);
    return index;
   };
   const openFallback=p=>p.locator('#curv-picks-hardcoded-fallback .unified-product-card:not(:disabled)').first().tap();
   const state=p=>p.evaluate(()=>{
    const panel=document.querySelector('.kiosk-product-dialog');
    const cartWindow=document.getElementById('formFloat'),confirm=document.getElementById('orderConfirmOverlay');
    return {
     dialog:panel?.id||null,dialogInert:panel?Boolean(panel.closest('[inert]')):null,
     cart:cartWindow.getClientRects().length>0,cartInert:cartWindow.inert,
     confirm:!confirm.hidden,confirmInert:confirm.inert,protectedScreen:!document.getElementById('kioskRoot').hidden,
     mainInert:document.querySelector('main').inert,locked:document.body.classList.contains('kiosk-surface-open'),
     scrollLocked:getComputedStyle(document.documentElement).overflowY==='hidden',
     menuInert:['#navTabs','#menuSearchInput','#orderBarButton'].map(selector=>Boolean(document.querySelector(selector).closest('[inert]'))),
     menuFocus:document.activeElement.matches('.nav-tab.active, .product-card'),
     note:document.getElementById('f-notes').value,draft:JSON.stringify(cart)
    };
   });
   const unlocked=s=>!s.dialog&&!s.locked&&!s.scrollLocked&&s.menuInert.every(value=>!value);
   const checkoutCalls=f=>f.db.calls.filter(call=>['kiosk_quote','kiosk_admit','kiosk_submit','kiosk_recover','kiosk_confirm_price'].includes(call.name)).map(call=>call.name);
   let f=await open({touch:true,delayCatalog:true}),p=f.page;
   await p.setViewportSize({width,height});
   await p.waitForFunction(()=>fixtureCatalogStarted(0));
   const welcome = p.getByRole('heading', { name: 'Welcome to Curv!' });
   const startButton = p.getByRole('button', { name: 'Tap to order' });
   const arches = p.locator('.kiosk-welcome-arch');
   const verify = (ok, message) => check(ok, message + ' ' + size, 'welcome');

   await welcome.waitFor();
   verify(await p.locator('.kiosk-welcome-arches').getAttribute('aria-hidden') === 'true'
     && (await arches.allTextContents()).every(text => text === '') && await arches.count() === 96,
     'loading shows decorative arches without sample product names');
   verify(await p.locator('.kiosk-welcome-track').evaluateAll(tracks => tracks.length === 4
     && tracks.every(track => track.getAnimations().length === 0)), 'reduced motion keeps all four rows still');
   await p.evaluate(() => { window.welcomeTracksBeforeCatalog = [...document.querySelectorAll('.kiosk-welcome-track')]; });
   verify(await p.locator('#kioskRoot').evaluate(root => {
     const viewport = root.getBoundingClientRect();
     const card = root.querySelector('.kiosk-card').getBoundingClientRect();
     const title = root.querySelector('h1').getBoundingClientRect();
     const button = root.querySelector('button').getBoundingClientRect();
     const titleInset = Math.min(title.left - card.left, card.right - title.right);
     const center = (card.left + card.right) / 2;
     const hit = document.elementFromPoint(8, 8);
     return Math.abs(viewport.width - innerWidth) < 1 && Math.abs(viewport.height - innerHeight) < 1
       && Math.abs(center - innerWidth / 2) < 2 && Math.abs((card.top + card.bottom) / 2 - innerHeight / 2) < 2
       && titleInset >= 28 && title.top >= card.top + 24 && button.bottom <= card.bottom - 24
       && button.width >= 56 && button.height >= 56 && root.scrollWidth <= root.clientWidth
       && root.scrollHeight <= root.clientHeight && hit?.matches('.kiosk-welcome-start')
       && getComputedStyle(document.documentElement).overflowY === 'hidden' && document.querySelector('main').inert;
   }), 'welcome fills the viewport, centers its padded card and captures edge taps');
   verify(await startButton.evaluate(button => button === document.activeElement), 'start has keyboard focus');
   const screenshots = process.env.CURV_KIOSK_WELCOME_SCREENSHOTS;
   if (screenshots) {
    await p.evaluate(() => document.fonts.ready.then(() => true));
    verify(await p.locator('#kioskRoot .kiosk-logo').evaluate(async img => {
     await img.decode();
     return img.naturalWidth > 0 && new URL(img.src).pathname === '/kiosk/curv-logo-traced.svg';
    }), 'original logo loads');
    verify(await p.evaluate(async checkJost => {
     const display = await document.fonts.load('76px Poppin', 'Welcome to Curv!');
     const ui = checkJost ? await document.fonts.load('700 24px Jost', 'Tap to order') : display;
     return display.some(face => face.status === 'loaded') && ui.some(face => face.status === 'loaded');
    }, Boolean(process.env.CURV_KIOSK_WELCOME_JOST)), 'welcome fonts load from the offline fixture');
    if (width === 1180) await p.screenshot({ path: path.join(screenshots, size + '-welcome-loading.png') });
   }
   const catalog = catalogRows('welcome');
   catalog.public_menu_products[0].name = 'Americano';
   catalog.public_menu_products[1].name = 'Banana Pudding';
   const names = ['Iced Café Latte', 'Vanilla Cream Cold Brew', 'Hojicha Latte', 'Cocoa Matcha',
     'Sea Salt Cream Matcha Latte with Vanilla Sweet Cream Cold Foam', 'Citrus Fizz', 'Cold Brew <Blend>'];
   names.forEach((name, index) => {
    const productId = id(710 + index);
    catalog.public_menu_products.push({ id: productId, name, category_id: id(600), is_published: true, is_available: true });
    catalog.public_menu_product_sizes.push({ id: id(720 + index), product_id: productId, label: 'Regular', price: 150 });
   });
   await p.evaluate(rows => releaseFixtureCatalog(0, rows), catalog);
   await p.waitForFunction(() => [...document.querySelectorAll('.kiosk-welcome-arch')].some(el => el.textContent === 'Cold Brew <Blend>'));
   const tiles = await arches.allTextContents();
   verify(names.every(name => tiles.includes(name)) && tiles.every(name => catalog.public_menu_products.some(product => product.name === name))
     && await arches.locator(':scope > :not(span), span *').count() === 0, 'late live-catalog labels render as text');
   verify(await p.locator('.kiosk-welcome-track').evaluateAll(tracks =>
     tracks.every((track, index) => track === window.welcomeTracksBeforeCatalog[index])),
     'catalog hydration preserves the existing tracks');
   verify(await arches.evaluateAll(tiles => tiles.filter(tile => tile.getClientRects().length).every(tile => {
    const tileBounds = tile.getBoundingClientRect(), label = tile.firstElementChild.getBoundingClientRect();
    return label.top >= tileBounds.top && label.bottom <= tileBounds.bottom && label.width <= tileBounds.width;
   })), 'long catalog labels stay inside their arches');
   if (screenshots) await p.screenshot({ path: path.join(screenshots, size + '-welcome.png') });
   await verifyWelcomeMarquee(p, screenshots, size, verify);

   if (width === 1180) {
    await p.touchscreen.tap(8, 8);
    await p.touchscreen.tap(8, 8);
   } else if (width === 1024) {
    await p.keyboard.press('Enter');
   } else {
    await startButton.tap();
   }
   const input = p.getByLabel('Your nickname');
   await input.waitFor();
   verify(await input.inputValue() === '' && await welcome.count() === 0
     && await p.getByRole('button', { name: 'FOR HERE', exact: true }).count() === 0,
     'touch, repeated taps or keyboard advance only to nickname');
   verify(JSON.stringify(f.db.calls.map(call => call.name)) === JSON.stringify(['kiosk_context', 'kiosk_begin'])
     && await p.evaluate(() => sessionStorage.getItem(curvCheckout.storageKey) === null),
     'welcome and start create no checkout or protected request');
   await f.context.close();
   f=await ready();p=f.page;
   const draft=(await state(p)).draft;
   await openFallback(p);
   let ui=await state(p);
   race(ui.dialog&&ui.locked&&ui.scrollLocked&&ui.menuInert.every(Boolean),'pending catalog leaves fallback product in charge of input');
   await complete(p,0,1);
   ui=await state(p);
   race(unlocked(ui),'replacing the open fallback releases its input lock');
   race(ui.menuFocus,'replacement restores focus to the active menu category or product');
   race(ui.draft===draft&&ui.note==='Existing order note','catalog replacement preserves the order draft');
   await p.getByRole('button',{name:'Second Category',exact:true}).tap();
   race(await p.getByRole('button',{name:'Customize Second Brew'}).isVisible(),'category navigation accepts taps');
   await p.locator('#menuSearchInput').fill('Race Brew 1');
   await p.getByRole('option').filter({hasText:'Race Brew 1'}).first().tap();
   const product=p.locator('.section.active').getByRole('button',{name:'Customize Race Brew 1',exact:true});
   await product.tap();
   const dialog=p.locator('.kiosk-product-dialog');
   await dialog.locator('.public-customize > button').tap();
   await dialog.locator('[data-customize-group="extra"] > button').tap();
   const choice=dialog.getByRole('button',{name:/^Oat milk/});
   await choice.tap();
   race(await choice.getAttribute('aria-pressed')==='true','search and product taps reach working catalog options');
   const updated=await start(p);
   await complete(p,updated,2);
   race(unlocked(await state(p)),'an update that replaces a live product dismisses only that product');

   // A deliberately retained static surface exercises the same-node branch.
   await p.evaluate(()=>{
    jumpToPanel('seasonal',null);
    const wrap=document.createElement('div');
    wrap.id='panel-wrap-retained-fixture';wrap.className='menu-item-wrap public-item-wrap';
    wrap.innerHTML='<div id="panel-retained-fixture" class="expansion-panel"><div class="panel-inner">Retained customization</div></div>';
    document.getElementById('seasonal').append(wrap);
    togglePanel('retained-fixture');
   });
   const retained=await start(p);
   await complete(p,retained,3);
   ui=await state(p);
   race(ui.dialog==='panel-retained-fixture'&&!ui.dialogInert&&ui.locked&&ui.menuInert.every(Boolean),
    'a still-valid customization keeps its own lock');
   await p.keyboard.press('Escape');
   race(unlocked(await state(p)),'retained customization can still close after hydration');

   const older=await start(p),newer=await start(p);
   await complete(p,newer,5);
   await p.locator('#orderBarButton').tap();
   race(await p.locator('#formFloat').isVisible(),'order bar opens the preserved draft');
   await complete(p,older,4);
   ui=await state(p);
   race(ui.cart&&!ui.cartInert&&ui.locked&&ui.menuInert.every(Boolean)&&ui.draft===draft&&ui.note==='Existing order note',
    'out-of-order catalog response preserves the active cart and its draft');
   race(checkoutCalls(f).length===0,'product and cart navigation send no checkout calls');

   await review(f);
   const reviewing=await start(p);
   await complete(p,reviewing,6);
   ui=await state(p);
   race(ui.confirm&&!ui.confirmInert&&!ui.cart&&ui.locked&&ui.menuInert.every(Boolean),'catalog response preserves protected confirmation input');
   race(JSON.stringify(checkoutCalls(f))==='["kiosk_quote"]','catalog response does not repeat the explicit quote');
   await confirm(f);
   await p.getByRole('button',{name:'Recover previous order',exact:true}).waitFor();
   const pending=()=>p.evaluate(()=>sessionStorage.getItem(curvCheckout.storageKey));
   const frozen=await pending(),calls=JSON.stringify(checkoutCalls(f));
   const recovering=await start(p);
   await complete(p,recovering,7);
   ui=await state(p);
   race(ui.protectedScreen&&!ui.cart&&!ui.confirm&&ui.mainInert&&ui.locked&&ui.scrollLocked&&ui.menuInert.every(Boolean),'catalog response preserves the recovery screen and controller-owned lock');
   race(Boolean(frozen)&&await pending()===frozen&&JSON.stringify(checkoutCalls(f))===calls,'catalog response leaves the protected request and RPC counts intact');
   await f.context.close();

   f=await ready();p=f.page;
   await openFallback(p);
   await p.locator('.kiosk-product-dialog').getByRole('button',{name:/Back to menu/}).tap();
   race(unlocked(await state(p)),'closing fallback before the response releases input normally');
   await complete(p,0,1);
   race(unlocked(await state(p))&&checkoutCalls(f).length===0,'late response after Back leaves menu usable and sends no checkout calls');
   await f.context.close();
  }
 }
 try{
  await catalogSurfaceRaces();
  let f=await open();let p=f.page;
  await startWelcome(p);
  if(process.env.CURV_KIOSK_SCREENSHOTS)await p.screenshot({path:path.join(process.env.CURV_KIOSK_SCREENSHOTS,'kiosk-name.png')});
  check(await p.locator('#kioskNickname').inputValue()==='','name-first has no saved profile');
  for(const bad of ['', '   ', 'x'.repeat(81)]){await p.getByLabel('Your nickname').fill(bad);await p.getByRole('button',{name:'Continue',exact:true}).click();check((await p.locator('#kioskNameError').textContent()).includes('1–80'),'nickname invalid input rejected','validation');}
  await p.getByLabel('Your nickname').fill('Alex <&> ♡');await p.getByRole('button',{name:'Continue',exact:true}).click();
  if(process.env.CURV_KIOSK_SCREENSHOTS)await p.screenshot({path:path.join(process.env.CURV_KIOSK_SCREENSHOTS,'kiosk-mode.png')});
  check(await p.getByRole('button',{name:'FOR HERE',exact:true}).count()===1&&await p.getByRole('button',{name:'TO GO',exact:true}).count()===1,'exactly two fulfillment choices');
  check((await p.locator('.kiosk-nickname').textContent())==='Alex <&> ♡'&&await p.locator('.kiosk-nickname *').count()===0,'nickname rendered as safe text','validation');
  await p.getByRole('button',{name:'Back',exact:true}).click();
  await onboard(f);await review(f);
  check((await p.locator('#orderConfirmBody').textContent()).includes('Server coffee')&&(await p.locator('#orderConfirmBody').textContent()).includes('150.00'),'authoritative review excludes forged local price','checkout');
  for(const size of [{width:768,height:1024},{width:1024,height:768},{width:390,height:844}]){await p.setViewportSize(size);check(await p.locator('.order-confirm-card').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'review fits '+size.width+'px','geometry');}
  await confirm(f);await success(f);
  if(process.env.CURV_KIOSK_SCREENSHOTS)await p.screenshot({path:path.join(process.env.CURV_KIOSK_SCREENSHOTS,'kiosk-success.png')});
  check((await p.locator('.kiosk-order-number').textContent())==='C-9001','actual confirmed number displayed','checkout');
  const sent=f.db.attempt.payload;check(sent.fulfillment_type==='pickup','TO GO maps to pickup','checkout');
  check(!('customer_phone'in sent)&&!('delivery_address'in sent)&&!('customer_email'in sent),'no fabricated personal fields','checkout');
  check(await p.evaluate(()=>!JSON.parse(sessionStorage.getItem(curvCheckout.storageKey)).payload),'personal frozen body removed after verified success','privacy');
  await p.getByRole('button',{name:'Done · New customer'}).click();await welcomeHeading(p).waitFor();
  check(await p.getByLabel('Your nickname').count()===0,'manual receipt reset stops at welcome','welcome');
  await startWelcome(p);
  check(await p.evaluate(()=>cart.length===0&&document.getElementById('kioskNickname').value===''),'manual reset fresh customer','privacy');
  check(await p.evaluate(()=>localStorage.getItem('curv-latest-public-order')==='personal recent sentinel'&&sessionStorage.getItem('curv-pending-order-v2')==='personal recovery sentinel'),'normal browser stores unchanged','privacy');
  await onboard(f,'Second customer','FOR HERE');await review(f);await confirm(f);await success(f);check(f.db.attempt.payload.fulfillment_type==='dine_in','FOR HERE maps to dine_in','checkout');
  await p.clock.fastForward(60001);await welcomeHeading(p).waitFor();check(await p.getByLabel('Your nickname').count()===0,'receipt timer resets to welcome','welcome');await startWelcome(p);check(await p.getByLabel('Your nickname').inputValue()==='','60-second reset fresh name','privacy');await f.context.close();
  for(const mode of ['lost-response','lost-admit','held']){
   f=await open({mode});p=f.page;await onboard(f);await review(f);await confirm(f);
   if(mode==='held'){await p.waitForFunction(()=>!!sessionStorage.getItem('curv-kiosk-v2:pending'));await p.clock.fastForward(30001);}
   await p.locator('#kioskRoot').getByRole('button',{name:'Recover previous order',exact:true}).waitFor();const saved=await p.evaluate(()=>sessionStorage.getItem(curvCheckout.storageKey));
   check(await welcomeHeading(p).count()===0,'protected recovery takes priority over welcome '+mode,'welcome');
   await p.clock.fastForward(180000);check(await p.evaluate(()=>sessionStorage.getItem(curvCheckout.storageKey))===saved,'uncertain inactivity preserves frozen request '+mode,'recovery');
   if(mode==='held'){f.db.release();await p.waitForTimeout(50);check(await p.getByRole('heading',{name:'order received!'}).count()===0,'late timed-out response cannot fabricate local success','recovery');}
   await p.reload();await p.waitForFunction(()=>/Welcome to Curv!|order received|Let’s check that order/.test(document.getElementById('kioskRoot')?.textContent||''));
   const recoverButton=p.locator('#kioskRoot').getByRole('button',{name:'Recover previous order',exact:true});
   if(await recoverButton.isVisible())await recoverButton.click();
   await p.waitForFunction(()=>/Welcome to Curv!|order received/.test(document.getElementById('kioskRoot')?.textContent||''));
   check(f.db.orders===1,'uncertain replay creates one order '+mode,'recovery');
   check(f.db.calls.filter(c=>c.name==='kiosk_admit').every(c=>c.args.p_payload.submission_key===JSON.parse(saved).key),'same key through reload/recovery '+mode,'recovery');
   await f.context.close();
  }
  f=await open({authorized:false});await f.page.getByRole('heading',{name:'A little help from CURV'}).waitFor();check(await f.page.getByLabel('Your nickname').count()===0&&await welcomeHeading(f.page).count()===0,'unauthorized device cannot enter ordering','authorization');await f.context.close();
  f=await open({mode:'price-change'});p=f.page;await onboard(f);await review(f);await confirm(f);await p.getByRole('button',{name:'Confirm Updated Order'}).waitFor();check(f.db.orders===0,'changed price requires another explicit review','checkout');await p.getByRole('button',{name:'Confirm Updated Order'}).click();await success(f);check(f.db.orders===1&&new Set(f.db.calls.filter(c=>c.name==='kiosk_submit').map(c=>c.args.p_key)).size===1,'updated review retains one key and one order','checkout');await f.context.close();
  f=await open({legacy:true});await f.page.getByRole('heading',{name:'A little help from CURV'}).waitFor();check(await f.page.evaluate(()=>sessionStorage.getItem('curv-kiosk:curv-pending-order-v2'))==='legacy unresolved sentinel','legacy recovery never discarded','recovery');await f.context.close();
  f=await open({storageDenied:true});await onboard(f);await review(f);await confirm(f);await f.page.waitForTimeout(50);check(f.db.calls.every(c=>c.name!=='kiosk_admit'&&c.name!=='kiosk_submit'),'storage failure blocks all mutation transport','recovery');await f.context.close();
  f=await open();await onboard(f);await f.page.evaluate(()=>kioskSignOut());await f.page.getByRole('heading',{name:'A little help from CURV'}).waitFor();check(await f.page.locator('#kioskBanner').count()===0,'signout masks nickname/cart immediately','privacy');await f.context.close();
  f=await open();p=f.page;await onboard(f);await p.reload();await startWelcome(p);check(await p.evaluate(()=>cart.length===0&&document.getElementById('kioskNickname').value===''),'draft reload does not restore previous customer','privacy');
  const abandonedGeneration=f.db.generation, beforeIdle=f.db.calls.length;
  await p.clock.fastForward(121001);await welcomeHeading(p).waitFor();
  const idleCalls=f.db.calls.slice(beforeIdle);
  check(idleCalls.some(c=>c.name==='kiosk_close'&&c.args.p_draft&&c.args.p_generation===abandonedGeneration)
    &&f.db.generation!==abandonedGeneration,'abandoned pre-admission draft closes safely before welcome','privacy');
  check(idleCalls.every(c=>['kiosk_close','kiosk_context','kiosk_begin'].includes(c.name))
    &&await p.getByLabel('Your nickname').count()===0,'idle reset shows welcome without checkout calls','welcome');
  await f.context.close();
  f=await open();p=f.page;await onboard(f,'Back privacy');await p.goto('https://curv.test/blank');await p.goBack();await welcomeHeading(p).waitFor();check(await p.evaluate(()=>cart.length===0&&!document.getElementById('kioskBanner')),'ordinary Back starts private fresh welcome screen','privacy');await f.context.close();
  f=await open();p=f.page;await onboard(f,'Cached customer');await p.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await p.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await welcomeHeading(p).waitFor();check(!(await p.locator('#kioskRoot').textContent()).includes('Cached customer'),'BFCache-event restoration revalidates before showing data','privacy');await f.context.close();
  f=await open();p=f.page;await welcomeHeading(p).waitFor();const second=await f.context.newPage();await second.goto('https://curv.test/menu/?kiosk=1');await second.getByRole('heading',{name:'A little help from CURV'}).waitFor();check((await second.locator('#kioskRoot').textContent()).includes('already open'),'second tab cannot share active customer controls','privacy');await f.context.close();
  f=await open();p=f.page;await onboard(f);await review(f);await confirm(f);await success(f);await p.clock.fastForward(59000);check(await p.locator('.kiosk-order-number').isVisible(),'success remains before inactivity deadline','privacy');await p.locator('#kioskRoot').dispatchEvent('pointerdown');await p.clock.fastForward(59000);check(await p.locator('.kiosk-order-number').isVisible(),'activity extends success deadline','privacy');await p.clock.fastForward(1001);await startWelcome(p);check(await p.getByLabel('Your nickname').inputValue()==='','extended inactivity eventually resets','privacy');await f.context.close();
  f=await open();p=f.page;await onboard(f);await review(f);await confirm(f);await success(f);await p.evaluate(()=>{Storage.prototype.removeItem=function(){throw Error('denied');};});await p.getByRole('button',{name:'Done · New customer'}).click();await p.getByRole('heading',{name:'A little help from CURV'}).waitFor();check(await p.getByLabel('Your nickname').count()===0&&await welcomeHeading(p).count()===0,'cleanup failure cannot expose a new customer screen','privacy');await f.context.close();


  // Actual recovered review: server intent stays fixed while volatile UI is rebuilt.
  for(const type of ['pickup','dine_in'])for(const transition of ['reload','visibility']){
   const label=type==='pickup'?'TO GO':'FOR HERE';
   f=await open({mode:'uncertain'});p=f.page;await onboard(f,'Recovery guest',label);await review(f);
   check((await p.locator('#orderConfirmBody').textContent()).includes(label),'initial label '+type+' '+transition,'recovery-label');await confirm(f);
   await p.locator('#kioskRoot').getByRole('button',{name:'Recover previous order',exact:true}).waitFor();
   const frozen=await p.evaluate(()=>sessionStorage.getItem(curvCheckout.storageKey));const original=structuredClone(f.db.attempt.payload);
   f.db.mode='price-change';
   if(transition==='reload')await p.reload();else await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
   await p.locator('#kioskRoot').getByRole('button',{name:'Recover previous order',exact:true}).waitFor();await p.locator('#kioskRoot').getByRole('button',{name:'Recover previous order',exact:true}).click();
   await p.getByRole('button',{name:'Confirm Updated Order'}).waitFor();
   check(!await p.locator('#formFloat').isVisible(),'changed-price review works with editable cart closed '+type+' '+transition,'full-screen-surfaces');
   const body=await p.locator('#orderConfirmBody').textContent();check(body.includes(label)&&!body.includes(type==='pickup'?'FOR HERE':'TO GO'),'recovered authoritative label '+type+' '+transition,'recovery-label');
   check(f.db.orders===0,'no order before updated-price consent '+type+' '+transition,'recovery-label');
   check(f.db.attempt.payload.fulfillment_type===type,'server intent not replaced '+type+' '+transition,'recovery-label');
   await p.getByRole('button',{name:'Confirm Updated Order'}).click();await success(f);
   check(f.db.orders===1,'one confirmed order '+type+' '+transition,'recovery-label');
   check(new Set(f.db.calls.filter(c=>c.name==='kiosk_submit').map(c=>c.args.p_key)).size===1&&f.db.attempt.key===JSON.parse(frozen).key,'same key '+type+' '+transition,'recovery-label');
   check(JSON.stringify(f.db.attempt.payload)===JSON.stringify(original),'admitted request unchanged '+type+' '+transition,'recovery-label');
   check((await p.locator('.kiosk-order-number').textContent())==='C-9001','server receipt '+type+' '+transition,'recovery-label');
   await p.getByRole('button',{name:'Done · New customer'}).click();await welcomeHeading(p).waitFor();
   check(await p.evaluate(()=>sessionStorage.getItem('curv-kiosk-v2:pending')===null&&cart.length===0),'closed customer isolated '+type+' '+transition,'recovery-label');
   await onboard(f,'Fresh guest',type==='pickup'?'FOR HERE':'TO GO');await review(f);
   check((await p.locator('#orderConfirmBody').textContent()).includes(type==='pickup'?'FOR HERE':'TO GO'),'next customer own mode '+type+' '+transition,'recovery-label');await f.context.close();
  }
  for(const invalid of ['missing','malformed','payload-key','generation','device','server-intent','missing-admission-key','wrong-admission-key']){
   f=await open({mode:'uncertain'});p=f.page;await onboard(f);await review(f);await confirm(f);await p.locator('#kioskRoot').getByRole('button',{name:'Recover previous order',exact:true}).waitFor();
   await p.evaluate(kind=>{const key=curvCheckout.storageKey,v=JSON.parse(sessionStorage.getItem(key));if(kind==='missing')v.payload=null;if(kind==='malformed')v.payload.fulfillment_type='delivery';if(kind==='payload-key')v.payload.submission_key='00000000-0000-4000-8000-000000009999';if(kind==='generation')v.generation='00000000-0000-4000-8000-000000009999';if(kind==='device')v.device='00000000-0000-4000-8000-000000009999';if(kind==='server-intent')v.payload.fulfillment_type='dine_in';sessionStorage.setItem(key,JSON.stringify(v));},invalid);
   if(invalid==='missing-admission-key')f.db.admissionKeyOverride=null;if(invalid==='wrong-admission-key')f.db.admissionKeyOverride=id(9999);
   const frozen=await p.evaluate(()=>sessionStorage.getItem('curv-kiosk-v2:pending'));const submitted=f.db.calls.filter(c=>c.name==='kiosk_submit').length;f.db.mode='price-change';await p.reload();
   await p.waitForFunction(()=>/A little help from CURV|Let’s check that order/.test(document.getElementById('kioskRoot')?.textContent||''));
   const recoverButton=p.locator('#kioskRoot').getByRole('button',{name:'Recover previous order',exact:true});if(await recoverButton.isVisible())await recoverButton.click();
   await p.getByRole('heading',{name:'A little help from CURV'}).waitFor();
   check(await p.getByRole('button',{name:'Confirm Updated Order'}).count()===0,'invalid recovery has no inferred label '+invalid,'recovery-label-negative');
   check(f.db.orders===0&&f.db.calls.filter(c=>c.name==='kiosk_submit').length===submitted,'invalid state cannot submit '+invalid,'recovery-label-negative');
   check(await p.evaluate(()=>sessionStorage.getItem('curv-kiosk-v2:pending'))===frozen,'invalid state retained '+invalid,'recovery-label-negative');await f.context.close();
  }

  for (const approved of [false,true]) {
   const ctx=await browser.newContext(),page=await ctx.newPage();let signedOut=0;
   await ctx.exposeFunction('setupSignedOut',()=>{signedOut++;});
   await ctx.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{}}}),signInWithPassword:async()=>{sessionStorage.setItem('curv-kiosk-v2:device-auth','synthetic-only');return {data:{},error:null};},signOut:async()=>{await window.setupSignedOut();sessionStorage.removeItem('curv-kiosk-v2:device-auth');}},rpc:async()=>window.setupApproval?{data:{contract_version:1}}:{error:{details:'KIOSK_NONSTAFF_REQUIRED'}}})};});
   await ctx.addInitScript(a=>{window.setupApproval=a;window.CURV_KIOSK_CONFIG={enabled:true,supabaseUrl:'https://local.invalid',publishableKey:'public-test-only'};},approved);
   await ctx.route('**/*',async route=>{const url=new URL(route.request().url());if(url.pathname==='/menu/'){await route.fulfill({contentType:'text/html',body:'<h1>Approved device destination</h1>'});return;}if(url.hostname==='cdn.jsdelivr.net'){await route.fulfill({contentType:'text/javascript',body:''});return;}const file=path.join(root,url.pathname);if(fs.existsSync(file)&&fs.statSync(file).isFile())await route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/css'});else await route.abort();});
   await page.goto('https://curv.test/kiosk/setup.html');await page.getByLabel('Device account').fill('synthetic@curv-test.invalid');await page.getByLabel('Device password').fill('disposable-only');await page.getByRole('button',{name:'Verify device'}).click();
   if(approved){await page.getByRole('heading',{name:'Approved device destination'}).waitFor();check(signedOut===0,'approved setup keeps dedicated device session','authorization');}
   else {await page.getByRole('status').filter({hasText:'Device setup is unavailable'}).waitFor();check(signedOut===1&&await page.evaluate(()=>sessionStorage.getItem('curv-kiosk-v2:device-auth'))===null,'rejected nonstaff authorization removes signed-in session','authorization');check(await page.getByLabel('Device password').inputValue()==='','setup rejection removes password from controls','privacy');}
   await ctx.close();
  }
  // Exercise the real catalog, product controls and checkout surfaces at tablet sizes.
  for(const [width,height] of [[1180,820],[1024,768],[820,1180],[768,1024]]){
   f=await open({touch:true,holdController:true});p=f.page;await p.setViewportSize({width,height});
   const size=width+'x'+height;
   const gate=(ok,message)=>check(ok,message+' '+size,'full-screen-surfaces');
   const shot=async name=>{
    if(process.env.CURV_KIOSK_SCREENSHOTS){
     await p.evaluate(()=>document.fonts.ready.then(()=>true));
     await p.screenshot({path:path.join(process.env.CURV_KIOSK_SCREENSHOTS,size+'-'+name+'.png')});
    }
   };
   const rpcCount=name=>f.db.calls.filter(call=>call.name==='kiosk_'+name).length;
   const fillsViewport=locator=>locator.evaluate(el=>{
    const r=el.getBoundingClientRect();
    return Math.abs(r.left)<1&&Math.abs(r.top)<1&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1
      &&el.scrollWidth<=el.clientWidth+1;
   });
   const assertForeground=async locator=>{
    gate(await locator.evaluate(el=>[0.12,0.88].every(fraction=>{
     const hit=document.elementFromPoint(innerWidth*fraction,innerHeight*.85);
     return hit&&el.contains(hit);
    })),'foreground intercepts background taps');
    await p.keyboard.press('Tab');
    gate(await locator.evaluate(el=>el.contains(document.activeElement)),'keyboard focus stays on active surface');
   };
   const viewport=p.locator('#kioskRoot');
   const menuOffset=()=>p.evaluate(()=>Math.round(-document.body.getBoundingClientRect().top) || 0);
   const documentLocked=()=>p.evaluate(()=>getComputedStyle(document.documentElement).overflowY==='hidden');
   const wheelInside=async area=>{
    const box=await area.boundingBox();
    await p.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await p.mouse.wheel(0,400);
    const element=await area.elementHandle();
    try { await p.waitForFunction(el=>el.scrollTop>0,element,{timeout:5000}); }
    finally { await element.dispose(); }
   };
   const cdp=await f.context.newCDPSession(p);
   const swipe=async (x,y,distance,finish='touchEnd')=>{
    const point=position=>[{x:Math.round(x),y:Math.round(position)}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point(y)});
    for(let step=1;step<=5;step++){
     await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:point(y-distance*step/5)});
    }
    await cdp.send('Input.dispatchTouchEvent',{type:finish,touchPoints:[]});
   };
   const assertFrozen=async (surface,offset,label)=>{
    const locked=await documentLocked(),currentOffset=await menuOffset();
    gate(locked&&currentOffset===offset,label+' locks the document and keeps menu position ('+currentOffset+' vs '+offset+')');
    await p.mouse.move(6,8);
    await p.mouse.wheel(0,400);
    await swipe(8,110,90);
    await p.keyboard.press('PageDown');
    await p.evaluate(()=>window.scrollTo({top:700,behavior:'instant'}));
    gate(await menuOffset()===offset,label+' absorbs edge wheel, touch and keyboard scrolling');
    const foreground=await surface.evaluate(el=>el.contains(document.elementFromPoint(innerWidth/2,innerHeight/2)));
    await p.evaluate(()=>document.getElementById('menuSearchInput').focus({preventScroll:true}));
    gate(foreground&&await p.evaluate(()=>document.activeElement.id!=='menuSearchInput'),label+' blocks background hit testing and focus');
   };
   await viewport.getByText('Loading protected in-store ordering').waitFor();
   try { await assertFrozen(viewport,0,'initial loading'); }
   finally { f.releaseController(); }
   await startWelcome(p);
   const nickname=p.getByLabel('Your nickname');
   const design=await viewport.evaluate(root=>{
    const card=root.querySelector('.kiosk-card'),field=card.querySelector('input'),button=card.querySelector('button');
    const r=card.getBoundingClientRect();
    return {
     palette:[root,card,button].map(el=>getComputedStyle(el).backgroundColor),
     logo:new URL(card.querySelector('img').src).pathname,
     composition:Math.abs(r.left+r.width/2-innerWidth/2)<2&&Math.abs(r.top+r.height/2-innerHeight/2)<2
      &&card.querySelector('label').getBoundingClientRect().width>100&&field.placeholder==='',
     sizing:[r.width,field.getBoundingClientRect().height,button.getBoundingClientRect().height],
     focused:document.activeElement===field
    };
   });
   gate(JSON.stringify(design.palette)===JSON.stringify(['rgb(16, 26, 44)','rgb(244, 239, 226)','rgb(14, 79, 47)'])
    &&design.logo==='/kiosk/curv-kiosk-logo.svg'&&design.composition&&design.focused
    &&design.sizing[0]===640&&design.sizing.slice(1).every(height=>height>=56),'restored nickname palette, logo, centered card, visible label, touch sizing and autofocus');
   await shot('nickname-restored');
   await assertFrozen(viewport,0,'nickname');
   await p.getByRole('button',{name:'Continue',exact:true}).tap();
   gate(await p.getByText('Please use a nickname of 1–80 characters.').isVisible()
    &&await nickname.evaluate(el=>el===document.activeElement),'nickname validation and autofocus remain intact');
   await assertFrozen(viewport,0,'nickname validation error');
   await nickname.fill('Mellow Hojicha');
   await p.getByRole('button',{name:'Continue',exact:true}).tap();
   await assertFrozen(viewport,0,'fulfillment');
   await p.getByRole('button',{name:'FOR HERE',exact:true}).tap();
   await p.evaluate(()=>{
    const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const category={id:uuid(1),name:'Tablet Drinks',sort_order:0};
    const products=[
     {id:uuid(2),name:'Sea Salt Cream Matcha Latte with Vanilla Sweet Cream Cold Foam',description:'Matcha and sweet cream over ice.',image_url:'/images/menu/matcha/strawberry-matcha-latte.jpg'},
     ...Array.from({length:16},(_,i)=>({id:uuid(1000+i),name:'Backup brew '+i}))
    ].map(product=>({...product,category_id:category.id,is_published:true,is_available:true,is_curv_pick:true}));
    const sizes=products.map((product,i)=>({id:uuid(10+i),product_id:product.id,label:'Regular',price:145,sort_order:0}));
    const groups=Array.from({length:9},(_,i)=>({product_id:products[0].id,option_group_id:uuid(40+i),group_key:'extra-'+i,
     name:i===0?'Milk':'Extra option '+i,selection_type:'single',is_required:false,min_selections:0,max_selections:1}));
    const choices=groups.map((group,i)=>({product_id:group.product_id,option_group_id:group.option_group_id,
     option_choice_id:uuid(80+i),label:i===0?'Oat milk':'Extra '+i,value:i===0?'oat':'extra-'+i,price_delta:5,sort_order:0}));
    const menu=shapePublicMenuData([category],products,sizes);
    menu.options=buildSupabaseOptionsMap(groups,choices,[],products);
    menu.productsWithoutOptionGroups=new Set(products.slice(1).map(product=>product.id));
    renderPublicMenuFromSupabase(menu);
    isWebsiteOrderingEnabled=true;isPublicOrderTechnicalAvailable=true;renderCart();syncPublicOrderSubmitGate();
   });
   const header=p.locator('.kiosk-menu-header');
   const headerStrip=async()=>{
    const {height}=await header.boundingBox();
    return p.screenshot({clip:{x:40,y:Math.floor(height)-8,width:width-80,height:6}});
   };
   gate(await header.evaluate(el=>getComputedStyle(el).position==='sticky'
    &&getComputedStyle(el).backgroundColor==='rgb(16, 26, 44)'
    &&el.contains(document.getElementById('kioskBanner'))&&el.contains(document.querySelector('.nav-wrap'))),
    'banner and categories share one opaque sticky backing');
   const idleHeader=await headerStrip();
   // Cancel the emulated gesture after the drag so fling cannot race the pixel capture.
   await swipe(width-8,height*.65,270,'touchCancel');
   await p.waitForFunction(()=>window.scrollY>=100,null,{timeout:5000});
   await header.evaluate(el=>{
    const card=document.querySelector('.section.active .unified-product-card');
    const top=window.scrollY+card.getBoundingClientRect().top-el.getBoundingClientRect().bottom+40;
    window.scrollTo({top,behavior:'instant'});
    return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   });
   const scrolledHeader=await headerStrip();
   gate(await header.evaluate(el=>{
    const rect=el.getBoundingClientRect();
    const card=document.querySelector('.section.active .unified-product-card').getBoundingClientRect();
    return Math.abs(rect.top)<1&&el.contains(document.elementFromPoint(card.left+20,rect.bottom-5))
     &&card.top<rect.bottom-8&&card.bottom>rect.bottom-2;
   }),'the sticky header covers a product as it passes beneath');
   gate(idleHeader.equals(scrolledHeader),'header backing pixels stay unchanged where cards scroll underneath');
   await shot('menu-scrolled-header');
   await p.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   const trigger=p.locator('#curv-picks-supabase-mount').getByRole('button',{name:/Customize Sea Salt Cream/});
   await trigger.tap();
   const product=p.locator('.kiosk-product-dialog');
   gate(await product.count()===1&&await fillsViewport(product),'exactly one full-screen customization');
   gate(await product.evaluate(el=>{
    const hero=el.querySelector('.kiosk-product-info').getBoundingClientRect();
    const options=el.querySelector('.panel-options').getBoundingClientRect();
    return innerWidth>innerHeight?hero.right<=options.left+1:hero.bottom<=options.top+1;
   }),'landscape split or portrait stack');
   gate(await p.locator('#orderBarButton').evaluate(el=>Boolean(el.closest('[inert]'))),'menu order bar is inert');
   await assertForeground(product);
   await shot('product');
   if(width===1180){
    await product.locator('.customize-note > button').tap();
    await product.locator('.panel-note-input').fill('Private product request');
    await p.evaluate(()=>{
     Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
     document.dispatchEvent(new Event('visibilitychange'));
     Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
     document.dispatchEvent(new Event('visibilitychange'));
    });
    await startWelcome(p);
    gate(await product.count()===0&&await p.evaluate(()=>[...document.querySelectorAll('.panel-note-input')].every(el=>!el.value)),
      'same-tab privacy reset closes the product and clears the previous request');
    await p.getByLabel('Your nickname').fill('Mellow Hojicha');
    await p.getByRole('button',{name:'Continue',exact:true}).tap();
    await p.getByRole('button',{name:'FOR HERE',exact:true}).tap();
    await p.getByRole('button',{name:'CURV Picks',exact:true}).tap();
    await trigger.tap();
   }
   await product.getByRole('button',{name:/Back to menu/}).tap();
   gate(await product.count()===0&&await trigger.evaluate(el=>el===document.activeElement),'Back returns to menu and restores the product trigger');
   const productOffset=await menuOffset();
   await trigger.tap();
   await assertFrozen(product,productOffset,'customization');
   await product.locator('.public-customize > button').tap();
   await product.locator('[data-customize-group="extra-0"] > button').tap();
   await product.getByRole('button',{name:/Oat milk/}).tap();
   const itemNote=product.locator('.panel-note-input');
   if(!await itemNote.isVisible()) await product.locator('.customize-note > button').tap();
   await itemNote.fill('Less ice, please');
   const optionsArea=product.locator('.panel-options');
   await optionsArea.evaluate(el=>{el.scrollTop=0;});
   await wheelInside(optionsArea);
   gate(await menuOffset()===productOffset,'scrolling product options keeps the menu stationary');
   await p.evaluate(()=>{
    document.body.style.setProperty('--kiosk-order-viewport-height','420px');
    document.body.style.setProperty('--kiosk-order-viewport-top','32px');
    document.activeElement.scrollIntoView({block:'nearest',behavior:'instant'});
   });
   gate(await itemNote.evaluate(el=>{
    const r=el.getBoundingClientRect(),area=el.closest('.panel-options').getBoundingClientRect();
    const action=el.closest('.kiosk-product-dialog').querySelector('.panel-add-btn').getBoundingClientRect();
    return r.top>=area.top-1&&r.bottom<=area.bottom+1&&action.bottom<=452;
   }),'product note and Add stay clear of the simulated keyboard');
   await shot('product-keyboard');
   await p.evaluate(()=>window.visualViewport.dispatchEvent(new Event('resize')));
   gate(await product.locator('.panel-options').evaluate(el=>el.scrollHeight>el.clientHeight),'many options have an independent scroll area');
   const add=product.locator('.panel-add-btn');
   gate(await add.evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=56&&r.bottom<=innerHeight+1;}),'Add stays on screen while options scroll');
   await shot('product-options');
   await add.tap();
   const cartWindow=p.locator('#formFloat');
   gate(await product.count()===0&&!await cartWindow.isVisible(),'Add returns to menu without opening the cart');
   gate(!await documentLocked()&&await menuOffset()===productOffset,'product close restores the previous menu scroll position');
   gate(await p.locator('#orderBarButton').isVisible()&&await trigger.evaluate(el=>el===document.activeElement),'order bar is available and product focus restored after Add');
   gate(rpcCount('quote')===0&&rpcCount('admit')===0&&rpcCount('submit')===0,'adding to the draft does not call checkout');
   const bar=p.locator('#orderBarButton');
   await p.evaluate(()=>window.scrollTo({top:160,behavior:'instant'}));
   const savedMenuOffset=await menuOffset();
   gate(savedMenuOffset===160,'fixture has a non-zero menu scroll position');
   await bar.tap();
   gate(await fillsViewport(cartWindow)&&await cartWindow.getByRole('heading',{name:'Your order'}).count()===1,'one full-screen editable cart');
   gate(await cartWindow.locator('textarea:visible').count()===1&&!await cartWindow.locator('#minimizeBtn').isVisible()
     &&!await cartWindow.locator('#minimizedBar').isVisible(),'one order notes field and no Expand or Minimize interaction');
   gate(await p.locator('main').evaluate(el=>el.inert)&&!await p.locator('#orderConfirmOverlay').isVisible(),'cart blocks menu and stands alone');
   await assertForeground(cartWindow);
   await assertFrozen(cartWindow,savedMenuOffset,'editable cart');
   const row=cartWindow.locator('.cart-item').first(),note=cartWindow.locator('#f-notes');
   gate((await row.textContent()).includes('oat')&&(await row.textContent()).includes('Less ice, please'),'item option and request are displayed as text');
   await row.getByRole('button',{name:'+',exact:true}).tap();
   gate(await row.locator('.cart-qty-num').textContent()==='2','quantity increment works');
   await row.getByRole('button',{name:'−',exact:true}).tap();
   gate(await row.locator('.cart-qty-num').textContent()==='1','quantity decrement works');
   await note.fill('Counter order note');
   await shot('cart');
   await cartWindow.getByRole('button',{name:'Close cart',exact:true}).tap();
   gate(!await cartWindow.isVisible()&&await bar.evaluate(el=>el===document.activeElement),'X closes cart and restores order-bar focus');
   gate(!await documentLocked()&&await menuOffset()===savedMenuOffset,'cart close restores the previous menu scroll position');
   await bar.tap();
   gate(await note.inputValue()==='Counter order note'&&await row.locator('.cart-qty-num').textContent()==='1','X and reopen preserve note and quantity');
   await cartWindow.getByRole('button',{name:/Keep Browsing/}).tap();
   gate(!await cartWindow.isVisible(),'Keep Browsing returns to menu');
   await bar.tap();
   gate(await note.inputValue()==='Counter order note'&&rpcCount('quote')===0&&rpcCount('admit')===0&&rpcCount('submit')===0,
     'reopen preserves draft with zero quote, admission or submission calls');
   await p.evaluate(()=>{
    const entry=cart[0];
    for(let i=0;i<15;i++)cart.push({...entry,key:'extra-line-'+i,name:'Backup brew '+i,qty:1});
    renderCart();
   });
   gate(await cartWindow.locator('#formBody').evaluate(el=>el.scrollHeight>el.clientHeight),'long cart scrolls independently');
   const cartScroll=cartWindow.locator('#formBody');
   await cartScroll.evaluate(el=>{el.scrollTop=0;});
   await wheelInside(cartScroll);
   gate(await menuOffset()===savedMenuOffset,'scrolling a long cart keeps the menu stationary');
   await cartScroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});
   await shot('cart-scrolled');
   await cartWindow.getByRole('button',{name:'Remove',exact:true}).last().tap();
   gate(await cartWindow.locator('.cart-item').count()===15,'Remove deletes only the selected row');
   await p.evaluate(()=>{cart.splice(1);renderCart();});
   await note.focus();
   await p.evaluate(()=>{
    document.body.style.setProperty('--kiosk-order-viewport-height','420px');
    document.body.style.setProperty('--kiosk-order-viewport-top','32px');
    document.getElementById('f-notes').scrollIntoView({block:'nearest',behavior:'instant'});
   });
   gate(await note.evaluate(el=>{
    const area=document.getElementById('formBody').getBoundingClientRect(),r=el.getBoundingClientRect();
    return r.top>=area.top-1&&r.bottom<=area.bottom+1&&r.bottom<=452;
   }),'order note stays clear of the simulated keyboard');
   await shot('cart-keyboard');
   await p.evaluate(()=>window.visualViewport.dispatchEvent(new Event('resize')));
   const confirmation=p.locator('#orderConfirmOverlay');
   await review(f);
   gate(await fillsViewport(confirmation)&&!await cartWindow.isVisible(),'confirmation replaces the editable surface at the same size');
   gate(rpcCount('quote')===1&&rpcCount('admit')===0&&rpcCount('submit')===0,'one explicit review makes exactly one quote');
   const quoted=f.db.calls.find(call=>call.name==='kiosk_quote').args.p_payload;
   gate(quoted.customer_notes==='Counter order note'&&quoted.items[0].item_note==='Less ice, please'
     &&quoted.items[0].option_choice_ids.includes(id(80)),'existing quote receives both notes and selected option');
   gate((await confirmation.textContent()).includes('Pay at counter')&&(await confirmation.textContent()).includes('Total: ₱150.00')
     &&(await confirmation.textContent()).includes('Oat milk'),
     'confirmation displays existing payment reminder and authoritative total');
   await assertForeground(confirmation);
   await assertFrozen(confirmation,savedMenuOffset,'server-priced confirmation');
   await confirmation.locator('.authoritative-review article').evaluate(el=>{
    for(let i=0;i<15;i++)el.parentElement.insertBefore(el.cloneNode(true),el);
   });
   const reviewBody=confirmation.locator('.order-confirm-body');
   await wheelInside(reviewBody);
   gate(await menuOffset()===savedMenuOffset&&await confirmation.getByRole('button',{name:'Continue & Submit'}).evaluate(el=>
    el.getBoundingClientRect().bottom<=innerHeight),'long confirmation scrolls independently and its action stays reachable');
   await shot('confirmation');
   await confirmation.getByRole('button',{name:'Close order confirmation'}).tap();
   gate(await cartWindow.isVisible()&&!await confirmation.isVisible()&&await note.inputValue()==='Counter order note'
     &&rpcCount('admit')===0&&rpcCount('submit')===0,'cancel returns to the draft without admission or submission');
   await review(f);
   await confirmation.getByRole('button',{name:'Edit Order',exact:true}).tap();
   gate(await cartWindow.isVisible()&&await note.inputValue()==='Counter order note','Edit Order returns to the same draft');
   await review(f);await confirm(f);await success(f);
   await assertFrozen(viewport,savedMenuOffset,'Order Received');
   gate(f.db.orders===1&&rpcCount('admit')===1&&rpcCount('submit')===1,'one explicit confirmation follows the protected admission and submission path');
   await p.getByRole('button',{name:'Done · New customer'}).tap();
   await welcomeHeading(p).waitFor();
   gate(!await cartWindow.isVisible()&&await p.evaluate(()=>cart.length===0&&document.getElementById('f-notes').value===''
     &&[...document.querySelectorAll('.panel-note-input')].every(field=>!field.value)),
     'customer reset clears cart, order note and product-note UI');
   await f.context.close();

   f=await open({touch:true,authorized:false});p=f.page;
   await p.setViewportSize({width,height});
   await p.getByRole('heading',{name:'A little help from CURV'}).waitFor();
   const locked=await p.evaluate(()=>getComputedStyle(document.documentElement).overflowY==='hidden'&&document.querySelector('main').inert);
   gate(locked,'staff-help screen locks the menu document and background focus');
   await f.context.close();
  }
  console.log(JSON.stringify({suite:'protected-kiosk-browser',assertions:count,groups,network:'all intercepted'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
