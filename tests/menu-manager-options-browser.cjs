// Offline Menu Manager Option Library interaction tests. No live API calls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});let count=0;const check=(v,m)=>{assert.ok(v,m);count++;};
 try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let confirmDelete=true;page.on('dialog',d=>!confirmDelete&&d.message().startsWith('Permanently delete')?d.dismiss():d.accept());
 await page.addInitScript(()=>{
 window.deleteCalls=[];window.deleteReasons={};window.deleteFailure=false;window.writes=[];window.holdGroup='';window.releases=[];window.authListeners=[];window.rejectNext='';
 window.rows={option_groups:[{id:'sauce',name:'Sauce',group_key:'sauce',selection_type:'single',sort_order:0,is_active:true},{id:'extras',name:'Extras',group_key:'extras',selection_type:'multi',sort_order:1,is_active:false}],option_choices:[{id:'tempura',option_group_id:'sauce',label:'Tempura Sauce',value:'tempura',price_delta:0,sort_order:0,is_active:true},{id:'extra',option_group_id:'extras',label:'Extra <test>',value:'extra',price_delta:25,sort_order:1,is_active:false}]};
 const from=table=>{let op='read',payload,filters=[],one=false;let proxy;const exec=async()=>{
 if(window.rejectNext===table+':'+op){window.rejectNext='';throw Error('Synthetic transport failure');}
 if(table==='products')return {data:null,error:{message:'Synthetic products/product_sizes read failure'}};
 let selected=(window.rows[table]||[]).filter(r=>filters.every(([k,v])=>r[k]===v));
 if(op!=='read'){window.writes.push({table,op,payload,filters});if(op==='insert'){const r={...payload,id:'new'+window.writes.length};(window.rows[table]??=[]).push(r);selected=[r];}else selected.forEach(r=>Object.assign(r,payload));}
 if(op==='read'&&table==='option_choices'&&filters.some(([k,v])=>k==='option_group_id'&&v===window.holdGroup))await new Promise(resolve=>window.releases.push(resolve));
 return {data:one?selected[0]:structuredClone(selected),error:null,count:selected.length};};
 proxy=new Proxy({}, {get:(_,k)=>k==='then'?(r,j)=>exec().then(r,j):(...a)=>{if(k==='insert'||k==='update'){op=k;payload=a[0];}if(k==='eq')filters.push(a);if(k==='single'||k==='maybeSingle')one=true;return proxy;}});return proxy;};
 const chain=new Proxy({}, {get:(_,k)=>k==='then'?r=>Promise.resolve({data:[],error:null}).then(r):()=>chain});
 window.supabase={createClient:()=>({from,rpc:async(name,args)=>{
 if(name==='is_admin')return {data:true,error:null};
 if(!name.startsWith('menu_manager_delete_option_'))return {data:[],error:null};
 window.deleteCalls.push({name,args});
 if(window.deleteFailure){window.deleteFailure=false;throw Error('Synthetic delete transport failure');}
 const group=name.endsWith('_group'),id=group?args.p_group_id:args.p_choice_id;
 const reasons=window.deleteReasons[id]||(group&&rows.option_choices.some(c=>c.option_group_id===id)?['GROUP_HAS_CHOICES']:[]);
 if(reasons.length)return {data:{ok:false,code:'IN_USE',reasons},error:null};
 const table=group?'option_groups':'option_choices';rows[table]=rows[table].filter(r=>r.id!==id);
 return {data:{ok:true,deleted_id:id},error:null};
 },channel:()=>chain,removeChannel:async()=>{},auth:{getSession:async()=>({data:{session:{user:{id:'owner',email:'owner@local.test'}}}}),onAuthStateChange:fn=>{window.authListeners.push(fn);return {data:{subscription:{unsubscribe(){}}}};}}})};
 });
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='https://curv.test'&&['/admin/menu-manager.html','/admin/admin.js','/admin/admin.css'].includes(u.pathname))return route.fulfill({path:path.join(root,u.pathname.slice(1))});return route.abort();});
 await page.goto('https://curv.test/admin/menu-manager.html');
 await page.locator('[data-menu-manager-view-tab="option-library"]').first().click({force:true});
 await page.waitForFunction(()=>document.querySelector('#option-library-group').options.length===3);
 await page.waitForFunction(()=>document.querySelector('#option-library-choice option[value="tempura"]'));
 check(await page.locator('[data-option-group-form]').isHidden(),'group initially viewing');
 check(await page.locator('[data-option-choice-form]').isHidden(),'choice initially viewing');
 check((await page.locator('[data-option-group-summary]').textContent()).includes('Sauce'),'saved group summary');
 check((await page.evaluate(()=>writes.length))===0,'viewing does not mutate');
 check(!(await page.locator('[data-delete-option-group]').isDisabled()),'group safe delete action available');
 check(!(await page.locator('[data-delete-option-choice]').isDisabled()),'choice safe delete action available');
 check(await page.locator('#option-group-delete-help,#option-choice-delete-help').count()===0,'no persistent implementation explanation');
 check(await page.locator('[data-option-group-view-actions] [data-new-option-group]').count()===0,'New Group outside selected actions');
 check(await page.locator('.option-library-picker [data-new-option-group]').count()===1,'New Group beside selector');
 check(await page.locator('.option-library-status-action [data-toggle-option-group]').count()===1,'status separated');
 check(await page.locator('.option-library-danger-action [data-delete-option-group]').count()===1,'delete separated');
 // Phase 1 deliberately gates option writes; selectors/summaries remain usable.
 await page.click('[data-edit-option-group]');
 check(await page.inputValue('#option-group-name')==='Sauce','edit still displays current values');
 await page.fill('#option-group-name','Changed');await page.click('[data-save-option-group]');
 await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent.includes('read-only'));
 check(await page.evaluate(()=>writes.length===0),'group save gated');
 await page.click('[data-reset-option-group]');
 await page.click('[data-edit-option-choice]');await page.fill('#option-choice-label','Changed');await page.click('[data-save-option-choice]');
 check(await page.evaluate(()=>writes.length===0),'choice save gated');
 await page.click('[data-reset-option-choice]');
 await page.click('[data-toggle-option-group]');await page.click('[data-toggle-option-choice]');
 await page.click('[data-delete-option-group]');await page.click('[data-delete-option-choice]');
 check(await page.evaluate(()=>writes.length===0&&deleteCalls.length===0),'toggles/deletes gated');
 check(await page.evaluate(()=>rows.option_groups[0].name==='Sauce'&&rows.option_choices[0].label==='Tempura Sauce'),'saved config unchanged');
 await page.selectOption('#option-library-group','extras');await page.waitForFunction(()=>document.querySelector('#option-library-choice option[value="extra"]'));
 check((await page.locator('[data-option-group-summary]').textContent()).includes('Extras'),'read navigation works');
 check(errors.length===0,errors.join('\n'));console.log('Menu Manager option library: '+count+' assertions passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
