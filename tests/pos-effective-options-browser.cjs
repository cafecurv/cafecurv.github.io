// Real POS script/UI with mock transport. No SQL and no external requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright');
const {raw,id}=require('./pos-effective-options-data.cjs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
try{const page=await browser.newPage();const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('fixtureRpc',async(name,args)=>{calls.push({name,args});if(name==='pos_get_access')return {data:{user_id:id(99),name:'Fixture'},error:null};if(name==='pos_get_catalog')return {data:raw,error:null};throw Error('Unexpected RPC '+name);});
 await page.addInitScript(()=>{window.supabase={createClient:()=>({rpc:(n,a)=>window.fixtureRpc(n,a),auth:{getSession:async()=>({data:{session:{user:{id:'fixture'}}}}),onAuthStateChange:()=>{}}})};});
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin==='https://curv.test'&&/^\/admin\/(pos\.(html|js|css)|admin.css)$/.test(u.pathname))return r.fulfill({path:path.join(__dirname,'..',u.pathname)});return r.abort();});
 await page.goto('https://curv.test/admin/pos.html');await page.getByText('Ready to take orders.',{exact:true}).waitFor();await page.getByRole('button',{name:'Effective Latte'}).click();
 ok(await page.locator('input[value="'+id(20)+'"]').isChecked(),'valid Iced default selected');
 ok(await page.locator('input[value="'+id(21)+'"]').isDisabled(),'Hot unavailable on Regular');
 await page.locator('input[value="'+id(22)+'"]').check();ok((await page.locator('#estimate').innerText()).includes('115.00'),'effective Regular total');
 await page.locator('#size').selectOption(id(11));ok(!(await page.locator('input[value="'+id(20)+'"]').isChecked()),'size change clears Iced');
 ok(await page.locator('input[value="'+id(20)+'"]').isDisabled(),'Iced disabled on Hot size');
 ok(await page.locator('#save-item').isDisabled(),'required selection blocks submit');
 ok((await page.locator('#options').innerText()).includes('35.00'),'size change refreshes visible charge');
 await page.locator('input[value="'+id(21)+'"]').check();ok((await page.locator('#estimate').innerText()).includes('135.00'),'Hot total matches effective charge');
 ok(!(await page.locator('#save-item').isDisabled()),'valid selection addable');
 await page.getByRole('button',{name:'Other Latte'}).click();ok(await page.locator('input[value="'+id(22)+'"]').count()===0,'no product leakage');
 ok(await page.locator('input[value="'+id(20)+'"]').isChecked(),'other product valid default');
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow '+width);}
 ok(!calls.some(c=>/create|add|configure|update/.test(c.name)),'no automatic submission');ok(errors.length===0,errors.join(';'));
 console.log(checks+' POS effective-options offline browser checks passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
