const assert=require('node:assert/strict');
const {fixture,id,request}=require('./menu-manager-options-writer-fixture.cjs');
(async()=>{const {db}=await fixture();let n=0,key=15000;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};const check=(v,m)=>{assert.ok(v,m);n++;};
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const rpc=async(name,p)=>(await q('select public.'+name+'($1) result',[typeof p==='object'&&p!==null?JSON.stringify(p):p]))[0].result;
const edit=p=>rpc('menu_manager_get_product_editor',id(p));const save=r=>rpc('menu_manager_save_product',r);
const req=async(p,options=true)=>{const e=await edit(p);return {...request(e,key++),...(options?{options:e.options}:{})};};
const fails=async(fn,detail)=>{let e;try{await fn();}catch(x){e=x;}check(e,'expected rejection');if(detail)eq(e.detail,detail);};
const state=async()=>{const out={};for(const t of ['products','product_sizes','product_option_groups','product_option_defaults','product_option_choice_policies','product_size_option_choice_compatibility','product_option_choice_price_overrides','product_option_choice_override_requirements','configuration_private.product_pricing_certifications','menu_save_private.requests'])out[t]=(await q('select coalesce(jsonb_agg(x order by x::text),\'[]\'::jsonb) rows from (select to_jsonb(t) x from '+t+' t) t'))[0].rows;return out;};
try{
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
 let e=await edit(1001);check(e.options_version===1&&e.options.length===3,'editable configuration returned');check(e.options_library.length>0,'existing set library');check(e.option_recipes.some(r=>r.name==='americano'),'owner read shares authoritative recipe contract');
 const preserved=await q("select configuration_private.catalog_structure($1)-'sizes' s",[id(1001)]);await save(await req(1001,false));eq(await q("select configuration_private.catalog_structure($1)-'sizes' s",[id(1001)]),preserved,'omitted options preserved');
 let r=await req(1000);const source=(await edit(1001)).options.find(g=>g.option_group_id===id(2000));r.options=[structuredClone(source)];r.options[0].is_required=false;r.options[0].min_selections=0;
 const first=await save(r);check(first.ok,'attach existing set');eq(await save(r),first,'idempotent replay');await fails(()=>save({...r,product:{...r.product,name:'Different'}}),'MM_SAVE_KEY_CONFLICT');
 const b=await q("select configuration_private.catalog_structure($1)-'sizes' s",[id(1002)]);
 r=await req(1000);let c=r.options[0].choices.find(c=>c.option_choice_id===id(3001));c.product_price_delta=20;await save(r);
 eq(Number((await q('select configuration_private.choice_delta($1,$2,$3) p',[id(1000),id(1100),id(3001)]))[0].p),20,'product charge');eq(await q("select configuration_private.catalog_structure($1)-'sizes' s",[id(1002)]),b,'other product unchanged');
 r=await req(1000);c=r.options[0].choices.find(c=>c.option_choice_id===id(3001));c.product_price_delta=null;await save(r);eq(Number((await q('select configuration_private.choice_delta($1,$2,$3) p',[id(1000),id(1100),id(3001)]))[0].p),25,'shared fallback');
 r=await req(1000);c=r.options[0].choices.find(c=>c.option_choice_id===id(3001));c.enabled=false;await save(r);eq((await q('select * from public.get_public_effective_option_choices() where product_id=$1 and option_choice_id=$2',[id(1000),id(3001)])).length,0,'disabled hidden');
 r=await req(1000);c=r.options[0].choices.find(c=>c.option_choice_id===id(3001));c.enabled=true;c.default=true;r.options[0].choices.find(c=>c.option_choice_id===id(3000)).default=false;await save(r);check((await edit(1000)).options[0].choices.find(c=>c.option_choice_id===id(3001)).default,'default atomically saved');
 r=await req(1000);const before=await state();r.product.name='Rollback';r.options[0].choices.find(c=>c.option_choice_id===id(3001)).enabled=false;await fails(()=>save(r),'MM_OPTIONS_INPUT');eq(await state(),before,'all tables rollback');
 const stale=await req(1000);await save(await req(1000));await fails(()=>save(stale),'MM_SAVE_STALE');
 r=await req(1005);c=r.options[0].choices.find(c=>c.option_choice_id===id(3031));c.price_by_size[id(1108)]=61;await save(r);eq(Number((await q('select configuration_private.choice_delta($1,$2,$3) p',[id(1005),id(1108),id(3031)]))[0].p),61,'contextual charge');
 r=await req(1005);delete r.options[0].choices.find(c=>c.option_choice_id===id(3031)).price_by_size[id(1108)];await fails(()=>save(r),'MM_OPTIONS_PRICE');
 r=await req(1001);const temp=r.options.find(g=>g.option_group_id===id(2001));temp.compatibility[id(1101)]=[id(3011)];await save(r);eq((await edit(1001)).options.find(g=>g.option_group_id===id(2001)).compatibility[id(1101)],[id(3011)],'temperature size edit');
 r=await req(1000);r.options=[];await save(r);eq((await edit(1000)).options,[],'remove all attachments');
 r=await req(1000,false);r.product.name='Americano';await fails(()=>save(r),'MM_OPTIONS_RECIPE');
 for(const [name,keys]of [['Brown Sugar Cinnamon Cream Latte',['milk','extrashot','syrup','sauce']],['Pure Usucha',['extrapower']],['Double Matcha Cloud',['extrapower','sweetener']],['Matcha Sunrise',['extrapower','milk']],['Shrimp Tempura',[]]]){
  const rows=(await q('select menu_save_private.recipe_contract() r'))[0].r;eq(rows.find(x=>x.name===name.toLowerCase()).keys,[...keys].sort(),'recipe '+name);
 }
 // Negative payloads must leave every row and the request ledger unchanged.
 for(const [label,mutate]of [
  ['duplicate group',r=>r.options.push(structuredClone(r.options[0]))],
  ['duplicate choice',r=>r.options[0].choices[0]=structuredClone(r.options[0].choices[1])],
  ['foreign choice',r=>r.options[0].choices[0].option_choice_id=id(3031)],
  ['negative price',r=>r.options[0].choices[0].product_price_delta=-1],
  ['foreign size',r=>r.options[0].choices[0].price_by_size={[id(1100)]:10}],
  ['selection mode injection',r=>r.options[0].selection_type='multi'],
  ['invalid group',r=>r.options[0].option_group_id=id(99999)],
  ['invalid minimum',r=>r.options[0].min_selections=2],
  ['disabled compatibility',r=>{const g=r.options.find(g=>g.option_group_id===id(2001));g.choices.find(c=>c.option_choice_id===id(3011)).enabled=false;}]
 ]){r=await req(1001);mutate(r);const snapshot=await state();await fails(()=>save(r));eq(await state(),snapshot,label+' full rollback');}
 // Re-enabling cannot discard the remembered required contextual price schedule.
 r=await req(1005);c=r.options[0].choices.find(c=>c.option_choice_id===id(3031));c.enabled=false;c.price_by_size={};await save(r);
 r=await req(1005);c=r.options[0].choices.find(c=>c.option_choice_id===id(3031));c.enabled=true;await fails(()=>save(r),'MM_OPTIONS_PRICE');
 c.price_by_size={[id(1107)]:30,[id(1108)]:61,[id(1109)]:90};await save(r);
 const effective=(await q('select * from public.get_public_effective_option_choices() where product_id=$1 and option_choice_id=$2',[id(1005),id(3031)]))[0];
 eq(Number(effective.price_by_size[id(1108)]),61,'public effective display charge');
 const item={product_id:id(1005),product_size_id:id(1108),option_choice_ids:[id(3031)],quantity:1,item_note:null};
 const quote=(await q('select public.quote_public_cart($1) r',[JSON.stringify({pricing_contract_version:2,items:[item]})]))[0].r;check(quote.ok,'quote after option Save');
 const v2=require('./public-submission-v2-fixture.cjs');const submitted=await v2.submit(db,await v2.reviewed(db,v2.payload(19001,[item])));check(!!submitted.order_number,'v2 submission after option Save');
 eq(Number((await q('select i.unit_price from order_items i join orders o on o.id=i.order_id where o.order_number=$1',[submitted.order_number]))[0].unit_price),Number((await q('select price from product_sizes where id=$1',[id(1108)]))[0].price)+61,'submission and display match');
 // A submitted identity may never move a row to another product, even inside a save capability.
 await db.exec('begin');
 await q('insert into menu_save_private.active_save values(pg_backend_pid(),txid_current(),$1)',[id(1002)]);
 await fails(()=>q('update public.product_option_groups set product_id=$1 where product_id=$2',[id(1002),id(1001)]),'MM_SAVE_BOUNDARY');
 await db.exec('rollback');
 r=await req(1001);const tg=r.options.find(g=>g.option_group_id===id(2001));
 const activeTemperature=tg.choices.find(c=>c.enabled).option_choice_id;
 for(const size of Object.keys(tg.compatibility))tg.compatibility[size]=tg.compatibility[size].filter(c=>c!==activeTemperature);
 const beforeTemperature=await state();await fails(()=>save(r),'MM_OPTIONS_TEMPERATURE_SIZE');eq(await state(),beforeTemperature,'unused enabled temperature rolls back all changes');
 const libraryBefore=await q('select menu_save_private.options_library() value');
 await save(await req(1001));eq(await q('select menu_save_private.options_library() value'),libraryBefore,'shared labels values and prices unchanged');
 const draftRequest=request(null,key++);draftRequest.product.name='Americano';
 const draftResult=await save(draftRequest);check(draftResult.ok&&!draftResult.is_published,'initial recipe draft saves without options');
 const draftEditor=await rpc('menu_manager_get_product_editor',draftResult.product_id);
 await fails(()=>save(request(draftEditor,key++,'publish')),'MM_OPTIONS_RECIPE');
 // Real ordinary authenticated permissions, then anonymous denial.
 await q('set role authenticated');check(!!(await edit(1001)).options_version,'owner read under actual role');
 await save(await req(1001));n++;
 await fails(()=>q('select menu_save_private.reconcile_options($1,$2)',[id(1001),'[]']));
 await q('reset role');await q('set role anon');await fails(()=>edit(1001));await q('reset role');
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(3)]);await fails(()=>save(r),'MM_SAVE_AUTH');
 console.log('Phase 3B writer database: '+n+' assertions passed');
}finally{await db.close();}})().catch(e=>{console.error(e.message,e.detail||'');process.exitCode=1;});
