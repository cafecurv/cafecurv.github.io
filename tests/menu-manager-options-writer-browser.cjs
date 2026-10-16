// Offline actual Menu Manager page. Every URL intercepted; no live requests.
const path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let count=0;
const check=(v,m)=>{assert.ok(v,m);count++;};
try{const page=await browser.newPage();const errors=[];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript((recipes)=>{
  window.fixture={calls:[],writes:[],version:'server-version-1',failure:null,loseReply:false,ledger:{},product:{id:'p1',name:'Cafe Cake',category_id:'c1',category_section_id:null,category:{id:'c1',name:'Cakes'},badge_labels:[],variant_group_name:'Each',is_published:true,is_available:true,is_sold_out:false,is_curv_pick:false,is_seasonal:false,archived_at:null,product_sizes:[{id:'s1',label:'Each',price:180,cost:null,sort_order:0}]}};
  fixture.recipes=recipes;
  fixture.library=[{id:'g1',name:'Milk',group_key:'milk',selection_type:'single',used_by:5,choices:[{id:'o1',label:'Oat',price_delta:30},{id:'o2',label:'Soy',price_delta:20}]}];
  fixture.optionDraft=[{option_group_id:'g1',is_required:false,min_selections:0,max_selections:1,choices:[{option_choice_id:'o1',enabled:true,default:false,product_price_delta:null,price_by_size:{}},{option_choice_id:'o2',enabled:true,default:false,product_price_delta:null,price_by_size:{}}],compatibility:{}}];
  const empty=new Proxy({}, {get:(_,k)=>k==='then'?r=>Promise.resolve({data:[],error:null}).then(r):()=>empty});
  window.supabase={createClient:()=>({channel:()=>empty,removeChannel:async()=>{},auth:{getSession:async()=>({data:{session:{user:{id:'owner',email:'owner@local.test'}}}}),onAuthStateChange:()=>({})},
   from:table=>{const q=new Proxy({}, {get:(_,k)=>k==='then'?r=>Promise.resolve({data:table==='categories'?[{id:'c1',name:'Cakes',is_active:true}]:table==='products'?[fixture.product]:fixture.options&&table==='product_option_groups'?[{product_id:'p1',option_group_id:'g1',is_active:true,is_required:false,min_selections:0,max_selections:1,sort_order:0}]:fixture.options&&table==='option_groups'?[{id:'g1',name:'Milk',group_key:'milk',selection_type:'single',is_active:true}]:[],error:null}).then(r):(...a)=>{if(['update','insert','delete','upsert'].includes(k))fixture.writes.push({table,k,a});return q;}});return q;},
   rpc:async(name,args)=>{
    if(name==='is_admin')return {data:true,error:null};fixture.calls.push({name,args:structuredClone(args)});
    if(name==='menu_manager_get_product_editor')return {data:{product:args.p_product_id===null?null:structuredClone(fixture.product),version:fixture.version,options_version:1,option_recipes:fixture.recipes||[],options:args.p_product_id===null?[]:fixture.optionDraft,options_library:fixture.library},error:null};
    if(name==='menu_manager_save_product'){
     if(fixture.failure)return {data:null,error:{code:'P0001',details:fixture.failure,message:'raw internal certification error'}};
     const r=args.p_request;if(r.options)fixture.optionDraft=structuredClone(r.options);
     if(!fixture.ledger[r.request_id]){Object.assign(fixture.product,r.product,{is_published:r.action==='publish'?true:r.action==='unpublish'||!r.product_id?false:fixture.product.is_published,product_sizes:r.sizes.map((s,i)=>({...s,id:s.id||'new-size-'+i}))});fixture.version+='x';fixture.ledger[r.request_id]={ok:true,product_id:'p1',is_published:fixture.product.is_published,orderable:fixture.product.is_published};}
     if(fixture.loseReply){fixture.loseReply=false;throw Error('lost response');}
     return {data:fixture.ledger[r.request_id],error:null};
    }
    return {data:[],error:null};
   }})};
 },JSON.parse(fs.readFileSync(path.join(root,'admin/MENU_MANAGER_CUSTOMER_OPTIONS_PHASE3B.sql'),'utf8').split('$recipes$')[1]));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='https://curv.test'&&['/admin/menu-manager.html','/admin/admin.js','/admin/admin.css','/admin/product-options-editor.js'].includes(u.pathname))return route.fulfill({path:path.join(root,u.pathname.slice(1))});return route.abort();});
 await page.goto('https://curv.test/admin/menu-manager.html');

 const host=page.locator('[data-customer-options-editor]');
 await page.locator('[data-product-list]').getByRole('button',{name:'Edit',exact:true}).click();
 await host.waitFor({state:'visible'});
 check(await host.getByRole('heading',{name:'Milk',exact:true}).count()===1,'option-bearing product loaded');
 check(!(await page.locator('[data-customer-options-summary]').isVisible()),'read-only summary replaced');
 await host.getByRole('button',{name:'Edit',exact:true}).click();
 const oat=host.locator('fieldset.customer-choice-edit').filter({has:page.locator('legend',{hasText:'Oat'})});
 await oat.getByLabel('Additional charge (shared: +₱30)',{exact:true}).fill('35');
 await host.getByLabel('Default choice',{exact:true}).selectOption('o1');
 check(await page.evaluate(()=>fixture.writes.length===0&&!fixture.calls.some(c=>c.name==='menu_manager_save_product')),'edits are local until Save');
 await page.click('[data-create-draft]');
 await page.waitForFunction(()=>document.querySelector('[data-product-editor-status]').textContent==='Changes saved.');
 let request=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request);
 check(request.options[0].choices[0].product_price_delta==='35'&&request.options[0].choices[0].default,'one save includes option charge/default');
 check(request.expected_version==='server-version-1'&&request.sizes[0].id==='s1','existing version and size retained');
 check(!('certification' in request),'no browser certification');
 await host.getByRole('button',{name:'Edit',exact:true}).click();
 await oat.getByLabel('Available',{exact:true}).uncheck();
 await page.click('[data-create-draft]');await page.waitForFunction(()=>document.querySelector('[data-product-editor-status]').textContent==='Changes saved.');
 request=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request);
 check(!request.options[0].choices[0].enabled&&!request.options[0].choices[0].default&&request.options[0].choices[0].product_price_delta===null,'disable clears dependent draft fields');
 await host.getByRole('button',{name:'Edit',exact:true}).click();
 for(const theme of ['light','dark'])for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.dataset.adminTheme=t,theme);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),theme+' '+width+' no page overflow');
  check(await host.evaluate(el=>el.scrollWidth<=el.clientWidth+1),theme+' '+width+' no editor overflow');
  if(process.env.CURV_TEST_SCREENSHOTS){fs.mkdirSync(process.env.CURV_TEST_SCREENSHOTS,{recursive:true});await host.screenshot({style:'.topbar, .mobile-bottom-nav, .skip-link { visibility:hidden; }',path:path.join(process.env.CURV_TEST_SCREENSHOTS,`customer-options-${theme}-${width}.png`)});}
 }
 await host.getByRole('button',{name:'Remove',exact:true}).click();
 await page.click('[data-create-draft]');await page.waitForFunction(()=>document.querySelector('[data-product-editor-status]').textContent==='Changes saved.');
 check(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request.options.length===0),'remove uses explicit empty array');
 await host.getByLabel('Existing option set').selectOption('g1');await host.getByRole('button',{name:'+ Add option set',exact:true}).click();
 check(await host.getByRole('heading',{name:'Milk',exact:true}).count()===1,'existing set attached in draft');
 await page.evaluate(()=>fixture.failure='MM_OPTIONS_RECIPE');await page.click('[data-create-draft]');
 await page.waitForFunction(()=>document.querySelector('[data-product-editor-status]').textContent.includes('option'));
 check(!(await page.locator('[data-product-editor-status]').textContent()).includes('certification'),'friendly server rejection');
 check(await host.getByRole('heading',{name:'Milk',exact:true}).count()===1,'failed save preserves draft');
 await page.evaluate(()=>fixture.failure=null);
 await oat.getByLabel('Additional charge by size',{exact:true}).check();
 await oat.getByLabel('Each',{exact:true}).fill('42');
 await page.click('[data-create-draft]');await page.waitForFunction(()=>document.querySelector('[data-product-editor-status]').textContent==='Changes saved.');
 request=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request);
 check(request.options[0].choices[0].price_by_size.s1==='42','per-size editor charge included in main Save');
 await page.click('[data-back-to-products]');
 await page.evaluate(()=>{fixture.library.push({id:'t1',name:'Temperature',group_key:'temperature',selection_type:'single',choices:[{id:'hot',label:'Hot',price_delta:0},{id:'iced',label:'Iced',price_delta:0}]});fixture.optionDraft.push({option_group_id:'t1',is_required:true,min_selections:1,max_selections:1,choices:[{option_choice_id:'hot',enabled:true,default:false,product_price_delta:null,price_by_size:{}},{option_choice_id:'iced',enabled:true,default:true,product_price_delta:null,price_by_size:{}}],compatibility:{s1:['iced']}});});
 await page.locator('[data-product-list]').getByRole('button',{name:'Edit',exact:true}).click();
 const temperature=host.locator('article').filter({has:page.getByRole('heading',{name:'Temperature',exact:true})});
 await temperature.getByRole('button',{name:'Edit',exact:true}).click();
 await temperature.locator('fieldset.customer-choice-edit').filter({has:page.locator('legend',{hasText:'Hot'})}).getByLabel('Each',{exact:true}).check();
 await page.click('[data-create-draft]');await page.waitForFunction(()=>document.querySelector('[data-product-editor-status]').textContent==='Changes saved.');
 request=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request);
 check(request.options.find(g=>g.option_group_id==='t1').compatibility.s1.includes('hot'),'temperature compatibility included in main Save');

 await temperature.getByRole('button',{name:'Edit',exact:true}).click();
 const callsBefore=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').length);
 await temperature.getByLabel('Default choice',{exact:true}).selectOption('');await page.click('[data-create-draft]');
 check((await page.locator('[data-product-editor-status]').textContent())==='Choose a default temperature.','friendly missing default validation');
 check(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').length)===callsBefore,'invalid default no RPC');
 await temperature.getByLabel('Default choice',{exact:true}).selectOption('iced');
 const hot=temperature.locator('fieldset.customer-choice-edit').filter({has:page.locator('legend',{hasText:'Hot'})});
 await hot.getByLabel('Each',{exact:true}).uncheck();await page.click('[data-create-draft]');
 check((await page.locator('[data-product-editor-status]').textContent())==='Hot needs an available serving size.','friendly serving size error');
 await hot.getByLabel('Each',{exact:true}).check();
 await host.locator('article').filter({has:page.getByRole('heading',{name:'Milk',exact:true})}).getByRole('button',{name:'Edit',exact:true}).click();
 await oat.getByLabel('Each',{exact:true}).fill('');await page.click('[data-create-draft]');
 check((await page.locator('[data-product-editor-status]').textContent())==='Add a price for Each.','missing contextual price blocked');
 await oat.getByLabel('Each',{exact:true}).fill('42');
 check(!/min_selections|max_selections|group_key|price_delta|UUID|certification|compatibility tuple|override requirement/.test(await host.innerText()),'plain visible terminology');
 await page.click('[data-back-to-products]');
 await page.evaluate(()=>{fixture.product.name='Curv Chocolate';fixture.optionDraft=[];fixture.library.push({id:'sauce',name:'Sauce',group_key:'sauce',selection_type:'multi',choices:[{id:'choc',label:'Chocolate',price_delta:45}]});});
 await page.locator('[data-product-list]').getByRole('button',{name:'Edit',exact:true}).click();
 check(await host.getByLabel('Existing option set').locator('option').count()===1,'zero-option recipe has no addable sets');
 await page.locator('#draft-product-name').fill('Americano');await page.locator('#draft-product-name').blur();
 check((await host.getByLabel('Existing option set').locator('option').allTextContents()).join('|')==='Choose an option set|Temperature','name change filters authoritative recipe');
 await host.getByLabel('Existing option set').selectOption('t1');await host.getByRole('button',{name:'+ Add option set',exact:true}).click();
 check(await host.getByLabel('Existing option set').locator('option').count()===1,'attached set excluded');
 await page.locator('#draft-product-name').fill('Curv Chocolate');await page.locator('#draft-product-name').blur();await page.click('[data-create-draft]');
 check((await page.locator('[data-product-editor-status]').textContent())==='This item cannot use Temperature.','prohibited set blocked before save');
 await page.click('[data-back-to-products]');
 await page.evaluate(()=>{fixture.product.id='8e1b82c6-8aea-4eb9-b591-184072c4f49e';fixture.product.name='Renamed Chocolate';fixture.optionDraft=[];});
 await page.locator('[data-product-list]').getByRole('button',{name:'Edit',exact:true}).click();
 check(await host.getByLabel('Existing option set').locator('option').count()===1,'known product UUID governs recipe on initial load even after rename');
 await page.click('[data-back-to-products]');await page.evaluate(()=>{fixture.product.id='p1';fixture.optionDraft=[];});await page.click('[data-open-product-editor]');
 await page.fill('#draft-product-name','Americano');await page.selectOption('#draft-product-category','c1');await page.locator('[data-variant-price]').fill('150');
 await page.click('[data-create-draft]');await page.waitForFunction(()=>document.querySelector('[data-product-editor-status]').textContent==='Product saved.');
 request=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request);
 check(request.product_id===null&&!('options' in request)&&request.action==='save','initial hidden recipe draft preserves omitted options workflow');
 const beforePublish=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').length);
 await page.locator('[name=menu_visible]').check();await page.click('[data-create-draft]');
 check((await page.locator('[data-product-editor-status]').textContent()).includes('before it can be saved'),'incomplete recipe cannot publish');
 check(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').length)===beforePublish,'incomplete publication no RPC');
 check(await page.evaluate(()=>fixture.writes.length===0),'no direct table writes');
 check(errors.length===0,errors.join('\n'));
 console.log('Phase 3B customer options browser: '+count+' assertions passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
