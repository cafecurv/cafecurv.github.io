// Actual browser and disposable PostgreSQL transport; all external requests blocked.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright');
const {fixture,id,readSql}=require('./menu-manager-options-writer-fixture.cjs');
(async()=>{const f=await fixture();let browser,checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
try{await f.db.exec(readSql('POS_EFFECTIVE_OPTIONS_PHASE_P3.sql'));
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('fixtureRpc',(n,a)=>f.rpc(n,a));
 await page.addInitScript(user=>{window.supabase={createClient:()=>({rpc:(n,a)=>window.fixtureRpc(n,a),auth:{getSession:async()=>({data:{session:{user:{id:user}}}}),onAuthStateChange:()=>{}}})};},id(2));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin==='https://curv.test'&&/^\/admin\/(pos\.(html|js|css)|admin.css)$/.test(u.pathname))return r.fulfill({path:path.join(__dirname,'..',u.pathname)});return r.abort();});
 await page.goto('https://curv.test/admin/pos.html');await page.getByText('Ready to take orders.',{exact:true}).waitFor();
 for(const [name,size,choices,expected]of [['Configurable drink',1101,[3001,3010],125],['Included Oat',1104,[3001],100],['Takoyaki',1107,[3031],130],['Takoyaki',1108,[3031],240],['Takoyaki',1109,[3031],340]]){
  await page.getByRole('button',{name:new RegExp(name)}).click();await page.locator('#size').selectOption(id(size));
  for(const c of choices)await page.locator('input[value="'+id(c)+'"]').check();
  const rendered=await page.locator('#estimate').innerText();const result=(await f.db.query('select pos_private.resolve_line($1,$2) r',[id(size),choices.map(id)])).rows[0].r;
  const total=Number(result.base)+Number(result.delta);eq(total,expected,name+' server total');eq(rendered,'Item total '+new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(total),name+' real browser/server parity');eq(await page.locator('#save-item').isDisabled(),false,'valid choices addable');
 }
 await page.getByRole('button',{name:/Takoyaki/}).click();await page.locator('input[value="'+id(3031)+'"]').check();await page.locator('#size').selectOption(id(1108));eq((await page.locator('#options').innerText()).includes('60.00'),true,'live size charge updates');eq((await page.locator('#estimate').innerText()).includes('240.00'),true,'live size total updates');
 await page.getByRole('button',{name:/Configurable drink/}).click();await page.locator('#size').selectOption(id(1103));eq(await page.locator('input[value="'+id(3010)+'"]').isChecked(),false,'invalid default cleared');eq(await page.locator('input[value="'+id(3010)+'"]').isDisabled(),true,'incompatible default disabled');eq(await page.locator('#save-item').isDisabled(),true,'required temperature blocked');
 const invalid=await f.rpc('pos_create_order',{p_key:id(97000),p_size:id(1103),p_choices:[id(3000),id(3010)],p_quantity:1,p_customer:'Invalid',p_type:'dine_in',p_note:'',p_item_note:''});eq(invalid.error?.details,'POS_OPTIONS_INVALID','server independently rejects incompatible temperature');
 await page.locator('input[value="'+id(3011)+'"]').check();eq((await page.locator('#estimate').innerText()).includes('90.00'),true,'valid Hot total');
 const valid=(await f.db.query('select pos_private.resolve_line($1,$2) r',[id(1103),[id(3000),id(3011)]])).rows[0].r;eq(Number(valid.base)+Number(valid.delta),90,'Hot browser/server parity');
 eq(errors,[],'no browser exceptions');console.log(checks+' POS effective-options real browser/server parity checks passed.');
}finally{if(browser)await browser.close();await f.db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
