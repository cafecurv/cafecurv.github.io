-- CURV Control Inventory Management
-- Phase I3 Verification Queries
--
-- Read-only checks plus commented transaction-safe examples for:
-- admin/INVENTORY_PHASE_I3_OPERATION_RPCS.sql
--
-- Do not run mutation examples against production data. Use a reviewed local or
-- disposable environment, keep BEGIN/ROLLBACK, and replace placeholder UUIDs.

-- =========================================================
-- Function Existence, Signatures, Security, and Search Path
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
  and p.proname in (
    'inventory_opening_balance',
    'inventory_stock_in',
    'inventory_stock_out',
    'inventory_record_waste',
    'inventory_adjust_to_count'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Expected:
-- - is_security_definer = true
-- - function_config includes search_path=public, pg_temp

-- =========================================================
-- Execute Grants
-- =========================================================

select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'inventory_opening_balance',
    'inventory_stock_in',
    'inventory_stock_out',
    'inventory_record_waste',
    'inventory_adjust_to_count'
  )
  and grantee in ('anon', 'authenticated', 'public')
order by routine_name, grantee, privilege_type;

-- Expected:
-- - authenticated has EXECUTE.
-- - anon and public do not have EXECUTE.

-- =========================================================
-- Unique Item + Batch Reference Index
-- =========================================================

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'inventory_batches'
  and indexname = 'inventory_batches_item_batch_ref_ci_unique_idx';

-- =========================================================
-- Updated Stock Summary Columns and Low Stock Rule
-- =========================================================

select
  table_name,
  ordinal_position,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'inventory_stock_summary',
    'inventory_low_stock'
  )
order by table_name, ordinal_position;

-- Expected order for both views:
-- 1-14: Phase I2 columns through is_active
-- 15: usable_stock
-- 16: expired_stock

select count(*) as missing_expected_stock_summary_columns
from (
  values
    ('current_stock'),
    ('usable_stock'),
    ('expired_stock'),
    ('is_low_stock')
) as expected(column_name)
where not exists (
  select 1
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'inventory_stock_summary'
    and c.column_name = expected.column_name
);

select count(*) as low_stock_rows_that_do_not_match_usable_rule
from public.inventory_low_stock
where usable_stock > low_stock_threshold
   or is_low_stock <> true
   or is_active <> true;

select
  item_id,
  item_name,
  current_stock,
  usable_stock,
  expired_stock,
  low_stock_threshold,
  is_low_stock
from public.inventory_stock_summary
order by is_low_stock desc, item_name
limit 50;

-- =========================================================
-- Audit Correction Static Review Notes
-- =========================================================
-- Confirm in admin/INVENTORY_PHASE_I3_OPERATION_RPCS.sql before running:
-- - Automatic expired waste has a post-loop v_needed guard with
--   INV_INSUFFICIENT_EXPIRED_STOCK.
-- - Automatic non-expired waste has a post-loop v_needed guard with
--   INV_INSUFFICIENT_USABLE_STOCK.
-- - Supplied batch queries include item_id ownership before FOR UPDATE.
-- - Caller-supplied blank batch references use INV_INVALID_BATCH_REF.
-- - Actual duplicate batch references still use INV_DUPLICATE_BATCH_REF.
-- - Multi-batch deduction loops keep item-row serialization and FEFO ordering.

-- =========================================================
-- Manual Two-Session Concurrency Test
-- =========================================================
-- Do not claim this passed unless actually performed.
-- Session A:
--   begin;
--   select public.inventory_stock_out('PASTE_ITEM_UUID_HERE', 1, 'session A lock test', null);
--   -- keep the transaction open briefly.
-- Session B:
--   begin;
--   select public.inventory_stock_out('PASTE_SAME_ITEM_UUID_HERE', 1, 'session B lock test', null);
-- Expected:
--   Session B waits for Session A because both functions lock the item row
--   with SELECT ... FOR UPDATE.
-- Finish both sessions with rollback in a disposable test environment.

-- =========================================================
-- Transaction-Safe Mutation Examples
-- =========================================================
-- Replace placeholders only in an approved local/disposable environment.
-- Keep ROLLBACK so examples do not persist test data.

-- Unauthenticated rejection guidance:
-- Run signed out, or with no auth context, and expect INV_AUTH_REQUIRED.
/*
begin;
select public.inventory_stock_out('PASTE_ITEM_UUID_HERE', 1, 'auth test', null);
rollback;
*/

-- Non-admin rejection guidance:
-- Run as an authenticated user without public.admin_profiles owner access and
-- expect INV_ADMIN_REQUIRED.
/*
begin;
select public.inventory_stock_out('PASTE_ITEM_UUID_HERE', 1, 'admin test', null);
rollback;
*/

-- Inactive item rejection guidance:
/*
begin;
select public.inventory_stock_in('PASTE_INACTIVE_ITEM_UUID_HERE', 1, null, null, 'inactive test', null, null);
rollback;
*/

-- Invalid quantity guidance:
/*
begin;
select public.inventory_stock_in('PASTE_ITEM_UUID_HERE', 0, null, null, 'invalid quantity test', null, null);
rollback;
*/

-- Expiry required guidance for an expiry-tracked item:
/*
begin;
select public.inventory_stock_in('PASTE_EXPIRY_TRACKED_ITEM_UUID_HERE', 1, null, null, 'expiry required test', null, null);
rollback;
*/

-- Opening balance expiry-required guidance:
/*
begin;
select public.inventory_opening_balance(
  'PASTE_EXPIRY_TRACKED_ITEM_UUID_HERE',
  10,
  null,
  null,
  null,
  'opening expiry required test'
);
rollback;
*/

-- Past expiry rejected guidance:
/*
begin;
select public.inventory_stock_in('PASTE_ITEM_UUID_HERE', 1, current_date - 1, null, 'past expiry test', null, null);
rollback;
*/

-- Opening balance and repeated opening warning guidance:
/*
begin;
select public.inventory_opening_balance('PASTE_ITEM_UUID_HERE', 10, null, null, 'OPEN-TEST-001', 'test opening');
select public.inventory_opening_balance('PASTE_ITEM_UUID_HERE', 5, null, null, 'OPEN-TEST-002', 'test repeated opening warning');
rollback;
*/

-- Stock-in and duplicate batch reference guidance:
/*
begin;
select public.inventory_stock_in('PASTE_ITEM_UUID_HERE', 10, null, null, 'stock in test', 'SI-TEST-001', null);
select public.inventory_stock_in('PASTE_ITEM_UUID_HERE', 5, null, null, 'duplicate ref test', 'si-test-001', null);
rollback;
*/

-- FEFO stock-out across two batches and shared movement group guidance:
/*
begin;
select public.inventory_stock_in('PASTE_ITEM_UUID_HERE', 3, current_date + 10, null, 'batch A', 'SI-FEFO-A', null);
select public.inventory_stock_in('PASTE_ITEM_UUID_HERE', 3, current_date + 20, null, 'batch B', 'SI-FEFO-B', null);
select public.inventory_stock_out('PASTE_ITEM_UUID_HERE', 5, 'FEFO test', null);
select movement_group_id, count(*) as movement_rows
from public.inventory_movements
where reference_text = 'FEFO test'
group by movement_group_id;
rollback;
*/

-- Expired batch exclusion and insufficient usable stock zero-mutation guidance:
/*
begin;
-- Prepare an expired batch manually only in a disposable database if needed.
select public.inventory_stock_out('PASTE_ITEM_UUID_WITH_ONLY_EXPIRED_STOCK_HERE', 1, 'expired exclusion test', null);
rollback;
*/

-- Specific-batch waste guidance:
/*
begin;
select public.inventory_record_waste('PASTE_ITEM_UUID_HERE', 1, 'spoiled', 'PASTE_BATCH_UUID_HERE', 'specific batch waste test');
rollback;
*/

-- Expired auto-allocation guidance:
/*
begin;
select public.inventory_record_waste('PASTE_ITEM_UUID_HERE', 1, 'expired', null, 'expired auto allocation test');
rollback;
*/

-- Other reason without notes guidance:
/*
begin;
select public.inventory_record_waste('PASTE_ITEM_UUID_HERE', 1, 'other', null, null);
rollback;
*/

-- Early-expiry waste warning guidance:
/*
begin;
select public.inventory_record_waste('PASTE_ITEM_UUID_HERE', 1, 'expired', 'PASTE_NON_EXPIRED_BATCH_UUID_HERE', 'quality failed before listed expiry');
rollback;
*/

-- Zero-delta adjustment guidance:
/*
begin;
select public.inventory_adjust_to_count('PASTE_ITEM_UUID_HERE', PASTE_CURRENT_USABLE_QUANTITY_HERE, 'zero delta adjustment test', null, null);
rollback;
*/

-- Positive adjustment to existing usable batch guidance:
/*
begin;
select public.inventory_adjust_to_count('PASTE_ITEM_UUID_HERE', PASTE_HIGHER_ACTUAL_QUANTITY_HERE, 'positive existing batch adjustment test', 'PASTE_USABLE_BATCH_UUID_HERE', null);
rollback;
*/

-- Expired existing batch adjustment rejection guidance:
/*
begin;
select public.inventory_adjust_to_count('PASTE_ITEM_UUID_HERE', PASTE_HIGHER_ACTUAL_QUANTITY_HERE, 'expired batch adjustment test', 'PASTE_EXPIRED_BATCH_UUID_HERE', null);
rollback;
*/

-- Synthetic adjustment batch guidance:
/*
begin;
select public.inventory_adjust_to_count('PASTE_ITEM_UUID_HERE', PASTE_HIGHER_ACTUAL_QUANTITY_HERE, 'synthetic adjustment batch test', null, current_date + 30);
rollback;
*/

-- Negative adjustment across batches guidance:
/*
begin;
select public.inventory_adjust_to_count('PASTE_ITEM_UUID_HERE', PASTE_LOWER_ACTUAL_QUANTITY_HERE, 'negative adjustment FEFO test', null, null);
rollback;
*/

-- Movement immutability guidance:
/*
begin;
update public.inventory_movements
set notes = 'immutability test'
where id = 'PASTE_MOVEMENT_UUID_HERE';
rollback;
*/

-- Total/usable/expired summary value guidance:
/*
begin;
select
  item_id,
  current_stock,
  usable_stock,
  expired_stock
from public.inventory_stock_summary
where item_id = 'PASTE_ITEM_UUID_HERE';
rollback;
*/
