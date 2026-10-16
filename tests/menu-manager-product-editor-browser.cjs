// Offline actual Menu Manager page. Every URL intercepted; no live requests.
const path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let count=0;
const check=(v,m)=>{assert.ok(v,m);count++;};
try{const page=await browser.newPage();const errors=[];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.fixture={calls:[],writes:[],version:'server-version-1',failure:null,loseReply:false,ledger:{},product:{id:'p1',name:'Cafe Cake',category_id:'c1',category_section_id:null,category:{id:'c1',name:'Cakes'},badge_labels:[],variant_group_name:'Each',is_published:true,is_available:true,is_sold_out:false,is_curv_pick:false,is_seasonal:false,archived_at:null,product_sizes:[{id:'s1',label:'Each',price:180,cost:null,sort_order:0}]}};
  const empty=new Proxy({}, {get:(_,k)=>k==='then'?r=>Promise.resolve({data:[],error:null}).then(r):()=>empty});
  window.supabase={createClient:()=>({channel:()=>empty,removeChannel:async()=>{},auth:{getSession:async()=>({data:{session:{user:{id:'owner',email:'owner@local.test'}}}}),onAuthStateChange:()=>({})},
   from:table=>{const q=new Proxy({}, {get:(_,k)=>k==='then'?r=>Promise.resolve({data:table==='categories'?[{id:'c1',name:'Cakes',is_active:true}]:table==='products'?[fixture.product]:fixture.options&&table==='product_option_groups'?[{product_id:'p1',option_group_id:'g1',is_active:true,is_required:false,min_selections:0,max_selections:1,sort_order:0}]:fixture.options&&table==='option_groups'?[{id:'g1',name:'Milk',group_key:'milk',selection_type:'single',is_active:true}]:[],error:null}).then(r):(...a)=>{if(['update','insert','delete','upsert'].includes(k))fixture.writes.push({table,k,a});return q;}});return q;},
   rpc:async(name,args)=>{
    if(name==='is_admin')return {data:true,error:null};fixture.calls.push({name,args:structuredClone(args)});
    if(name==='menu_manager_get_product_editor')return {data:{product:structuredClone(fixture.product),version:fixture.version},error:null};
    if(name==='menu_manager_save_product'){
     if(fixture.failure)return {data:null,error:{code:'P0001',details:fixture.failure,message:'raw internal certification error'}};
     const r=args.p_request;
     if(!fixture.ledger[r.request_id]){Object.assign(fixture.product,r.product,{is_published:r.action==='publish'?true:r.action==='unpublish'||!r.product_id?false:fixture.product.is_published,product_sizes:r.sizes.map((s,i)=>({...s,id:s.id||'new-size-'+i}))});fixture.version+='x';fixture.ledger[r.request_id]={ok:true,product_id:'p1',is_published:fixture.product.is_published,orderable:fixture.product.is_published};}
     if(fixture.loseReply){fixture.loseReply=false;throw Error('lost response');}
     return {data:fixture.ledger[r.request_id],error:null};
    }
    return {data:[],error:null};
   }})};
 });
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='https://curv.test'&&['/admin/menu-manager.html','/admin/admin.js','/admin/admin.css'].includes(u.pathname))return route.fulfill({path:path.join(root,u.pathname.slice(1))});return route.abort();});
 await page.goto('https://curv.test/admin/menu-manager.html');

 const open = async () => {
   await page.locator('[data-product-list]').getByRole('button',{name:'Edit',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#draft-product-name').value===fixture.product.name);
 };
 const back = async () => { await page.click('[data-back-to-products]'); };
 const prices = () => page.locator('[data-variant-price]');
 const sizesToggle = () => page.locator('[data-multiple-sizes]');
 const save = async () => {await page.click('[data-create-draft]');await page.waitForFunction(()=>document.querySelector('[data-product-editor-status]').textContent==='Changes saved.');};
 const lastSave = () => page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request);
 await open();
 check(await prices().count()===1&&await prices().inputValue()==='180','existing one-price loads exact price');
 check(!(await sizesToggle().isChecked()),'one-price mode initially off');
 check(!(await page.locator('[data-variant-label]').isVisible()),'selling label tucked away');
 check(!(await page.locator('[data-variant-cost]').isVisible()),'cost tucked away');
 check(await page.locator('[data-editor-more-details]').getAttribute('open')===null,'More details collapsed');
 check(await page.locator('[data-description-photo]').getAttribute('open')===null,'description/photo optional');
 check(await page.locator('[data-editor-publish-note]').isVisible(),'live note');
 check(await page.locator('[data-create-draft]').textContent()==='Save Changes','existing action label');
 check(await page.locator('[data-editor-publish-action]').count()===0,'one primary save action');
 check(await page.evaluate(()=>fixture.calls.every(c=>c.name==='menu_manager_get_product_editor')),'loading has no writes');
 await sizesToggle().check();
 check(await page.locator('[data-variant-label]').inputValue()==='Each','toggle preserves existing label');
 check(await page.locator('[data-pricing-title]').textContent()==='Sizes','multiple-size heading');
 await page.click('[data-add-variant]');await page.locator('[data-variant-label]').last().pressSequentially('Large');check(await page.locator('[data-variant-label]').last().inputValue()==='Large','typing keeps focus through size name');await prices().last().fill('220');
 await sizesToggle().click();
 check(await sizesToggle().isChecked()&&await prices().count()===2,'cannot silently discard extra sizes');
 check((await page.locator('[data-size-mode-status]').textContent()).includes('kept'),'safe toggle explanation');
 check(await prices().last().inputValue()==='220','extra size price preserved');
 await page.locator('[data-remove-variant]').last().click();await sizesToggle().uncheck();
 check(await prices().count()===1&&await prices().inputValue()==='180','return to simple after explicit removal');
 check(await page.locator('[data-variant-cost]').count()===1,'removed size cost cleaned up');
 await page.locator('[name=is_sold_out]').check();await save();let sent=await lastSave();
 check(sent.product.is_sold_out&&sent.product.is_available&&sent.action==='save','sold out preserves visible publication');
 check(sent.sizes[0].id==='s1'&&sent.sizes[0].label==='Each'&&sent.sizes[0].price===180,'single size ID/label/price preserved');
 await page.locator('[name=menu_visible]').uncheck();await save();sent=await lastSave();
 check(sent.action==='unpublish'&&sent.product.is_available,'Visible off hides through existing boundary');
 check(!(await page.locator('[data-editor-publish-note]').isVisible()),'hidden product no live note');
 await page.locator('[name=menu_visible]').check();await save();sent=await lastSave();
 check(sent.action==='publish'&&sent.product.is_available&&sent.product.is_sold_out,'visible sold-out supported');
 await back();
 await page.evaluate(()=>{fixture.product={...fixture.product,name:'Pieces Product',variant_group_name:'Pieces',is_published:true,is_available:true,is_sold_out:false,product_sizes:[{id:'four',label:'4 pcs',price:160,cost:50,sort_order:0},{id:'eight',label:'8',price:320,cost:100,sort_order:1},{id:'platter',label:'PLATTER 16PCS',price:630,cost:200,sort_order:2}]};fixture.options=true;fixture.version+='m';});
 const original=await page.evaluate(()=>structuredClone(fixture.product.product_sizes));await open();
 check(await sizesToggle().isChecked()&&await prices().count()===3,'existing multiple sizes');
 check(JSON.stringify(await page.locator('[data-variant-label]').evaluateAll(es=>es.map(e=>e.value)))===JSON.stringify(original.map(s=>s.label)),'unusual labels unchanged');
 check(JSON.stringify(await prices().evaluateAll(es=>es.map(e=>Number(e.value))))===JSON.stringify(original.map(s=>s.price)),'no prices changed on load');
 await page.locator('[data-editor-more-details] > summary').click();
 check(await page.locator('#draft-variant-group').inputValue()==='Pieces','selling unit preserved');
 check(await page.locator('[data-variant-cost]').first().inputValue()==='50','existing costs accessible');
 await page.locator('[data-variant-cost]').first().fill('55');await save();sent=await lastSave();
 check(JSON.stringify(sent.sizes.map(s=>s.id))===JSON.stringify(original.map(s=>s.id)),'all size IDs stable');
 check(sent.sizes[0].cost===55&&sent.product.variant_group_name==='Pieces','cost and unit retained by save');
 // A legacy published-but-unavailable product must not be silently republished.
 await back();await page.evaluate(()=>{fixture.product.is_available=false;fixture.product.is_published=true;fixture.version+='h';});await open();
 check(!(await page.locator('[name=menu_visible]').isChecked()),'legacy hidden product loads hidden');
 await prices().first().fill('161');await save();sent=await lastSave();
 check(sent.action==='save'&&!sent.product.is_available,'unchanged hidden flags remain exact');
 await page.locator('[name=menu_visible]').check();await save();sent=await lastSave();
 check(sent.action==='save'&&sent.product.is_available,'intentional visibility enables existing published product');
 check((await page.locator('[data-customer-options-summary]').textContent()).includes('already has customer options'),'option-bearing product calmly identified');
 check(!(await page.locator('[data-show-attach-option-group]').isVisible()),'gated option controls not exposed');
 check((await page.locator('#editor-customer-options-title').textContent())==='Customer options','plain customer options heading');
 for(const theme of ['light','dark'])for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.adminTheme=theme,theme);
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${theme} ${width} no horizontal overflow`);
   check(await prices().first().isVisible(),`${theme} ${width} price visible`);
   await page.locator('[data-editor-more-details]').evaluate(el=>{el.open=true;});
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${theme} ${width} expanded details no overflow`);
   await page.locator('[data-editor-more-details]').evaluate(el=>{el.open=false;});
   if(process.env.CURV_TEST_SCREENSHOTS){fs.mkdirSync(process.env.CURV_TEST_SCREENSHOTS,{recursive:true});await page.locator('[data-draft-product-panel]').screenshot({style:'.topbar, .mobile-bottom-nav, .skip-link { visibility:hidden; }',path:path.join(process.env.CURV_TEST_SCREENSHOTS,`menu-editor-${theme}-${width}.png`)});}
 }
 await back();await page.click('[data-open-product-editor]');
 check(!(await sizesToggle().isChecked())&&await prices().count()===1,'new product simple default');
 check(await page.locator('[data-create-draft]').textContent()==='Save Product','new action label');
 check(!(await page.locator('[name=menu_visible]').isChecked()),'new product retains safe draft default');
 await page.fill('#draft-product-name','New simple cake');await page.selectOption('#draft-product-category','c1');await prices().fill('250');
 await page.click('[data-create-draft]');await page.waitForFunction(()=>document.querySelector('[data-product-editor-status]').textContent==='Product saved.');sent=await lastSave();
 check(sent.product_id===null&&sent.sizes.length===1&&sent.sizes[0].price===250,'new simple product one size behind scenes');
 check(await page.evaluate(()=>fixture.writes.length===0&&!fixture.calls.some(c=>c.name==='menu_manager_reconcile_product_sizes')),'all saves use Phase 1 only');
 check(errors.length===0,errors.join('\n'));
 console.log('Menu Manager Phase 2 UX: '+count+' assertions passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
