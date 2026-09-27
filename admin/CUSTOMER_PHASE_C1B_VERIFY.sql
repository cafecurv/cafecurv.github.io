-- C1B read-only verification. Run after schema then backend.
begin read only;
select c.relname,c.relrowsecurity,c.relacl from pg_class c
where c.oid='public.customers'::regclass;
select r.rolname,
  has_table_privilege(r.oid,'public.customers','SELECT') can_select,
  has_table_privilege(r.oid,'public.customers','INSERT') can_insert,
  has_table_privilege(r.oid,'public.customers','UPDATE') can_update,
  has_table_privilege(r.oid,'public.customers','DELETE') can_delete,
  has_schema_privilege(r.oid,'customer_private','USAGE') private_schema_usage
from pg_roles r where rolname in ('anon','authenticated');
select policyname,roles,cmd,qual from pg_policies where schemaname='public' and tablename='customers';
select conname,pg_get_constraintdef(oid) from pg_constraint
where conrelid in ('public.customers'::regclass,'public.orders'::regclass)
  and (conrelid='public.customers'::regclass or conname like '%customer%');
select pg_get_functiondef('public.submit_public_order(jsonb)'::regprocedure);
select proname,prosecdef,pg_get_userbyid(proowner) owner,proconfig,proacl
from pg_proc where oid in ('customer_private.normalize_phone(text)'::regprocedure,
  'customer_private.link_website_order(uuid)'::regprocedure,'public.submit_public_order(jsonb)'::regprocedure);
rollback;
-- Owner-run assertions; metadata only, no customer rows exposed.
begin read only;
do $$
declare r text;
begin
  if not (select relrowsecurity from pg_class where oid='public.customers'::regclass) then
    raise exception 'C1B customer RLS is disabled'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='customers') then
    raise exception 'C1B expects no customer policies before an explicit admin access phase'; end if;
  foreach r in array array['anon','authenticated'] loop
    if has_table_privilege(r,'public.customers','SELECT,INSERT,UPDATE,DELETE')
      or has_any_column_privilege(r,'public.customers','SELECT,INSERT,UPDATE')
      or has_schema_privilege(r,'customer_private','USAGE')
      or has_function_privilege(r,'customer_private.link_website_order(uuid)','EXECUTE')
      or has_function_privilege(r,'customer_private.normalize_phone(text)','EXECUTE') then
      raise exception 'C1B private access unexpectedly granted to %',r;
    end if;
  end loop;
  if position('perform customer_private.link_website_order(v_order_id);' in
    pg_get_functiondef('public.submit_public_order(jsonb)'::regprocedure))=0 then
    raise exception 'C1B submission hook missing'; end if;
end;
$$;
rollback;
