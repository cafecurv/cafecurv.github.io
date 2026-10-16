// Disposable local PGlite only: failed first-install guards must leave no partial DDL.
const assert=require('node:assert/strict');
const {fixture,readSql}=require('./menu-manager-product-save-fixture.cjs');
(async()=>{const {db}=await fixture();let n=0;
const check=(v,m)=>{assert.ok(v,m);n++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const sql=readSql('MENU_MANAGER_CUSTOMER_OPTIONS_PHASE3B.sql'),a=readSql('MENU_MANAGER_OPTION_POLICIES_PHASE3A.sql');
const defs=()=>q("select oid,pg_get_functiondef(oid) definition,proacl,proowner from pg_proc where pronamespace in ('menu_save_private'::regnamespace,'configuration_private'::regnamespace) order by oid");
const reject=async(detail)=>{let e;try{await db.exec(sql);}catch(x){e=x;}await db.exec('rollback');check(!!e,'must reject migration');eq(e.detail,detail,'stable preflight detail');};
try{
 await db.exec('create or replace view public.public_menu_option_choices with (security_invoker=true) as '+a.split('$reviewed_view$')[1]);await db.exec(a);
 const original=(await q("select pg_get_functiondef('configuration_private.effective_choice_price(uuid,uuid,uuid)'::regprocedure) s"))[0].s;
 await db.exec('create or replace function configuration_private.effective_choice_price(p_product uuid,p_size uuid,p_choice uuid) returns numeric language sql stable set search_path=pg_catalog as $$ select 0::numeric $$');
 let before=await defs();await reject('MM_3B_PREREQUISITE');eq(await defs(),before,'source drift no partial DDL');await db.exec(original);
 await db.exec('alter function configuration_private.effective_choice_price(uuid,uuid,uuid) security definer');
 before=await defs();await reject('MM_3B_PREREQUISITE');eq(await defs(),before,'security drift no partial DDL');await db.exec(original);
 await db.exec(sql);check(true,'clean installation succeeds');
 before=await defs();await reject('MM_3B_COLLISION');eq(await defs(),before,'rerun collision preserves definitions');
 for(const role of ['anon','authenticated'])check(!(await q("select has_function_privilege($1,'menu_save_private.reconcile_options(uuid,jsonb)','execute') ok",[role]))[0].ok,role+' private writer denied');
 console.log('Phase 3B preflight: '+n+' assertions passed');
}finally{await db.close();}})().catch(e=>{console.error(e.message,e.detail||'');process.exitCode=1;});
