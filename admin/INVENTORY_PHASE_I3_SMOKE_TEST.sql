-- TEST ONLY
-- RUN THE ENTIRE FILE
-- DO NOT RUN INDIVIDUAL SECTIONS
-- THIS SCRIPT ENDS WITH ROLLBACK
--
-- CURV Inventory Management - Phase I3 Runtime Smoke Test Draft
--
-- Purpose:
-- Exercise the deployed Phase I3 inventory RPCs in one rollback-safe transaction.
-- This script creates isolated smoke-test inventory records and verifies expected
-- RPC behavior. It never commits.
--
-- Admin/auth simulation:
-- 1. Replace PASTE_EXISTING_ADMIN_USER_UUID_HERE below with an existing Supabase
--    Auth user UUID that already has a public.admin_profiles row with role='owner'.
-- 2. The transaction sets request.jwt.claim.sub to that UUID. Supabase auth.uid()
--    reads that setting in SQL contexts.
-- 3. public.is_admin() checks public.admin_profiles.id = auth.uid(), so the pasted
--    UUID must already exist in public.admin_profiles.
-- 4. This script does not insert fake users into auth.users.

begin;

select set_config('request.jwt.claim.sub', 'PASTE_EXISTING_ADMIN_USER_UUID_HERE', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temp table i3_smoke_results (
  sort_order integer generated always as identity,
  test_name text not null,
  status text not null,
  details text not null
) on commit drop;

do $$
declare
  v_admin_user_id uuid := current_setting('request.jwt.claim.sub', true)::uuid;
  v_suffix text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_category_id uuid;
  v_unit_id uuid;
  v_item_id uuid;
  v_open_response jsonb;
  v_stock_in_response jsonb;
  v_stock_out_response jsonb;
  v_waste_response jsonb;
  v_adjust_out_response jsonb;
  v_adjust_in_response jsonb;
  v_zero_response jsonb;
  v_expired_exclusion_response jsonb;
  v_open_batch_id uuid;
  v_stock_in_batch_id uuid;
  v_expired_batch_id uuid;
  v_open_batch_ref text;
  v_stock_in_batch_ref text;
  v_stock_out_group_id uuid;
  v_open_received_before numeric(14,3);
  v_open_received_after numeric(14,3);
  v_open_remaining numeric(14,3);
  v_stock_in_remaining numeric(14,3);
  v_expired_remaining numeric(14,3);
  v_current_usable numeric(14,3);
  v_movements_before_zero integer;
  v_movements_after_zero integer;
  v_summary_current numeric(14,3);
  v_summary_usable numeric(14,3);
  v_summary_expired numeric(14,3);
  v_smoke_name text := 'CURV I3 Smoke Test Item ' || v_suffix;
begin
  if v_admin_user_id is null then
    raise exception 'Replace PASTE_EXISTING_ADMIN_USER_UUID_HERE with an existing owner/admin Auth user UUID.';
  end if;

  if not exists (
    select 1
    from public.admin_profiles ap
    where ap.id = v_admin_user_id
      and ap.role = 'owner'
  ) then
    raise exception 'The pasted UUID is not an existing CURV owner in public.admin_profiles.';
  end if;

  if not public.is_admin() then
    raise exception 'public.is_admin() did not recognize the pasted admin UUID.';
  end if;

  insert into public.inventory_categories (name, sort_order)
  values ('CURV I3 Smoke Test Category ' || v_suffix, 999001)
  returning id into v_category_id;

  insert into public.inventory_units (name, abbreviation, sort_order)
  values ('curv i3 smoke test unit ' || lower(v_suffix), 'i3-' || lower(substr(v_suffix, 1, 4)), 999001)
  returning id into v_unit_id;

  insert into public.inventory_items (
    name,
    category_id,
    unit_id,
    low_stock_threshold,
    track_expiry,
    storage_location,
    notes,
    created_by,
    updated_by
  )
  values (
    v_smoke_name,
    v_category_id,
    v_unit_id,
    20,
    true,
    'I3 smoke test shelf',
    'Rollback-only Phase I3 smoke test item',
    v_admin_user_id,
    v_admin_user_id
  )
  returning id into v_item_id;

  insert into i3_smoke_results (test_name, status, details)
  values ('setup', 'PASS', 'Created isolated category, unit, and active expiry-tracked item inside rollback transaction');

  v_open_response := public.inventory_opening_balance(
    v_item_id,
    100::numeric,
    current_date + 60,
    1.25::numeric,
    null,
    'I3 smoke opening balance'
  );

  if coalesce((v_open_response ->> 'ok')::boolean, false) is not true then
    raise exception 'Opening balance RPC did not return ok=true.';
  end if;

  v_open_batch_id := (v_open_response #>> '{details,batch_id}')::uuid;
  v_open_batch_ref := v_open_response #>> '{details,batch_ref}';

  insert into i3_smoke_results (test_name, status, details)
  values ('opening_balance', 'PASS', 'Opening batch created with 100 units');

  v_stock_in_response := public.inventory_stock_in(
    v_item_id,
    50::numeric,
    current_date + 30,
    1.10::numeric,
    'I3 smoke supplier delivery',
    null,
    'I3 smoke stock-in'
  );

  if coalesce((v_stock_in_response ->> 'ok')::boolean, false) is not true then
    raise exception 'Stock-in RPC did not return ok=true.';
  end if;

  v_stock_in_batch_id := (v_stock_in_response #>> '{details,batch_id}')::uuid;
  v_stock_in_batch_ref := v_stock_in_response #>> '{details,batch_ref}';

  if lower(v_open_batch_ref) = lower(v_stock_in_batch_ref) then
    raise exception 'Generated opening and stock-in batch references were not unique.';
  end if;

  insert into i3_smoke_results (test_name, status, details)
  values ('stock_in', 'PASS', 'Supplier batch created with unique generated batch reference');

  v_stock_out_response := public.inventory_stock_out(
    v_item_id,
    70::numeric,
    'I3 smoke FEFO stock-out',
    'Deduct 70 units to verify FEFO'
  );

  if coalesce((v_stock_out_response ->> 'ok')::boolean, false) is not true then
    raise exception 'Stock-out RPC did not return ok=true.';
  end if;

  v_stock_out_group_id := (v_stock_out_response ->> 'movement_group_id')::uuid;

  select quantity_remaining
  into v_stock_in_remaining
  from public.inventory_batches
  where id = v_stock_in_batch_id;

  select quantity_remaining
  into v_open_remaining
  from public.inventory_batches
  where id = v_open_batch_id;

  if v_stock_in_remaining <> 0 or v_open_remaining <> 80 then
    raise exception 'FEFO stock-out failed. Stock-in remaining %, opening remaining %.',
      v_stock_in_remaining,
      v_open_remaining;
  end if;

  if (
    select count(*)
    from public.inventory_movements
    where movement_group_id = v_stock_out_group_id
      and movement_type = 'stock_out'
  ) <> 2 then
    raise exception 'Expected stock-out to touch exactly two batches.';
  end if;

  if (
    select count(distinct movement_group_id)
    from public.inventory_movements
    where movement_group_id = v_stock_out_group_id
      and movement_type = 'stock_out'
  ) <> 1 then
    raise exception 'Stock-out movement rows did not share one movement_group_id.';
  end if;

  insert into i3_smoke_results (test_name, status, details)
  values ('fefo_stock_out', 'PASS', 'Earlier expiry stock-in batch was consumed first, then opening batch');

  insert into i3_smoke_results (test_name, status, details)
  values ('movement_grouping', 'PASS', 'Multi-batch stock-out rows shared one movement_group_id');

  v_waste_response := public.inventory_record_waste(
    v_item_id,
    5::numeric,
    'spoiled',
    null,
    'I3 smoke usable waste'
  );

  if coalesce((v_waste_response ->> 'ok')::boolean, false) is not true then
    raise exception 'Waste RPC did not return ok=true.';
  end if;

  if not exists (
    select 1
    from public.inventory_movements
    where movement_group_id = (v_waste_response ->> 'movement_group_id')::uuid
      and movement_type = 'waste'
      and reason_code = 'spoiled'
      and quantity = 5
  ) then
    raise exception 'Waste movement was not recorded with reason spoiled.';
  end if;

  insert into i3_smoke_results (test_name, status, details)
  values ('waste', 'PASS', 'Waste movement recorded with reason_code spoiled');

  v_adjust_out_response := public.inventory_adjust_to_count(
    v_item_id,
    60::numeric,
    'I3 smoke count adjustment out',
    null,
    null
  );

  if coalesce((v_adjust_out_response ->> 'ok')::boolean, false) is not true
     or v_adjust_out_response #>> '{details,result}' <> 'adjusted_out' then
    raise exception 'Adjustment-out RPC did not return adjusted_out.';
  end if;

  if not exists (
    select 1
    from public.inventory_movements
    where movement_group_id = (v_adjust_out_response ->> 'movement_group_id')::uuid
      and movement_type = 'adjustment_out'
      and quantity = 15
  ) then
    raise exception 'Expected adjustment_out movement quantity 15.';
  end if;

  insert into i3_smoke_results (test_name, status, details)
  values ('adjustment_out', 'PASS', 'Physical count lowered usable stock');

  select quantity_received
  into v_open_received_before
  from public.inventory_batches
  where id = v_open_batch_id;

  v_adjust_in_response := public.inventory_adjust_to_count(
    v_item_id,
    80::numeric,
    'I3 smoke count adjustment in to existing batch',
    v_open_batch_id,
    null
  );

  if coalesce((v_adjust_in_response ->> 'ok')::boolean, false) is not true
     or v_adjust_in_response #>> '{details,result}' <> 'adjusted_in' then
    raise exception 'Adjustment-in RPC did not return adjusted_in.';
  end if;

  select quantity_received, quantity_remaining
  into v_open_received_after, v_open_remaining
  from public.inventory_batches
  where id = v_open_batch_id;

  if v_open_received_after <> v_open_received_before then
    raise exception 'Adjustment-in changed quantity_received. Before %, after %.',
      v_open_received_before,
      v_open_received_after;
  end if;

  if v_open_remaining <> 80 then
    raise exception 'Expected opening batch remaining quantity to be 80 after adjustment-in, got %.',
      v_open_remaining;
  end if;

  insert into i3_smoke_results (test_name, status, details)
  values ('adjustment_in', 'PASS', 'Existing batch increased while quantity_received stayed unchanged');

  insert into public.inventory_batches (
    item_id,
    batch_ref,
    batch_origin,
    received_date,
    expiry_date,
    quantity_received,
    quantity_remaining,
    notes,
    created_by
  )
  values (
    v_item_id,
    'I3-SMOKE-EXPIRED-' || v_suffix,
    'opening_balance',
    current_date - 10,
    current_date - 1,
    12,
    12,
    'Direct expired smoke-test batch to verify ordinary stock-out excludes expired stock',
    v_admin_user_id
  )
  returning id into v_expired_batch_id;

  insert into public.inventory_movements (
    movement_group_id,
    item_id,
    batch_id,
    movement_type,
    quantity,
    notes,
    created_by
  )
  values (
    gen_random_uuid(),
    v_item_id,
    v_expired_batch_id,
    'opening_balance',
    12,
    'Direct expired smoke-test movement for summary verification',
    v_admin_user_id
  );

  v_expired_exclusion_response := public.inventory_stock_out(
    v_item_id,
    1::numeric,
    'I3 smoke expired exclusion stock-out',
    'Ordinary stock-out must not touch expired batch'
  );

  if coalesce((v_expired_exclusion_response ->> 'ok')::boolean, false) is not true then
    raise exception 'Expired-exclusion stock-out RPC did not return ok=true.';
  end if;

  select quantity_remaining
  into v_expired_remaining
  from public.inventory_batches
  where id = v_expired_batch_id;

  if v_expired_remaining <> 12 then
    raise exception 'Ordinary stock-out touched expired stock. Expired remaining is %.',
      v_expired_remaining;
  end if;

  insert into i3_smoke_results (test_name, status, details)
  values ('expired_batch_exclusion', 'PASS', 'Ordinary stock-out left expired batch untouched');

  select usable_stock
  into v_current_usable
  from public.inventory_stock_summary
  where item_id = v_item_id;

  select count(*)
  into v_movements_before_zero
  from public.inventory_movements
  where item_id = v_item_id;

  v_zero_response := public.inventory_adjust_to_count(
    v_item_id,
    v_current_usable,
    'I3 smoke zero-delta count',
    null,
    null
  );

  select count(*)
  into v_movements_after_zero
  from public.inventory_movements
  where item_id = v_item_id;

  if coalesce((v_zero_response ->> 'ok')::boolean, false) is not true
     or v_zero_response #>> '{details,result}' <> 'no_change'
     or v_zero_response ->> 'movement_group_id' is not null
     or v_movements_after_zero <> v_movements_before_zero then
    raise exception 'Zero-delta adjustment did not behave as no_change without movement.';
  end if;

  insert into i3_smoke_results (test_name, status, details)
  values ('zero_delta', 'PASS', 'No movement inserted when physical count matched usable stock');

  select current_stock, usable_stock, expired_stock
  into v_summary_current, v_summary_usable, v_summary_expired
  from public.inventory_stock_summary
  where item_id = v_item_id;

  if v_summary_current <> 91 or v_summary_usable <> 79 or v_summary_expired <> 12 then
    raise exception 'Stock summary mismatch. current %, usable %, expired %.',
      v_summary_current,
      v_summary_usable,
      v_summary_expired;
  end if;

  insert into i3_smoke_results (test_name, status, details)
  values ('stock_summary', 'PASS', 'Summary reported current=91, usable=79, expired=12');

  begin
    update public.inventory_movements
    set notes = 'I3 smoke update should be blocked'
    where id = (
      select id
      from public.inventory_movements
      where item_id = v_item_id
      limit 1
    );

    raise exception 'Movement UPDATE was not blocked.';
  exception
    when others then
      if sqlerrm not ilike '%append-only%' then
        raise exception 'Movement UPDATE failed for an unexpected reason: %', sqlerrm;
      end if;
  end;

  begin
    delete from public.inventory_movements
    where id = (
      select id
      from public.inventory_movements
      where item_id = v_item_id
      limit 1
    );

    raise exception 'Movement DELETE was not blocked.';
  exception
    when others then
      if sqlerrm not ilike '%append-only%' then
        raise exception 'Movement DELETE failed for an unexpected reason: %', sqlerrm;
      end if;
  end;

  insert into i3_smoke_results (test_name, status, details)
  values ('movement_immutability', 'PASS', 'Update and delete were blocked by append-only trigger');

  if exists (
    select 1
    from public.inventory_items
    where id = v_item_id
      and name <> v_smoke_name
  ) then
    raise exception 'Unexpected smoke item mismatch.';
  end if;

  insert into i3_smoke_results (test_name, status, details)
  values ('rollback_safety', 'PASS', 'All smoke records are inside this transaction and will disappear after rollback');

  insert into i3_smoke_results (test_name, status, details)
  values ('PHASE_I3_SMOKE_TEST', 'PASS', 'All runtime checks completed; transaction will roll back');
end;
$$;

-- The ROLLBACK below removes the smoke category, unit, item, batches,
-- movements, and temp result table. To confirm manually after running the whole
-- file, search for names beginning with "CURV I3 Smoke Test"; none should exist.

select
  test_name,
  status,
  details
from i3_smoke_results
order by sort_order;

rollback;
