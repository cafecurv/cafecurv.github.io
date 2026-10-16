// No database execution. Baseline/source and reviewed-inventory checks only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8').replace(/^\uFEFF/,'');
const sql=read('admin/MENU_MANAGER_OPTION_POLICIES_PHASE3A.sql');let count=0;
const check=(v,m)=>{assert.ok(v,m);count++;};
const body=(text,name)=>text.match(new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;','i'))?.[1];
const compact=s=>s.replace(/\s+/g,'');
check((sql.match(/^begin;$/gm)||[]).length===1,'one transaction start');
check((sql.match(/^commit;$/gm)||[]).length===1,'one transaction commit');
check(sql.includes("lock_timeout='5s'")&&sql.includes("statement_timeout='60s'"),'bounded locks');
check(sql.includes('enable row level security'),'policy RLS');
check(sql.includes('revoke all on public.product_option_choice_policies from public,anon,authenticated'),'no direct API access');
check(!/grant\s+(insert|update|delete|all)/i.test(sql),'no public writes');
check(!/\b(insert into|update|delete from)\s+(public\.)?(orders|order_items)\b/i.test(sql),'no order writes');
check(!/create (?:or replace )?function public\.(quote_public_cart|submit_public_order)/i.test(sql),'public checkout definitions untouched');
check(sql.includes('MM_3A_COLLISION')&&sql.includes('MM_3A_PRESERVATION'),'collision and preservation aborts');
check(sql.includes("count(*)=0 then '{}'::jsonb"),'empty policy preserves snapshots');
const baselines=['WEBSITE_CONFIGURATION_D0A1_SCHEMA.sql','WEBSITE_PRICING_D0B1_SCHEMA.sql','WEBSITE_PRICING_D0B3_ENGINE.sql','MENU_MANAGER_PRODUCT_SAVE_PHASE1.sql'].map(f=>read('admin/'+f));
for(const [,signature,hash] of sql.matchAll(/\('([^']+\([^']*\))','([a-f0-9]{32})'\)/g)){
 const name=signature.split('(')[0],original=baselines.map(s=>body(s,name)).find(Boolean);
 check(original&&crypto.createHash('md5').update(compact(original)).digest('hex')===hash,'reviewed source guard '+signature);
}
const oldStructure=body(baselines[1],'configuration_private.catalog_structure');
const newStructure=body(sql,'configuration_private.catalog_structure').replace(' || configuration_private.choice_policy_structure(p_product)','');
check(compact(oldStructure)===compact(newStructure),'catalog snapshot changes only by optional policy member');
const oldSave=body(baselines[3],'public.menu_manager_save_product');
const newSave=body(sql,'public.menu_manager_save_product').replace('public.product_option_choice_policies,','');
check(compact(oldSave)===compact(newSave),'Phase 1 save unchanged except policy lock');
check(sql.includes('configuration_private.effective_choice_price(s.product_id,s.product_size_id,s.choice_id) effective_price_delta'),'engine shared price resolution');
check(sql.includes('result:=configuration_private.effective_choice_price(p_product,p_size,p_choice)'),'choice_delta shared resolution');
check(sql.includes('configuration_private.choice_allowed(c.product_id,c.id)'),'engine policy filter');
check(sql.includes('and c.is_active and configuration_private.choice_allowed(p_product,c.id);'),'disabled default invalid');
check(sql.includes("'option_configuration',jsonb_build_object"),'owner editor effective read');
check(sql.includes("'choice_policies',jsonb_agg(to_jsonb(p) order by option_choice_id)"),'stable policy snapshot');
const manifest=JSON.parse(read('admin/PRICING_CERTIFICATION_APPLY.sql').split('$reviewed_snapshot$')[1]);
check(manifest.products.length===59,'reviewed 59-product source');
let tuples=0,overrides=0,requirements=0,defaults=0;
for(const p of manifest.products){
 const s=p.expected_structure;
 check(s.structure_version===1&&!Object.hasOwn(s,'choice_policies'),'existing snapshot remains v1 with no policy: '+p.product_name);
 tuples+=s.compatibility.filter(x=>x.is_active).length;
 overrides+=s.overrides.filter(x=>x.is_active).length;
 requirements+=s.requirements.filter(x=>x.is_active).length;
 defaults+=s.defaults.length;
}
check(tuples===24,'24 reviewed temperature tuples');check(overrides===17,'17 reviewed overrides');
check(requirements===17,'17 reviewed requirements');check(defaults===19,'19 reviewed defaults');
const html=read('menu/index.html');
for(const [,script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(script.trim()){new Function(script);count++;}
check(html.includes('price_by_size: choice.price_by_size'),'map forwarded by hydration');
check(html.includes('price_delta,sort_order,price_by_size'),'effective prices requested');
console.log('Phase 3A static: '+count+' assertions passed (no SQL executed)');
