// Static draft checks ONLY. Deliberately never imports a database or executes SQL.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const sql=fs.readFileSync(path.join(root,'admin/MENU_MANAGER_SAFE_OPTION_DELETE.sql'),'utf8');
let n=0;const check=(v,m)=>{assert.ok(v,m);n++;};
check(sql.includes('MM_OPTION_DELETE_COLLISION'),'first-application collision preflight');
check(sql.includes("to_regprocedure('public.is_admin()')")&&sql.includes('proowner='),'trusted migration owner prerequisite');
check(sql.includes('information_schema.columns'),'typed dependency preflight');
check(!/DROP\s|ALTER\s|CASCADE\s*;/i.test(sql),'no destructive schema/cascade commands');
const known=['option_groups','option_choices','product_option_groups','product_option_defaults','product_option_choice_price_overrides','product_size_option_choice_compatibility','product_option_choice_override_requirements','product_pricing_certifications'];
for(const kind of ['group','choice']){
 const start=sql.indexOf('CREATE FUNCTION public.menu_manager_delete_option_'+kind+'(');const end=sql.indexOf('END $$;',start);const body=sql.slice(start,end);
 check(start>=0,kind+' exists');check(body.includes('SECURITY DEFINER')&&body.includes('SET search_path=pg_catalog'),kind+' definer pinned path');
 check(body.includes('auth.uid() IS NULL OR public.is_admin() IS NOT TRUE'),kind+' owner guard');
 check(body.indexOf('auth.uid()')<body.indexOf('LOCK TABLE'),kind+' authorization before locks');
 check(body.includes("current_setting('transaction_isolation') <> 'read committed'"),kind+' prevents stale isolation');
 check(body.includes("SET lock_timeout='2s'")&&body.includes('lock_not_available OR deadlock_detected'),kind+' bounded locks');
 const lock=body.slice(body.indexOf('LOCK TABLE'),body.indexOf('IN SHARE ROW EXCLUSIVE MODE'));
 check(known.every(t=>lock.includes(t)),kind+' locks every known mutable dependency including JSON cert');
 check(body.includes('jsonb_path_exists(expected_structure'),kind+' certification references blocked');
 check(body.includes('pg_constraint')&&body.includes('pg_trigger')&&body.includes('REFERENCE_REVIEW_REQUIRED'),kind+' unexpected dependency fails closed');
 check(body.indexOf('cardinality(reasons)>0')<body.indexOf('DELETE FROM'),kind+' guards precede delete');
 const target='public.option_'+(kind==='group'?'groups':'choices');
 check((body.match(/DELETE FROM /g)||[]).length===1&&body.includes('DELETE FROM '+target+' WHERE id=p_'+kind+'_id'),kind+' only target row deleted');
 check(!body.includes('is_active'),kind+' unused active entries eligible');
 check(sql.includes('REVOKE ALL ON FUNCTION public.menu_manager_delete_option_'+kind+'(uuid) FROM PUBLIC,anon,authenticated;'),kind+' explicit revocation');
 check(sql.includes('GRANT EXECUTE ON FUNCTION public.menu_manager_delete_option_'+kind+'(uuid) TO authenticated;'),kind+' authenticated transport plus internal authorization');
}
for(const reason of ['GROUP_HAS_CHOICES','GROUP_ASSIGNED','USED_AS_DEFAULT','USED_IN_OVERRIDE','USED_IN_COMPATIBILITY','USED_IN_REQUIREMENT','CHOICE_ASSIGNED','USED_IN_CERTIFICATION'])check(sql.includes("'"+reason+"'"),'dependency '+reason);
const js=fs.readFileSync(path.join(root,'admin/admin.js'),'utf8');const part=js.slice(js.indexOf('  const deleteOptionRecord ='),js.indexOf('  const renderOptionGroups ='));
check(part.includes("client.rpc('menu_manager_delete_option_' + kind")&&!part.includes('.delete('),'UI safe RPC only');
check(part.includes('generation !== menuAuthGeneration')&&part.includes('window.confirm'),'confirmation and stale-response guard');
console.log(n+' static safe-delete draft checks passed; SQL was NOT executed.');
