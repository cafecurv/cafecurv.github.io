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
 await page.click('[data-edit-option-group]');
 check(await page.inputValue('#option-group-name')==='Sauce','edit populated');
 check(!(await page.locator('[data-save-option-group]').isDisabled()),'save clickable in edit');
 await page.fill('#option-group-name','Uncommitted');
 await page.evaluate(()=>authListeners.forEach(fn=>fn('SIGNED_IN',{user:{id:'owner',email:'owner@local.test'}})));
 check(await page.inputValue('#option-group-name')==='Uncommitted','same-user event preserves edit');
 check(!(await page.locator('[data-save-option-group]').isDisabled()),'same-user event does not lock save');
 await page.click('[data-reset-option-group]');
 check(await page.locator('[data-option-group-form]').isHidden(),'cancel hides group form');
 check((await page.locator('[data-option-group-summary]').textContent()).startsWith('Sauce'),'cancel restores summary');
 await page.selectOption('#option-library-group','extras');await page.waitForFunction(()=>document.querySelector('#option-library-choice option[value="extra"]'));
 check(await page.locator('#option-library-choice option[value="tempura"]').count()===0,'choices scoped');
 check(await page.locator('[data-option-choice-form]').isHidden(),'group switch clears choice edit');
 await page.click('[data-edit-option-group]');await page.fill('#option-group-name','Extras Edited');
 await page.evaluate(()=>rejectNext='option_groups:update');await page.click('[data-save-option-group]');
 await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent.includes('Synthetic transport failure'));
 check(!(await page.locator('[data-save-option-group]').isDisabled()),'rejected save releases busy controls');
 check(await page.inputValue('#option-group-name')==='Extras Edited','failed save preserves draft');
 await page.click('[data-save-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option group updated.');
 check(await page.locator('[data-option-group-form]').isHidden(),'save returns view');
 check((await page.locator('[data-option-group-summary]').textContent()).includes('Extras Edited'),'updated summary');
 await page.click('[data-toggle-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option group reactivated.');check(true,'group activation preserved');
 await page.click('[data-toggle-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option group deactivated.');check(true,'group deactivation preserved');
 await page.click('[data-edit-option-choice]');check(await page.inputValue('#option-choice-label')==='Extra <test>','choice edit populated');
 await page.fill('#option-choice-price-delta','27.5');await page.click('[data-save-option-choice]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option choice updated.');
 check(await page.locator('[data-option-choice-form]').isHidden(),'choice save returns view');check(await page.evaluate(()=>rows.option_choices[1].price_delta===27.5),'price semantics preserved');
 await page.click('[data-toggle-option-choice]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option choice reactivated.');
 await page.click('[data-toggle-option-choice]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option choice deactivated.');check(true,'choice activation/deactivation');
 await page.click('[data-new-option-choice]');check(await page.inputValue('#option-choice-label')==='','new choice blank');await page.fill('#option-choice-label','Synthetic Choice');await page.click('[data-save-option-choice]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option choice created.');
 check(await page.evaluate(()=>rows.option_choices.at(-1).option_group_id==='extras'),'new choice correct parent');
 check((await page.locator('[data-option-choice-summary]').textContent()).includes('Synthetic Choice'),'new choice selected view');
 await page.click('[data-new-option-group]');check(await page.inputValue('#option-group-name')==='','new group blank');check(await page.inputValue('#option-group-key')==='','new group no inherited key');check(await page.locator('#option-library-choice').isDisabled(),'no saved group disables choice');
 await page.fill('#option-group-name','Synthetic Group');await page.fill('#option-group-key','synthetic');await page.click('[data-save-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option group created.');
 check(await page.locator('[data-option-group-form]').isHidden(),'create returns view');check((await page.locator('[data-option-group-summary]').textContent()).includes('Synthetic Group'),'new group selected');
 await page.click('[data-new-option-group]');await page.selectOption('#option-library-group','extras');await page.waitForFunction(()=>document.querySelector('#option-library-choice option[value="extra"]'));check(await page.locator('[data-option-group-form]').isHidden(),'selector exits create');
 await page.click('[data-edit-option-choice]');await page.evaluate(()=>holdGroup='sauce');await page.selectOption('#option-library-group','sauce');await page.waitForFunction(()=>releases.length===1);await page.selectOption('#option-library-group','extras');await page.waitForFunction(()=>document.querySelector('#option-library-choice option[value="extra"]'));await page.evaluate(()=>{holdGroup='';releases.shift()();});await page.waitForTimeout(30);
 check(await page.locator('#option-library-choice option[value="tempura"]').count()===0,'late choice response ignored');check(await page.locator('[data-option-choice-form]').isHidden(),'group change exits choice editing');
 check(await page.evaluate(()=>!writes.some(w=>w.op==='delete'||!['option_groups','option_choices'].includes(w.table))),'no unsafe deletion or unrelated writes');
 check(await page.evaluate(()=>rows.option_choices[0].label==='Tempura Sauce'&&rows.option_choices[0].price_delta===0&&rows.option_groups[0].name==='Sauce'),'Sauce unchanged');

 confirmDelete=false;await page.click('[data-delete-option-group]');check(await page.evaluate(()=>deleteCalls.length===0),'cancel does not call RPC');confirmDelete=true;
 await page.click('[data-delete-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent.includes('still contains choices'));check(await page.evaluate(()=>rows.option_groups.some(g=>g.id==='extras')),'group with choices blocked');
 const freshGroup=await page.evaluate(()=>rows.option_groups.find(g=>g.name==='Synthetic Group').id);
 await page.selectOption('#option-library-group',freshGroup);await page.waitForFunction(()=>!document.querySelector('[data-new-option-choice]').disabled);
 await page.evaluate(id=>deleteReasons[id]=['GROUP_ASSIGNED'],freshGroup);await page.click('[data-delete-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent.includes('still assigned'));check(true,'assigned group blocked');
 await page.evaluate(id=>{deleteReasons[id]=[];deleteFailure=true;},freshGroup);await page.click('[data-delete-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent.includes('Unable to delete'));check(!(await page.locator('[data-delete-option-group]').isDisabled()),'failure releases delete busy flag');
 await page.click('[data-delete-option-group]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option group deleted.');check(await page.locator('#option-library-group option[value="'+freshGroup+'"]').count()===0,'deleted group removed');check(await page.inputValue('#option-library-group')!==freshGroup,'deleted group not selected');check((await page.locator('[data-option-library-summary]').textContent()).startsWith('2 option groups'),'group counts refreshed');
 await page.selectOption('#option-library-group','extras');await page.waitForFunction(()=>document.querySelector('#option-library-choice option[value="extra"]'));
 const freshChoice=await page.evaluate(()=>rows.option_choices.find(c=>c.label==='Synthetic Choice').id);await page.selectOption('#option-library-choice',freshChoice);
 for(const [reason,text] of [['USED_AS_DEFAULT','default'],['USED_IN_OVERRIDE','pricing'],['USED_IN_COMPATIBILITY','compatibility'],['USED_IN_REQUIREMENT','required'],['USED_IN_CERTIFICATION','reviewed']]){
  await page.evaluate(({id,reason})=>deleteReasons[id]=[reason],{id:freshChoice,reason});await page.click('[data-delete-option-choice]');await page.waitForFunction(text=>document.querySelector('[data-option-manager-status]').textContent.includes(text),text);check(await page.locator('#option-library-choice option[value="'+freshChoice+'"]').count()===1,reason+' blocks removal');
 }
 await page.evaluate(id=>deleteReasons[id]=[],freshChoice);await page.click('[data-delete-option-choice]');await page.waitForFunction(()=>document.querySelector('[data-option-manager-status]').textContent==='Option choice deleted.');check(await page.locator('#option-library-choice option[value="'+freshChoice+'"]').count()===0,'deleted choice removed');check(await page.inputValue('#option-library-choice')!==freshChoice,'deleted choice selection cleared');check((await page.locator('[data-option-library-summary]').textContent()).includes('1 choices'),'choice count refreshed');
 check(await page.evaluate(()=>deleteCalls.every(c=>Object.keys(c.args).length===1)),'safe RPC receives only target ID');
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:1000});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);if(process.env.CURV_OPTION_SCREENSHOTS)await page.locator('[data-option-groups-panel]').screenshot({path:path.join(root,'tests','.option-library-'+width+'.png')});}
 check(await page.locator('[data-option-group-list],[data-option-choice-list],[data-option-group-detail]').count()===0,'old card containers removed');check(errors.length===0,errors.join('\n'));
 check(await page.locator('[data-menu-manager-view-tab="products"]').first().count()===1,'product navigation preserved despite simulated read error');
 console.log('Option Library browser: '+count+' assertions passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
