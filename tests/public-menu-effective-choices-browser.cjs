// Real menu scripts and DOM; all network requests are blocked.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let count=0;
const check=(v,m)=>{assert.ok(v,m);count++;};
try{
 const html=fs.readFileSync(path.join(__dirname,'../menu/index.html'),'utf8');
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url()==='https://curv.test/menu/'?r.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}):r.abort());
 await page.goto('https://curv.test/menu/');
 await page.evaluate(()=>{window.fetch=()=>{throw Error('Network forbidden');};window.WebSocket=class{constructor(){throw Error('Network forbidden');}};});
 for(const [,s]of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(s.trim())await page.addScriptTag({content:s});
 await page.evaluate(()=>{
  closeForm();window.uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  window.scenario=(bad=false)=>{
   const cats=[{id:uid(1),name:'New Category',sort_order:0}];
   const products=[{id:uid(2),name:'Product A'},{id:uid(3),name:'Product B'}].map(p=>({...p,category_id:uid(1),is_published:true,is_available:true,is_sold_out:false}));
   const sizes=products.flatMap((p,i)=>['Regular','Large'].map((label,j)=>({id:uid(20+i*2+j),product_id:p.id,label,price:100+j*50,sort_order:j})));
   const groups=products.map(p=>({product_id:p.id,option_group_id:uid(4),group_key:'milk',name:'Milk',selection_type:'single',is_required:false,min_selections:0,max_selections:1}));
   const choices=products.flatMap((p,i)=>[{product_id:p.id,option_group_id:uid(4),option_choice_id:uid(5),label:'Oat',value:'oat',price_delta:20,sort_order:0,
     price_by_size:{[uid(20+i*2)]:bad?null:20,[uid(21+i*2)]:40}},
     ...(i===1?[{product_id:p.id,option_group_id:uid(4),option_choice_id:uid(6),label:'Soy',value:'soy',price_delta:30,sort_order:1,price_by_size:{[uid(22)]:30,[uid(23)]:30}}]:[])]);
   const menu=shapePublicMenuData(cats,products,sizes);menu.options=buildSupabaseOptionsMap(groups,choices,[],products);renderPublicMenuFromSupabase(menu);
  };
  window.panelFor=n=>document.getElementById('panel-'+publicProductPanelTargets.get(uid(n)).panelId);
  window.openProduct=n=>{const t=publicProductPanelTargets.get(uid(n));showSection(t.sectionId);setPublicPanelOpen(t.panelId,true);};
  scenario();openProduct(2);
 });
 const result=await page.evaluate(()=>{
  const panel=panelFor(2),id=publicProductPanelTargets.get(uid(2)).panelId;
  refreshConfigurationPreview(id);
  return {a:panel.querySelectorAll('[data-choice-id]').length,b:panelFor(3).querySelectorAll('[data-choice-id]').length,
    charge:panel.querySelector('[data-choice-id]').dataset.price,error:publicPanelValidation(id)};
 });
 check(result.a===1&&result.b===2,'product-specific returned choices rendered independently');
 check(result.charge==='20','server price used on initial size');check(!result.error,'valid effective map addable');
 const next=await page.evaluate(()=>{
  const p=panelFor(2),id=publicProductPanelTargets.get(uid(2)).panelId;
  handleChipClick(p.querySelector('[data-size-id="'+uid(21)+'"]'));handleChipClick(p.querySelector('[data-choice-id]'));
  return {price:p.querySelector('[data-choice-id]').dataset.price,total:getPanelBasePrice(id)+getPanelAddOnsPrice(id),error:publicPanelValidation(id)};
 });
 check(next.price==='40'&&next.total===190,'size change uses effective charge');check(!next.error,'selection remains valid');
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);}
 await page.evaluate(()=>{scenario(true);openProduct(2);});
 check(await page.evaluate(()=>Boolean(publicPanelValidation(publicProductPanelTargets.get(uid(2)).panelId))),'null price stays blocked');
 await page.evaluate(()=>{const c=publicItemPanels.get(publicProductPanelTargets.get(uid(2)).panelId);c.optionGroups[0].choices[0].price_by_size={};});
 check(await page.evaluate(()=>Boolean(publicPanelValidation(publicProductPanelTargets.get(uid(2)).panelId))),'missing size price stays blocked');
 check(errors.length===0,'no uncaught errors: '+errors.join(';'));
 console.log('Public effective choices browser: '+count+' assertions passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
