-- CURV Control Inventory Management
-- Phase I5B Verification Queries
--
-- Read-only checks for:
-- admin/INVENTORY_PHASE_I5B_CREATE_ITEM.sql

-- =========================================================
-- Item Name Index Migration
-- =========================================================

select
  c.relname as index_name,
  ix.indisunique as is_unique,
  pg_get_expr(ix.indexprs, ix.indrelid) as index_expression,
  pg_get_expr(ix.indpred, ix.indrelid) as index_predicate,
  pg_get_indexdef(ix.indexrelid) as index_definition
from pg_index ix
join pg_class c on c.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'inventory_items'
  and c.relname in (
    'inventory_items_name_ci_unique_idx',
    'inventory_items_active_name_ci_unique_idx'
  )
order by c.relname;

select
  case
    when exists (
      select 1
      from pg_index ix
      join pg_class c on c.oid = ix.indexrelid
      join pg_class t on t.oid = ix.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'inventory_items'
        and c.relname = 'inventory_items_name_ci_unique_idx'
        and ix.indisunique = true
        and pg_get_expr(ix.indexprs, ix.indrelid) = 'lower(btrim(name))'
        and ix.indpred is null
    )
    then 'PASS'
    else 'FAIL'
  end as global_item_name_index_unique_expression_no_predicate_check;

select
  case
    when not exists (
      select 1
      from pg_index ix
      join pg_class c on c.oid = ix.indexrelid
      join pg_class t on t.oid = ix.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'inventory_items'
        and c.relname = 'inventory_items_active_name_ci_unique_idx'
    )
    then 'PASS'
    else 'FAIL'
  end as old_partial_item_name_index_removed_check;

select
  case
    when exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'inventory_create_item'
        and pg_get_functiondef(p.oid) like '%inventory_items_name_ci_unique_idx%'
        and pg_get_functiondef(p.oid) like '%CONSTRAINT_NAME%'
    )
    then 'PASS'
    else 'FAIL'
  end as rpc_duplicate_handler_expected_index_name_check;

select
  lower(btrim(name)) as normalized_name,
  count(*) as row_count
from public.inventory_items
group by lower(btrim(name))
having count(*) > 1
order by lower(btrim(name));

-- Expected: no rows.

-- =========================================================
-- Function Signature, Security, and Search Path
-- =========================================================

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as is_security_definer,
  p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'inventory_create_item'
order by pg_get_function_identity_arguments(p.oid);

-- Expected:
-- - identity_arguments =
--   p_name text, p_category_id uuid, p_unit_id uuid,
--   p_low_stock_threshold numeric, p_track_expiry boolean,
--   p_storage_location text
-- - result_type = jsonb
-- - is_security_definer = true
-- - function_config includes search_path=public, pg_temp

select
  case
    when exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'inventory_create_item'
        and pg_get_function_identity_arguments(p.oid) = 'p_name text, p_category_id uuid, p_unit_id uuid, p_low_stock_threshold numeric, p_track_expiry boolean, p_storage_location text'
        and pg_get_function_result(p.oid) = 'jsonb'
        and p.prosecdef = true
        and p.proconfig @> array['search_path=public, pg_temp']
    )
    then 'PASS'
    else 'FAIL'
  end as function_signature_security_search_path_check;

-- =========================================================
-- Execute Grants
-- =========================================================

select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name = 'inventory_create_item'
  and lower(grantee) in ('anon', 'authenticated', 'public')
order by lower(grantee), privilege_type;

select
  case
    when exists (
      select 1
      from information_schema.routine_privileges
      where specific_schema = 'public'
        and routine_name = 'inventory_create_item'
        and lower(grantee) = 'authenticated'
        and privilege_type = 'EXECUTE'
    )
    and not exists (
      select 1
      from information_schema.routine_privileges
      where specific_schema = 'public'
        and routine_name = 'inventory_create_item'
        and lower(grantee) in ('anon', 'public')
        and privilege_type = 'EXECUTE'
    )
    then 'PASS'
    else 'FAIL'
  end as execute_grants_check;

-- =========================================================
-- Existing Schema Expectations
-- =========================================================

select
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_items'
order by ordinal_position;

select
  case
    when not exists (
      select 1
      from (
        values
          (1, 'id'),
          (2, 'name'),
          (3, 'category_id'),
          (4, 'unit_id'),
          (5, 'low_stock_threshold'),
          (6, 'track_expiry'),
          (7, 'storage_location'),
          (8, 'notes'),
          (9, 'is_active'),
          (10, 'created_at'),
          (11, 'updated_at'),
          (12, 'created_by'),
          (13, 'updated_by')
      ) as expected(ordinal_position, column_name)
      where not exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'inventory_items'
          and c.ordinal_position = expected.ordinal_position
          and c.column_name = expected.column_name
      )
    )
    then 'PASS'
    else 'FAIL'
  end as inventory_items_column_order_check;

select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'inventory_items' and column_name in ('created_at', 'updated_at', 'created_by', 'updated_by', 'notes'))
    or (table_name = 'inventory_categories' and column_name = 'is_active')
    or (table_name = 'inventory_units' and column_name = 'is_active')
  )
order by table_name, column_name;

select
  tr.tgname as trigger_name,
  c.relname as table_name,
  pg_get_triggerdef(tr.oid) as trigger_definition
from pg_trigger tr
join pg_class c on c.oid = tr.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not tr.tgisinternal
  and tr.tgname = 'set_inventory_items_updated_at'
  and n.nspname = 'public'
  and c.relname = 'inventory_items';

-- =========================================================
-- Phase Boundary Checks
-- =========================================================

select
  routine_name
from information_schema.routines
where specific_schema = 'public'
  and routine_name in (
    'inventory_update_item',
    'inventory_archive_item',
    'inventory_reactivate_item'
  )
order by routine_name;

-- Expected: no rows.

select
  routine_name
from information_schema.routines
where specific_schema = 'public'
  and routine_name in (
    'inventory_opening_balance',
    'inventory_stock_in',
    'inventory_stock_out',
    'inventory_record_waste',
    'inventory_adjust_to_count'
  )
order by routine_name;

-- Existing stock-operation RPCs may appear here if Phase I3 is installed.
-- Phase I5B does not replace or alter their definitions.

select
  table_name
from information_schema.views
where table_schema = 'public'
  and table_name in (
    'inventory_stock_summary',
    'inventory_low_stock',
    'inventory_expiry_watch',
    'inventory_movement_log'
  )
order by table_name;

-- Existing inventory reporting views may appear here.
-- Phase I5B does not define or replace any view.
