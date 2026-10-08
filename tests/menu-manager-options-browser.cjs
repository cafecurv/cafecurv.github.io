// Offline Menu Manager Option Library interaction tests. No live API calls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});let count=0;const check=(v,m)=>{assert.ok(v,m);count++;};
 try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{
 window.writes=[];window.holdGroup='';window.releases=[];
 window.rows={option_groups:[{id:'sauce',name:'Sauce',group_key:'sauce',selection_type:'single',sort_order:0,is_active:true},{id:'extras',name:'Extras',group_key:'extras',selection_type:'multi',sort_order:1,is_active:false}],option_choices:[{id:'tempura',option_group_id:'sauce',label:'Tempura Sauce',value:'tempura',price_delta:0,sort_order:0,is_active:true},{id:'extra',option_group_id:'extras',label:'Extra <test>',value:'extra',price_delta:25,sort_order:1,is_active:false}]};
 const from=table=>{let op='read',payload,filters=[],one=false;let proxy;const exec=async()=>{
 if(table==='products')return {data:null,error:{message:'Synthetic products/product_sizes read failure'}};
 let selected=(window.rows[table]||[]).filter(r=>filters.every(([k,v])=>r[k]===v));
 if(op!=='read'){window.writes.push({table,op,payload,filters});if(op==='insert'){const r={...payload,id:'new'+window.writes.length};(window.rows[table]??=[]).push(r);selected=[r];}else selected.forEach(r=>Object.assign(r,payload));}
 if(op==='read'&&table==='option_choices'&&filters.some(([k,v])=>k==='option_group_id'&&v===window.holdGroup))await new Promise(resolve=>window.releases.push(resolve));
 return {data:one?selected[0]:structuredClone(selected),error:null,count:selected.length};};
 proxy=new Proxy({}, {get:(_,k)=>k==='then'?(r,j)=>exec().then(r,j):(...a)=>{if(k==='insert'||k==='update'){op=k;payload=a[0];}if(k==='eq')filters.push(a);if(k==='single'||k==='maybeSingle')one=true;return proxy;}});return proxy;};
 const chain=new Proxy({}, {get:(_,k)=>k==='then'?r=>Promise.resolve({data:[],error:null}).then(r):()=>chain});
 window.supabase={createClient:()=>({from,rpc:async()=>({data:[],error:null}),channel:()=>chain,removeChannel:async()=>{},auth:{getSession:async()=>({data:{session:{user:{id:'owner',email:'owner@local.test'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};
 });
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='https://curv.test'&&['/admin/menu-manager.html','/admin/admin.js','/admin/admin.css'].includes(u.pathname))return route.fulfill({path:path.join(root,u.pathname.slice(1))});return route.abort();});
 await page.goto('https://curv.test/admin/menu-manager.html');
 await page.locator('[data-menu-manager-view-tab="option-library"]').first().click({force:true});
 await page.waitForFunction(()=>document.querySelector('#option-library-group').options.length===3);
 check(await page.locator('#option-library-choice').isDisabled(),'no group disables choices');check(await page.locator('[data-new-option-choice]').isDisabled(),'new choice disabled without group');
 check((await page.evaluate(()=>writes.length))===0,'loading does not mutate');
 await page.selectOption('#option-library-group','sauce');await page.waitForFunction(()=>document.querySelector('#option-library-choice').options.length===2);
 check(await page.inputValue('#option-group-name')==='Sauce','group fields');check(await page.inputValue('#option-group-selection-type')==='single','single internal value');
 check(await page.locator('#option-library-choice option').allTextContents().then(x=>x.includes('Tempura Sauce')&&!x.includes('Extra <test>')),'choices scoped');
 await page.selectOption('#option-library-choice','tempura');check(await page.inputValue('#option-choice-label')==='Tempura Sauce','choice loads');
 await page.fill('#option-choice-label','unsaved');await page.click('[data-reset-option-choice]');check(await page.inputValue('#option-choice-label')==='Tempura Sauce','reset restores saved choice');
 await page.selectOption('#option-library-group','extras');await page.waitForFunction(()=>document.querySelector('#option-library-choice option[value="extra"]'));
 check(await page.inputValue('#option-library-choice')==='','stale selection cleared');check(await page.inputValue('#option-choice-label')==='','stale form cleared');check(await page.inputValue('#option-group-selection-type')==='multi','multi preserved');
 await page.click('[data-toggle-option-group]');await page.waitForFunction(()=>document.querySelector("[data-option-manager-status]").textContent==="Option group reactivated.");check(await page.locator('[data-toggle-option-group]').textContent()==='Deactivate','reactivate group');
 await page.click('[data-toggle-option-group]');await page.waitForFunction(()=>document.querySelector("[data-option-manager-status]").textContent==="Option group deactivated.");check(true,'deactivate group');
 await page.fill('#option-group-name','Extras Edited');await page.click('[data-save-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option group updated.');check(await page.inputValue('#option-group-name')==='Extras Edited','group edit remains selected');
 await page.selectOption('#option-library-choice','extra');await page.click('[data-toggle-option-choice]');await page.waitForFunction(()=>document.querySelector("[data-option-manager-status]").textContent==="Option choice reactivated.");check(true,'reactivate choice');
 await page.click('[data-toggle-option-choice]');await page.waitForFunction(()=>document.querySelector("[data-option-manager-status]").textContent==="Option choice deactivated.");check(true,'deactivate choice');
 await page.fill('#option-choice-price-delta','27.5');await page.click('[data-save-option-choice]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option choice updated.');check(await page.evaluate(()=>rows.option_choices[1].price_delta===27.5),'existing price delta contract');
 await page.click('[data-new-option-choice]');await page.fill('#option-choice-label','Synthetic Choice');await page.click('[data-save-option-choice]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option choice created.');check(await page.evaluate(()=>rows.option_choices.at(-1).option_group_id==='extras'),'new choice attached to current group');
 await page.click('[data-new-option-group]');check(await page.inputValue('#option-group-name')==='','new group clears');check(await page.locator('#option-library-choice').isDisabled(),'new group disables choice until saved');
 await page.fill('#option-group-name','Synthetic Group');await page.fill('#option-group-key','synthetic');await page.click('[data-save-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option group created.');check(await page.inputValue('#option-group-name')==='Synthetic Group','created group selected');
 await page.evaluate(()=>holdGroup='sauce');await page.selectOption('#option-library-group','sauce');await page.waitForFunction(()=>releases.length===1);await page.selectOption('#option-library-group','extras');await page.waitForFunction(()=>document.querySelector('#option-library-choice option[value="extra"]'));await page.evaluate(()=>{holdGroup='';releases.shift()();});
 await page.waitForTimeout(50);check(await page.locator('#option-library-choice option[value="tempura"]').count()===0,'late response cannot replace current choices');
 check(await page.evaluate(()=>!writes.some(w=>!['option_groups','option_choices'].includes(w.table))),'only existing library write contracts used');
 check(await page.evaluate(()=>rows.option_choices[0].label==='Tempura Sauce'&&rows.option_choices[0].price_delta===0&&rows.option_groups[0].name==='Sauce'),'Sauce fixture unchanged');
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:1000});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);if(process.env.CURV_OPTION_SCREENSHOTS)await page.locator('[data-option-groups-panel]').screenshot({path:path.join(root,'tests','.option-library-'+width+'.png')});}
 check(await page.locator('[data-option-group-list],[data-option-choice-list],[data-option-group-detail]').count()===0,'old card containers removed');check(errors.length===0,errors.join('\n'));
 check(await page.locator('[data-menu-manager-view-tab="products"]').first().count()===1,'product navigation preserved despite simulated read error');
 console.log('Option Library browser: '+count+' assertions passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
