-- TEST ONLY
-- RUN THE ENTIRE FILE
-- DO NOT RUN INDIVIDUAL SECTIONS
-- THIS SCRIPT ENDS WITH ROLLBACK
--
-- CURV Inventory Management - Phase I5B Runtime Smoke Test Draft
--
-- Purpose:
-- Exercise public.inventory_create_item(...) in one rollback-safe transaction.
-- This script creates isolated smoke-test category and unit records, verifies
-- expected create-item behavior, and never commits.
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

create temp table i5b_smoke_results (
  sort_order integer generated always as identity,
  test_name text not null,
  status text not null,
  details text not null
) on commit drop;

create function pg_temp.i5b_expect_error(
  p_test_name text,
  p_expected_detail text,
  p_sql text
) returns void
language plpgsql
as $$
declare
  v_error_detail text;
begin
  begin
    execute p_sql;
    raise exception 'Expected % to fail with %.', p_test_name, p_expected_detail;
  exception
    when others then
      get stacked diagnostics v_error_detail = PG_EXCEPTION_DETAIL;
      if v_error_detail = p_expected_detail then
        insert into i5b_smoke_results (test_name, status, details)
        values (p_test_name, 'PASS', p_expected_detail || ' was raised');
      else
        raise exception 'Expected %, got % for %.', p_expected_detail, coalesce(v_error_detail, SQLERRM), p_test_name;
      end if;
  end;
end;
$$;

do $$
declare
  v_admin_user_id uuid := current_setting('request.jwt.claim.sub', true)::uuid;
  v_suffix text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_category_id uuid;
  v_inactive_category_id uuid;
  v_unit_id uuid;
  v_inactive_unit_id uuid;
  v_item_id uuid;
  v_response jsonb;
  v_item_name text := 'CURV I5B Smoke Item ' || v_suffix;
  v_row public.inventory_items%rowtype;
  v_summary_usable numeric;
  v_count integer;
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

  insert into public.inventory_categories (name, sort_order, is_active)
  values ('CURV I5B Smoke Test Category ' || v_suffix, 999101, true)
  returning id into v_category_id;

  insert into public.inventory_categories (name, sort_order, is_active)
  values ('CURV I5B Smoke Test Inactive Category ' || v_suffix, 999102, false)
  returning id into v_inactive_category_id;

  insert into public.inventory_units (name, abbreviation, sort_order, is_active)
  values ('curv i5b smoke test unit ' || lower(v_suffix), 'i5b-' || lower(substr(v_suffix, 1, 3)), 999101, true)
  returning id into v_unit_id;

  insert into public.inventory_units (name, abbreviation, sort_order, is_active)
  values ('curv i5b smoke test inactive unit ' || lower(v_suffix), 'i5x-' || lower(substr(v_suffix, 1, 3)), 999102, false)
  returning id into v_inactive_unit_id;

  insert into i5b_smoke_results (test_name, status, details)
  values ('setup', 'PASS', 'Created isolated category and unit records inside rollback transaction');

  v_response := public.inventory_create_item(
    '  ' || v_item_name || '  ',
    v_category_id,
    v_unit_id,
    null,
    null,
    '   '
  );

  if coalesce((v_response ->> 'ok')::boolean, false) is not true then
    raise exception 'Create item RPC did not return ok=true.';
  end if;

  v_item_id := (v_response ->> 'item_id')::uuid;

  insert into i5b_smoke_results (test_name, status, details)
  values ('successful_create', 'PASS', 'inventory_create_item returned ok=true and item_id');

  select *
  into v_row
  from public.inventory_items
  where id = v_item_id;

  if not found then
    raise exception 'Created inventory item row was not found.';
  end if;

  if v_row.name <> v_item_name then
    raise exception 'Trimmed name was not stored correctly.';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('trimmed_name', 'PASS', 'Outer whitespace was trimmed while preserving submitted casing');

  if v_row.is_active is not true then
    raise exception 'Created item is not active.';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('item_is_active', 'PASS', 'New item is active');

  if v_row.created_by is distinct from v_admin_user_id or v_row.updated_by is distinct from v_admin_user_id then
    raise exception 'created_by/updated_by did not match auth.uid().';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('audit_user_fields', 'PASS', 'created_by and updated_by equal auth.uid()');

  if v_row.notes is not null then
    raise exception 'notes should remain null.';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('notes_null', 'PASS', 'notes remains null');

  if v_row.low_stock_threshold <> 0.000 then
    raise exception 'Null threshold did not become 0.000.';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('null_threshold_zero', 'PASS', 'Null threshold became 0.000');

  if v_row.track_expiry is not false then
    raise exception 'Null track_expiry did not become false.';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('null_track_expiry_false', 'PASS', 'Null track_expiry became false');

  if v_row.storage_location is not null then
    raise exception 'Blank storage should become null.';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('blank_storage_null', 'PASS', 'Blank storage became null');

  perform pg_temp.i5b_expect_error(
    'duplicate_name_different_casing',
    'INV_DUPLICATE_ITEM_NAME',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid)',
      lower(v_item_name),
      v_category_id,
      v_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'duplicate_name_surrounding_whitespace',
    'INV_DUPLICATE_ITEM_NAME',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid)',
      '   ' || v_item_name || '   ',
      v_category_id,
      v_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'blank_name',
    'INV_NAME_REQUIRED',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid)',
      '   ',
      v_category_id,
      v_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'name_over_100_characters',
    'INV_NAME_TOO_LONG',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid)',
      repeat('A', 101),
      v_category_id,
      v_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'null_category',
    'INV_CATEGORY_REQUIRED',
    format(
      'select public.inventory_create_item(%L, null::uuid, %L::uuid)',
      'CURV I5B Null Category ' || v_suffix,
      v_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'missing_category',
    'INV_CATEGORY_NOT_FOUND',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid)',
      'CURV I5B Missing Category ' || v_suffix,
      gen_random_uuid(),
      v_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'inactive_category',
    'INV_CATEGORY_INACTIVE',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid)',
      'CURV I5B Inactive Category ' || v_suffix,
      v_inactive_category_id,
      v_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'null_unit',
    'INV_UNIT_REQUIRED',
    format(
      'select public.inventory_create_item(%L, %L::uuid, null::uuid)',
      'CURV I5B Null Unit ' || v_suffix,
      v_category_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'missing_unit',
    'INV_UNIT_NOT_FOUND',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid)',
      'CURV I5B Missing Unit ' || v_suffix,
      v_category_id,
      gen_random_uuid()
    )
  );

  perform pg_temp.i5b_expect_error(
    'inactive_unit',
    'INV_UNIT_INACTIVE',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid)',
      'CURV I5B Inactive Unit ' || v_suffix,
      v_category_id,
      v_inactive_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'negative_threshold',
    'INV_INVALID_THRESHOLD',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid, -0.001)',
      'CURV I5B Negative Threshold ' || v_suffix,
      v_category_id,
      v_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'threshold_more_than_three_decimals',
    'INV_THRESHOLD_SCALE',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid, 1.2345)',
      'CURV I5B Scale Threshold ' || v_suffix,
      v_category_id,
      v_unit_id
    )
  );

  perform pg_temp.i5b_expect_error(
    'storage_over_100_characters',
    'INV_STORAGE_TOO_LONG',
    format(
      'select public.inventory_create_item(%L, %L::uuid, %L::uuid, 0, false, %L)',
      'CURV I5B Long Storage ' || v_suffix,
      v_category_id,
      v_unit_id,
      repeat('S', 101)
    )
  );

  select count(*)
  into v_count
  from public.inventory_batches
  where item_id = v_item_id;

  if v_count <> 0 then
    raise exception 'Create item should not create inventory_batches rows.';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('no_inventory_batches', 'PASS', 'No inventory_batches row was created');

  select count(*)
  into v_count
  from public.inventory_movements
  where item_id = v_item_id;

  if v_count <> 0 then
    raise exception 'Create item should not create inventory_movements rows.';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('no_inventory_movements', 'PASS', 'No inventory_movements row was created');

  select usable_stock
  into v_summary_usable
  from public.inventory_stock_summary
  where item_id = v_item_id;

  if v_summary_usable is distinct from 0.000 then
    raise exception 'Created item did not appear in inventory_stock_summary with usable stock 0.';
  end if;

  insert into i5b_smoke_results (test_name, status, details)
  values ('stock_summary_zero', 'PASS', 'Created item appears in inventory_stock_summary with usable stock 0');
end;
$$;

select
  test_name,
  status,
  details
from i5b_smoke_results
union all
select
  'PHASE_I5B_SMOKE_TEST',
  'PASS',
  'All create-item checks completed; transaction will roll back';

rollback;
