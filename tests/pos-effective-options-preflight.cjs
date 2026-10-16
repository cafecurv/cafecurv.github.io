// Disposable embedded PostgreSQL: source/ownership/prerequisite drift and full rollback.
const assert=require('node:assert/strict');const {fixture,id,readSql}=require('./menu-manager-options-writer-fixture.cjs');
(async()=>{const {db,rpc}=await fixture();let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};const q=async(s,p=[])=>(await db.query(s,p)).rows;
const migration=readSql('POS_EFFECTIVE_OPTIONS_PHASE_P3.sql');
const defs=()=>q("select oid,pg_get_functiondef(oid) definition,proowner,proacl,prosecdef,proconfig,provolatile from pg_proc where oid in ('public.pos_get_catalog()'::regprocedure,'pos_private.resolve_line(uuid,uuid[])'::regprocedure,'public.quote_public_cart(jsonb)'::regprocedure,'public.submit_public_order_v2(jsonb)'::regprocedure) order by oid");
const state=()=>q("select (select jsonb_agg(to_jsonb(o) order by id) from orders o) orders,(select jsonb_agg(to_jsonb(i) order by id) from order_items i) items,(select jsonb_agg(to_jsonb(c) order by command_key) from pos_private.commands c) commands,(select jsonb_agg(to_jsonb(s) order by id) from pos_kitchen_submissions s) kitchen");
try{
for(const f of ['POS_PHASE_P1B_SCHEMA.sql','POS_PHASE_P1B_BACKEND.sql','POS_PHASE_P1C_BACKEND.sql'])await db.exec(readSql(f));
let r=await rpc('pos_create_order',{p_key:id(95000),p_size:id(1100),p_choices:[],p_quantity:1,p_customer:'Pre-migration',p_type:'dine_in',p_note:'',p_item_note:''});assert.equal(r.error,null);checks++;
r=await rpc('pos_send_kitchen',{p_key:id(95001),p_order_id:r.data.id,p_revision:r.data.revision});assert.equal(r.error,null);checks++;
const baseline=await defs(),history=await state();const catalog=await q('select id,configuration_private.catalog_structure(id) s from products order by id');
const definition=baseline.find(x=>x.definition.includes('pos_get_catalog')).definition;
for(const [name,change,restore] of [
 ['source',definition.replace('perform pos_private.actor();','perform pos_private.actor(); -- deliberately changed source'),definition],
 ['owner','alter function public.pos_get_catalog() owner to anon','alter function public.pos_get_catalog() owner to postgres'],
 ['security','alter function public.pos_get_catalog() security invoker',definition],
 ['search_path','alter function public.pos_get_catalog() set search_path=pg_catalog',definition],
 ['prerequisite','alter function configuration_private.effective_product_choices(uuid) rename to unavailable_effective_choices','alter function configuration_private.unavailable_effective_choices(uuid) rename to effective_product_choices']
]){
 await db.exec(change);const changed=await defs();let error;try{await db.exec(migration);}catch(e){error=e;}eq(error?.detail,'POS_EFFECTIVE_PREREQUISITE',name+' rejected');await db.exec('rollback');eq(await defs(),changed,name+' no partial replacements');eq(await state(),history,name+' no historical writes');await db.exec(restore);
}
eq(await defs(),baseline,'all baseline definitions restored');
await db.exec(migration);eq(await state(),history,'installation preserves nonempty history');eq(await q('select id,configuration_private.catalog_structure(id) s from products order by id'),catalog,'catalog unchanged');
const after=await defs();for(const row of baseline){const newer=after.find(x=>x.oid===row.oid);const {definition:a,...sa}=row,{definition:b,...sb}=newer;eq(sb,sa,'exact security preserved');if(/FUNCTION public\.(quote_public_cart|submit_public_order_v2)/.test(a))eq(b,a,'public checkout untouched');}
console.log(checks+' POS effective-options migration/preflight checks passed.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
