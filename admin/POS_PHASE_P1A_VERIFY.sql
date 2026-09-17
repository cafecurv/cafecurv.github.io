-- READ-ONLY verification draft. Owner reviews/runs after both P1A patches.
-- Do not infer deployment from repository files alone.
select column_name,data_type,is_nullable from information_schema.columns
where table_schema='public' and table_name='orders'
  and (column_name like 'pos_%' or column_name in ('source','status','tracking_token')) order by column_name;
select conname,pg_get_constraintdef(oid) from pg_constraint
where conrelid in ('public.orders'::regclass,'public.order_items'::regclass)
  and (conname like '%pos%' or conname in ('orders_status_check','orders_delivery_state_check'));
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where policyname in ('pos_orders_api_boundary','pos_items_api_boundary');
select n.nspname,p.proname,p.prosecdef,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='pos_private' or (n.nspname='public' and p.proname like 'pos_%') order by 1,2;
select has_schema_privilege('authenticated','pos_private','USAGE') as private_schema_access,
  has_table_privilege('authenticated','public.pos_staff_access','INSERT') as can_grant_self_access,
  has_table_privilege('authenticated','pos_private.commands','SELECT') as can_read_raw_commands;
-- Counts only: no employee names, PIN hashes, auth credentials or customer data.
select source,status,count(*) from public.orders group by source,status order by source,status;
select count(*) as unfinished_committed_commands from pos_private.commands where result is null;
select count(*) as pos_orders_with_tracking_tokens from public.orders where source='pos' and tracking_token is not null;
select count(*) as inconsistent_pos_totals from public.orders o where o.source='pos' and o.total <>
  (select coalesce(sum(i.line_total),0) from public.order_items i where i.order_id=o.id and i.pos_removed_at is null);
