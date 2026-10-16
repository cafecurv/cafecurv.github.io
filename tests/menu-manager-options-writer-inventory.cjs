// Reviewed production snapshots copied into a disposable PGlite database only.
const assert=require('node:assert/strict');
const {fixture,id,readSql,request}=require('./menu-manager-product-save-fixture.cjs');
(async()=>{const {db}=await fixture();let count=0;
const check=(v,m)=>{assert.ok(v,m);count++;};
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);count++;};
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const manifest=JSON.parse(readSql('PRICING_CERTIFICATION_APPLY.sql').split('$reviewed_snapshot$')[1]);
const migration=readSql('MENU_MANAGER_OPTION_POLICIES_PHASE3A.sql');
const tables={sizes:'product_sizes',groups:'option_groups',choices:'option_choices',assignments:'product_option_groups',defaults:'product_option_defaults',compatibility:'product_size_option_choice_compatibility',overrides:'product_option_choice_price_overrides',requirements:'product_option_choice_override_requirements'};
try{
 // Privileged fixture setup only; restore every guard before testing migration.
 await db.exec('truncate public.products,public.option_groups cascade');
 for(const table of ['products',...Object.values(tables)])await db.exec('alter table public.'+table+' disable trigger mm_phase1_save_guard');
 for(const p of manifest.products)await q('insert into products(id,name,category_id,is_published,is_available,is_sold_out) values($1,$2,$3,true,true,false)',[p.product_id,p.product_name,id(999)]);
 for(const [key,table]of Object.entries(tables)){
  const columns=new Set((await q("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[table])).map(r=>r.column_name));
  const rows=new Map();for(const p of manifest.products)for(const row of p.expected_structure[key])rows.set(row.id||JSON.stringify(row),row);
  for(const row of rows.values()){
   const keys=Object.keys(row).filter(k=>columns.has(k));
   await q('insert into public.'+table+'('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>row[k]));
  }
 }
 for(const table of ['products',...Object.values(tables)])await db.exec('alter table public.'+table+' enable trigger mm_phase1_save_guard');
 await db.exec('create or replace view public.public_menu_option_choices with (security_invoker=true) as '+migration.split('$reviewed_view$')[1]);
 for(const p of manifest.products)await q("select configuration_private.certify_product($1,configuration_private.catalog_structure($1),'Reviewed snapshot local fixture')",[p.product_id]);
 const structures=async()=>q('select id,configuration_private.catalog_structure(id) s from products order by id');
 const before=await structures();
 const certificates=await q('select * from configuration_private.product_pricing_certifications order by product_id');
 const quote=async(p)=>{
  const s=p.expected_structure,choices=s.defaults.map(d=>d.option_choice_id);
  const size=s.sizes.find(size=>s.groups.filter(g=>g.group_key==='temperature'&&s.assignments.some(a=>a.option_group_id===g.id&&a.is_active)).every(g=>s.compatibility.some(t=>t.is_active&&t.product_size_id===size.id&&choices.includes(t.option_choice_id))));
  return (await q('select public.quote_public_cart($1) result',[JSON.stringify({pricing_contract_version:2,items:[{product_id:p.product_id,product_size_id:size.id,option_choice_ids:choices,quantity:1,item_note:null}]})]))[0].result;
 };
 const publicChoices=await q('select * from public.public_menu_option_choices order by product_id,option_group_id,option_choice_id');
 const identity=async()=>q("select product_id,option_group_id,option_choice_id,id from product_option_defaults order by product_id,option_group_id,option_choice_id");
 const defaultIdentities=await identity();
 const quotes=[];for(const p of manifest.products){const v=await quote(p);check(v.ok,'baseline quote '+p.product_name);quotes.push(v);}
 await db.exec(migration);
 await db.exec(readSql('MENU_MANAGER_CUSTOMER_OPTIONS_PHASE3B.sql'));
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
 eq(await structures(),before,'59 exact structures preserved');eq(await q('select * from configuration_private.product_pricing_certifications order by product_id'),certificates,'59 certificates untouched');
 for(const [i,p]of manifest.products.entries()){
  const editor=(await q('select public.menu_manager_get_product_editor($1) e',[p.product_id]))[0].e;
  const result=(await q('select public.menu_manager_save_product($1) r',[JSON.stringify(request(editor,18000+i))]))[0].r;check(result.ok,'ordinary save '+p.product_name);
  eq((await q('select configuration_private.catalog_structure($1) s',[p.product_id]))[0].s,before.find(r=>r.id===p.product_id).s,'omitted options exact structure '+p.product_name);
  const optionsEditor=(await q('select public.menu_manager_get_product_editor($1) e',[p.product_id]))[0].e;
  const complete={...request(optionsEditor,20000+i),options:optionsEditor.options};
  check((await q('select public.menu_manager_save_product($1) r',[JSON.stringify(complete)]))[0].r.ok,'complete option payload '+p.product_name);
  await q('select configuration_private.assert_pricing_ready($1)',[p.product_id]);count++;
  eq(await quote(p),quotes[i],'same authoritative quote '+p.product_name);
 }
 for(const [table,expected]of [['product_size_option_choice_compatibility',24],['product_option_choice_price_overrides',17],['product_option_choice_override_requirements',17],['product_option_groups',117]])eq((await q('select count(*)::int n from '+table+' where is_active'))[0].n,expected,table+' count');
 eq((await q('select count(*)::int n from product_option_defaults'))[0].n,19,'defaults preserved');
 eq(await identity(),defaultIdentities,'all 19 approved defaults and IDs unchanged');
 // Compare effective projection after the model is installed, independently of legacy display prices.
 const effectiveRows=await q('select * from public.public_menu_option_choices order by product_id,option_group_id,option_choice_id');
 eq(effectiveRows.map(r=>[r.product_id,r.option_group_id,r.option_choice_id,r.label,r.value]),publicChoices.map(r=>[r.product_id,r.option_group_id,r.option_choice_id,r.label,r.value]),'public choice identities and labels unchanged');
 await db.exec('set role anon');check((await q('select * from public.public_menu_option_choices')).length>0,'anon effective read succeeds');await db.exec('reset role');
 console.log('Phase 3B reviewed inventory: '+count+' assertions passed; 59 products');
}finally{await db.close();}})().catch(e=>{console.error(e.message,e.detail||'');process.exitCode=1;});
