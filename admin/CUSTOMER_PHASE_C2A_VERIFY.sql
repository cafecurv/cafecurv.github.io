-- C2A read-only catalog verification. Every gate must PASS.
begin transaction read only;
with expected(signature) as (values
  ('public.customer_admin_list(text,text,text,integer,integer)'),
  ('public.customer_admin_detail(uuid,integer,integer)'),
  ('public.customer_admin_order_items(uuid,uuid)')
)
select e.signature,
  case when p.oid is not null and p.prosecdef and p.provolatile='s'
    and p.proconfig = array['search_path=pg_catalog']::text[]
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not exists (select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE')
    then 'PASS' else 'FAIL' end as security_gate,
  pg_get_userbyid(p.proowner) as owner,p.proconfig,p.proacl,
  pg_get_functiondef(p.oid) as definition
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature);

select case when c.relrowsecurity and not exists (
    select 1 from pg_policies where schemaname='public' and tablename='customers'
  ) then 'PASS' else 'FAIL' end as customer_rls_gate
from pg_class c where c.oid='public.customers'::regclass;

select r.role_name,
  case when not has_table_privilege(r.role_name,'public.customers','SELECT')
    and not has_any_column_privilege(r.role_name,'public.customers','SELECT')
    and not has_schema_privilege(r.role_name,'customer_private','USAGE')
    and not has_function_privilege(r.role_name,'customer_private.normalize_phone(text)','EXECUTE')
    and not has_function_privilege(r.role_name,'customer_private.link_website_order(uuid)','EXECUTE')
  then 'PASS' else 'FAIL' end as direct_access_gate
from (values ('anon'),('authenticated')) r(role_name);

select case when i.indisvalid and i.indisready then 'PASS' else 'FAIL' end as history_index_gate,
  pg_get_indexdef(i.indexrelid) as definition,pg_get_expr(i.indpred,i.indrelid) as predicate
from pg_index i where i.indexrelid='public.orders_customer_history_idx'::regclass;
-- Review predicate/columns above against C1B. This is metadata verification;
-- authorization and projection behavior are tested by tests/customer-admin.cjs.
rollback;
