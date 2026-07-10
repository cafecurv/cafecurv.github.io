-- CURV Control Inventory Management
-- Phase I2 Verification Queries
--
-- Read-only verification companion for:
-- admin/INVENTORY_PHASE_I2_FOUNDATION.sql
--
-- Run manually after review and after applying the foundation draft.
-- This file avoids destructive test data. Mutation checks are provided as
-- commented transaction-safe examples with ROLLBACK.

-- =========================================================
-- Table Existence
-- =========================================================

select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'inventory_categories',
    'inventory_units',
    'inventory_items',
    'inventory_batches',
    'inventory_movements'
  )
order by table_name;

-- =========================================================
-- Column Definitions
-- =========================================================

select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'inventory_categories',
    'inventory_units',
    'inventory_items',
    'inventory_batches',
    'inventory_movements'
  )
order by table_name, ordinal_position;

-- Expected: movement_group_id is nullable and has no default. Phase I3
-- multi-batch RPCs will explicitly set one shared group id when needed.
select
  table_name,
  column_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_movements'
  and column_name = 'movement_group_id';

-- =========================================================
-- Constraints
-- =========================================================

select
  conrelid::regclass as table_name,
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid in (
    'public.inventory_categories'::regclass,
    'public.inventory_units'::regclass,
    'public.inventory_items'::regclass,
    'public.inventory_batches'::regclass,
    'public.inventory_movements'::regclass
  )
order by (conrelid::regclass)::text, conname;

-- Expected: non-waste movements require reason_code IS NULL; waste movements
-- require an approved reason_code; waste reason "other" requires notes.
select
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid = 'public.inventory_movements'::regclass
  and conname = 'inventory_movements_waste_reason_check';

-- =========================================================
-- Indexes
-- =========================================================

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'inventory_categories',
    'inventory_units',
    'inventory_items',
    'inventory_batches',
    'inventory_movements'
  )
order by tablename, indexname;

-- Expected: partial movement-group index excludes null movement_group_id rows.
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'inventory_movements'
  and indexname = 'inventory_movements_group_idx';

-- =========================================================
-- RLS Enabled Status
-- =========================================================

select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'inventory_categories',
    'inventory_units',
    'inventory_items',
    'inventory_batches',
    'inventory_movements'
  )
order by tablename;

-- =========================================================
-- Policies
-- =========================================================

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'inventory_categories',
    'inventory_units',
    'inventory_items',
    'inventory_batches',
    'inventory_movements'
  )
order by tablename, policyname;

-- =========================================================
-- Grants
-- =========================================================
-- Expected:
-- - authenticated has SELECT only.
-- - anon has no inventory table/view privileges.

select
  table_name,
  grantee,
  privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name like 'inventory%'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- =========================================================
-- Seed Counts and Duplicate Checks
-- =========================================================

select count(*) as inventory_unit_count
from public.inventory_units;

select count(*) as inventory_category_count
from public.inventory_categories;

select
  lower(btrim(name)) as normalized_name,
  count(*) as duplicate_count
from public.inventory_units
group by lower(btrim(name))
having count(*) > 1
order by normalized_name;

select
  lower(btrim(abbreviation)) as normalized_abbreviation,
  count(*) as duplicate_count
from public.inventory_units
group by lower(btrim(abbreviation))
having count(*) > 1
order by normalized_abbreviation;

select
  lower(btrim(name)) as normalized_name,
  count(*) as duplicate_count
from public.inventory_categories
group by lower(btrim(name))
having count(*) > 1
order by normalized_name;

-- =========================================================
-- Reporting View Existence
-- =========================================================

select
  table_schema,
  table_name,
  'VIEW' as object_type
from information_schema.views
where table_schema = 'public'
  and table_name in (
    'inventory_stock_summary',
    'inventory_low_stock',
    'inventory_expiry_watch',
    'inventory_movement_log'
  )
order by table_name;

-- =========================================================
-- Stock Summary View Columns
-- =========================================================

select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_stock_summary'
order by ordinal_position;

select *
from public.inventory_stock_summary
order by is_low_stock desc, category_name, item_name
limit 50;

-- Expected: active stock summary screens exclude archived items.
select count(*) as stock_summary_inactive_item_rows
from public.inventory_stock_summary
where is_active <> true;

-- =========================================================
-- Low Stock View Behavior
-- =========================================================
-- Expected behavior: active items where current_stock <= low_stock_threshold.

select
  item_id,
  item_name,
  current_stock,
  low_stock_threshold,
  is_low_stock,
  is_active
from public.inventory_low_stock
order by category_name, item_name
limit 50;

select count(*) as low_stock_rows_that_do_not_match_rule
from public.inventory_low_stock
where is_active <> true
   or current_stock > low_stock_threshold
   or is_low_stock <> true;

-- =========================================================
-- Expiry Watch Classification
-- =========================================================
-- Status bands:
-- - expired: expiry date before today
-- - urgent: today through 7 days from today
-- - soon: 8 through 30 days from today
-- - upcoming: more than 30 days from today

select
  batch_id,
  item_name,
  batch_ref,
  expiry_date,
  days_until_expiry,
  expiry_status,
  quantity_remaining
from public.inventory_expiry_watch
order by expiry_date, item_name, batch_ref
limit 100;

select count(*) as expiry_watch_rows_that_do_not_match_filter
from public.inventory_expiry_watch
where quantity_remaining <= 0
   or expiry_date is null;

-- Expected: expiry watch screens exclude archived items.
select count(*) as expiry_watch_inactive_item_rows
from public.inventory_expiry_watch ew
join public.inventory_items i on i.id = ew.item_id
where i.is_active <> true;

-- =========================================================
-- Movement Log View
-- =========================================================

select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_movement_log'
order by ordinal_position;

-- Expected: movement log includes batch_origin for batch context.
select
  table_name,
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_movement_log'
  and column_name = 'batch_origin';

select *
from public.inventory_movement_log
order by created_at desc
limit 100;

-- =========================================================
-- Immutability Trigger Verification
-- =========================================================

select
  event_object_table,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'inventory_movements'
  and trigger_name in (
    'reject_inventory_movement_update',
    'reject_inventory_movement_delete'
  )
order by trigger_name, event_manipulation;

-- =========================================================
-- Transaction-Safe Rejection Examples
-- =========================================================
-- These examples require real UUIDs from the database and should be run only
-- after replacing placeholder values. They intentionally end with ROLLBACK.

-- Invalid movement type rejection guidance:
/*
begin;
insert into public.inventory_movements (
  item_id,
  movement_type,
  quantity,
  created_by
)
values (
  'PASTE_INVENTORY_ITEM_UUID_HERE',
  'bad_type',
  1,
  'PASTE_OWNER_AUTH_USER_UUID_HERE'
);
rollback;
*/

-- Negative quantity rejection guidance:
/*
begin;
insert into public.inventory_movements (
  item_id,
  movement_type,
  quantity,
  created_by
)
values (
  'PASTE_INVENTORY_ITEM_UUID_HERE',
  'stock_in',
  -1,
  'PASTE_OWNER_AUTH_USER_UUID_HERE'
);
rollback;
*/

-- Reversal without reference rejection guidance:
/*
begin;
insert into public.inventory_movements (
  item_id,
  movement_type,
  quantity,
  notes,
  created_by
)
values (
  'PASTE_INVENTORY_ITEM_UUID_HERE',
  'reversal',
  1,
  'Reversal test without reference should fail.',
  'PASTE_OWNER_AUTH_USER_UUID_HERE'
);
rollback;
*/

-- Non-waste reason_code rejection guidance:
/*
begin;
insert into public.inventory_movements (
  item_id,
  movement_type,
  quantity,
  reason_code,
  created_by
)
values (
  'PASTE_INVENTORY_ITEM_UUID_HERE',
  'stock_out',
  1,
  'expired',
  'PASTE_OWNER_AUTH_USER_UUID_HERE'
);
rollback;
*/

-- Waste without reason rejection guidance:
/*
begin;
insert into public.inventory_movements (
  item_id,
  movement_type,
  quantity,
  created_by
)
values (
  'PASTE_INVENTORY_ITEM_UUID_HERE',
  'waste',
  1,
  'PASTE_OWNER_AUTH_USER_UUID_HERE'
);
rollback;
*/

-- Waste reason "other" without notes rejection guidance:
/*
begin;
insert into public.inventory_movements (
  item_id,
  movement_type,
  quantity,
  reason_code,
  created_by
)
values (
  'PASTE_INVENTORY_ITEM_UUID_HERE',
  'waste',
  1,
  'other',
  'PASTE_OWNER_AUTH_USER_UUID_HERE'
);
rollback;
*/

-- Movement immutability verification guidance:
/*
begin;
update public.inventory_movements
set notes = 'This update should fail.'
where id = 'PASTE_MOVEMENT_UUID_HERE';
rollback;
*/

/*
begin;
delete from public.inventory_movements
where id = 'PASTE_MOVEMENT_UUID_HERE';
rollback;
*/
