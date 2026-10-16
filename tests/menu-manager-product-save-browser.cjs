// Offline actual Menu Manager page. Every URL intercepted; no live requests.
const path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let count=0;
const check=(v,m)=>{assert.ok(v,m);count++;};
try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.fixture={calls:[],writes:[],version:'server-version-1',failure:null,loseReply:false,ledger:{},product:{id:'p1',name:'Cafe Cake',category_id:'c1',category_section_id:null,category:{id:'c1',name:'Cakes'},badge_labels:[],variant_group_name:'Each',is_published:true,is_available:true,is_sold_out:false,is_curv_pick:false,is_seasonal:false,archived_at:null,product_sizes:[{id:'s1',label:'Each',price:180,cost:null,sort_order:0}]}};
  const empty=new Proxy({}, {get:(_,k)=>k==='then'?r=>Promise.resolve({data:[],error:null}).then(r):()=>empty});
  window.supabase={createClient:()=>({channel:()=>empty,removeChannel:async()=>{},auth:{getSession:async()=>({data:{session:{user:{id:'owner',email:'owner@local.test'}}}}),onAuthStateChange:()=>({})},
   from:table=>{const q=new Proxy({}, {get:(_,k)=>k==='then'?r=>Promise.resolve({data:table==='categories'?[{id:'c1',name:'Cakes',is_active:true}]:table==='products'?[fixture.product]:[],error:null}).then(r):(...a)=>{if(['update','insert','delete','upsert'].includes(k))fixture.writes.push({table,k,a});return q;}});return q;},
   rpc:async(name,args)=>{
    if(name==='is_admin')return {data:true,error:null};fixture.calls.push({name,args:structuredClone(args)});
    if(name==='menu_manager_get_product_editor')return {data:{product:structuredClone(fixture.product),version:fixture.version},error:null};
    if(name==='menu_manager_save_product'){
     if(fixture.failure)return {data:null,error:{code:'P0001',details:fixture.failure,message:'raw internal certification error'}};
     const r=args.p_request;
     if(!fixture.ledger[r.request_id]){Object.assign(fixture.product,r.product,{is_published:r.action==='publish'?true:r.action==='unpublish'||!r.product_id?false:fixture.product.is_published,product_sizes:r.sizes});fixture.version+='x';fixture.ledger[r.request_id]={ok:true,product_id:'p1',is_published:fixture.product.is_published,orderable:fixture.product.is_published};}
     if(fixture.loseReply){fixture.loseReply=false;throw Error('lost response');}
     return {data:fixture.ledger[r.request_id],error:null};
    }
    return {data:[],error:null};
   }})};
 });
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='https://curv.test'&&['/admin/menu-manager.html','/admin/admin.js','/admin/admin.css'].includes(u.pathname))return route.fulfill({path:path.join(root,u.pathname.slice(1))});return route.abort();});
 await page.goto('https://curv.test/admin/menu-manager.html');
 await page.locator('[data-product-list]').getByRole('button',{name:'Edit',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#draft-product-name').value==='Cafe Cake');
 check(await page.evaluate(()=>fixture.calls.some(c=>c.name==='menu_manager_get_product_editor')),'authoritative editor read');
 await page.locator('[data-variant-price]').fill('190');await page.click('[data-create-draft]');
 await page.waitForFunction(()=>document.body.textContent.includes('Changes saved.'));
 let calls=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product'));
 check(calls.length===1,'one save RPC');check(calls[0].args.p_request.expected_version==='server-version-1','opaque token sent');
 check(calls[0].args.p_request.sizes[0].id==='s1','existing size ID sent');
 check(await page.evaluate(()=>fixture.writes.length===0&&!fixture.calls.some(c=>c.name==='menu_manager_reconcile_product_sizes')),'no separate product,size,publish write');
 await page.evaluate(()=>fixture.failure='MM_SAVE_STALE');await page.locator('[data-variant-price]').fill('200');await page.click('[data-create-draft]');
 await page.waitForFunction(()=>document.body.textContent.includes('changed in another session'));
 check(await page.locator('[data-variant-price]').inputValue()==='200','failed edit retained');
 check(!(await page.locator('[data-create-draft]').isDisabled()),'failure releases busy state');
 check(!(await page.locator('body').textContent()).includes('raw internal'),'friendly message only');
 await page.evaluate(()=>fixture.failure=null);await page.click('[data-create-draft]');await page.waitForFunction(()=>document.body.textContent.includes('Changes saved.'));
 await page.locator('[name=menu_visible]').uncheck();await page.click('[data-create-draft]');await page.waitForFunction(()=>document.body.textContent.includes('Changes saved.'));
 check(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request.action==='unpublish'),'unpublish same atomic boundary');
 await page.locator('[name=menu_visible]').check();await page.click('[data-create-draft]');await page.waitForFunction(()=>document.body.textContent.includes('Changes saved.'));
 check(await page.evaluate(()=>fixture.product.is_published),'republish');
 await page.evaluate(()=>fixture.loseReply=true);await page.locator('[data-variant-price]').fill('220');await page.click('[data-create-draft]');
 await page.waitForFunction(()=>document.body.textContent.includes('Unable to confirm the save'));
 const previous=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request);
 await page.click('[data-create-draft]');await page.waitForFunction(()=>document.body.textContent.includes('Changes saved.'));
 check(JSON.stringify(previous)===JSON.stringify(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='menu_manager_save_product').at(-1).args.p_request)),'uncertain retry frozen payload and key');
 check(await page.evaluate(()=>fixture.writes.length===0),'all actions no direct writes');
 check(errors.length===0,errors.join('\n'));console.log('Menu Manager product save browser: '+count+' assertions passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
