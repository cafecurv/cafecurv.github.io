-- CURV Control Inventory Management
-- Phase I10D.1 Recipe Mutation Optimistic-Concurrency Smoke Test
--
-- RUN THE ENTIRE FILE TOGETHER.
-- DO NOT RUN SELECTED MUTATION SNIPPETS.
-- DO NOT REMOVE THE FINAL ROLLBACK.
--
-- This file is a manual, rollback-only smoke test draft. It creates isolated
-- temporary menu, product-size, and inventory fixtures inside one transaction,
-- exercises the recipe RPCs, and rolls everything back.
--
-- Before running manually, replace the all-zero owner_id below with an existing
-- public.admin_profiles.id whose role is owner.

begin;

-- =========================================================
-- 0. Rollback-Only Fixture And Auth Setup
-- =========================================================

create temp table i10d1_smoke_context as
select
  'b44bb85d-f0ea-4ba0-afe1-ad3d469ee083'::uuid as owner_id,
  (
    select c.id
    from public.categories c
    order by c.sort_order, c.name, c.id
    limit 1
  ) as menu_category_id,
  (
    select ic.id
    from public.inventory_categories ic
    where ic.is_active = true
    order by ic.sort_order, ic.name, ic.id
    limit 1
  ) as inventory_category_id,
  (
    select iu.id
    from public.inventory_units iu
    where iu.is_active = true
    order by iu.sort_order, iu.name, iu.id
    limit 1
  ) as inventory_unit_id,
  to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || left(gen_random_uuid()::text, 8) as smoke_suffix,
  gen_random_uuid() as product_id,
  gen_random_uuid() as product_size_id,
  gen_random_uuid() as item_id_a,
  gen_random_uuid() as item_id_b,
  gen_random_uuid() as inactive_item_id;

do $$
declare
  v_context record;
begin
  select * into v_context from i10d1_smoke_context;

  if not exists (
    select 1
    from public.admin_profiles ap
    where ap.id = v_context.owner_id
      and ap.role = 'owner'
  ) then
    raise exception 'I10D1 smoke setup failed: replace the owner_id placeholder with an existing owner admin_profiles.id.';
  end if;

  if v_context.menu_category_id is null then
    raise exception 'I10D1 smoke setup failed: no public.categories row found for temporary product fixture.';
  end if;

  if v_context.inventory_category_id is null then
    raise exception 'I10D1 smoke setup failed: no active inventory category found.';
  end if;

  if v_context.inventory_unit_id is null then
    raise exception 'I10D1 smoke setup failed: no active inventory unit found.';
  end if;

  if v_context.product_id is null
    or v_context.product_size_id is null
    or v_context.item_id_a is null
    or v_context.item_id_b is null
    or v_context.inactive_item_id is null
  then
    raise exception 'I10D1 smoke setup failed: fixture IDs were not generated.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', owner_id::text, true)
from i10d1_smoke_context;

select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', owner_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from i10d1_smoke_context;

do $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id
  from i10d1_smoke_context;

  if auth.uid() is distinct from v_owner_id then
    raise exception 'I10D1 smoke setup failed: auth.uid() does not match selected owner.';
  end if;

  if not public.is_admin() then
    raise exception 'I10D1 smoke setup failed: public.is_admin() returned false.';
  end if;
end;
$$;

select
  auth.uid() as smoke_auth_uid,
  owner_id as expected_owner_id,
  auth.uid() = owner_id as auth_uid_matches_owner,
  public.is_admin() as smoke_is_admin
from i10d1_smoke_context;

-- Temporary fixtures for this smoke test only. They are rollback-only and
-- must never be committed.

insert into public.products (
  id,
  category_id,
  name,
  description,
  is_available,
  is_published,
  is_curv_pick,
  is_seasonal,
  sort_order,
  notes,
  variant_group_name
)
select
  product_id,
  menu_category_id,
  'CURV I10D1 Smoke Product ' || smoke_suffix,
  'Temporary rollback-only recipe concurrency smoke fixture.',
  false,
  false,
  false,
  false,
  999999,
  'Temporary I10D1 smoke-test fixture. Rolled back at end of file.',
  'Smoke Test'
from i10d1_smoke_context;

insert into public.product_sizes (
  id,
  product_id,
  label,
  price,
  sort_order,
  cost
)
select
  product_size_id,
  product_id,
  'Smoke Size',
  0,
  0,
  null
from i10d1_smoke_context;

insert into public.inventory_items (
  id,
  name,
  category_id,
  unit_id,
  low_stock_threshold,
  track_expiry,
  storage_location,
  notes,
  is_active,
  created_by,
  updated_by
)
select
  item_id_a,
  'CURV I10D1 Smoke Ingredient A ' || smoke_suffix,
  inventory_category_id,
  inventory_unit_id,
  0,
  false,
  'Smoke Test Only',
  'Temporary I10D1 smoke-test fixture. Rolled back at end of file.',
  true,
  owner_id,
  owner_id
from i10d1_smoke_context
union all
select
  item_id_b,
  'CURV I10D1 Smoke Ingredient B ' || smoke_suffix,
  inventory_category_id,
  inventory_unit_id,
  0,
  false,
  'Smoke Test Only',
  'Temporary I10D1 smoke-test fixture. Rolled back at end of file.',
  true,
  owner_id,
  owner_id
from i10d1_smoke_context
union all
select
  inactive_item_id,
  'CURV I10D1 Smoke Inactive Ingredient ' || smoke_suffix,
  inventory_category_id,
  inventory_unit_id,
  0,
  false,
  'Smoke Test Only',
  'Temporary I10D1 smoke-test fixture. Rolled back at end of file.',
  false,
  owner_id,
  owner_id
from i10d1_smoke_context;

create temp table i10d1_recipe_state (
  recipe_id uuid,
  updated_at timestamptz,
  previous_updated_at timestamptz,
  deleted_recipe_id uuid,
  deleted_updated_at timestamptz,
  recreated_recipe_id uuid,
  recreated_updated_at timestamptz
) on commit drop;

insert into i10d1_recipe_state default values;

create or replace function pg_temp.i10d1_expect_error(
  p_test_name text,
  p_expected_detail text,
  p_sql text
) returns void
language plpgsql
as $$
declare
  v_detail text;
begin
  begin
    execute p_sql;
  exception
    when others then
      get stacked diagnostics v_detail = PG_EXCEPTION_DETAIL;

      if v_detail is distinct from p_expected_detail then
        raise exception 'I10D1 smoke failed for %. Expected detail %, got %.',
          p_test_name,
          p_expected_detail,
          coalesce(v_detail, '<null>');
      end if;

      raise notice 'I10D1 smoke expected error passed: % -> %',
        p_test_name,
        p_expected_detail;
      return;
  end;

  raise exception 'I10D1 smoke failed for %. Expected error detail %, but the statement succeeded.',
    p_test_name,
    p_expected_detail;
end;
$$;

-- =========================================================
-- 1. Create With Null/Null Expectation Succeeds
-- =========================================================

do $$
declare
  v_context record;
  v_result jsonb;
begin
  select * into v_context from i10d1_smoke_context;

  v_result := public.inventory_replace_recipe(
    v_context.product_size_id,
    jsonb_build_array(
      jsonb_build_object(
        'inventory_item_id', v_context.item_id_a,
        'quantity_required', '1.250',
        'sort_order', 0
      ),
      jsonb_build_object(
        'inventory_item_id', v_context.item_id_b,
        'quantity_required', '2',
        'sort_order', 1
      )
    ),
    'I10D1 smoke create',
    null,
    null
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
    or v_result ->> 'operation' <> 'replace_recipe'
    or (v_result ->> 'ingredient_count')::integer <> 2
  then
    raise exception 'I10D1 smoke case 1 failed: unexpected create result %', v_result;
  end if;

  update i10d1_recipe_state
  set
    recipe_id = (v_result ->> 'recipe_id')::uuid,
    updated_at = (v_result ->> 'updated_at')::timestamptz;

  raise notice 'I10D1 smoke case 1 passed.';
end;
$$;

-- =========================================================
-- 2. Create With Null/Null Expectation Conflicts When Recipe Exists
-- =========================================================

select pg_temp.i10d1_expect_error(
  'case 2 create expectation conflict',
  'INV_RECIPE_CONFLICT',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')),
      'I10D1 smoke create conflict',
      null,
      null
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text
  )
)
from i10d1_smoke_context c;

-- =========================================================
-- 3-4. Edit With Matching Token Succeeds And Returns A New Token
-- =========================================================

do $$
declare
  v_context record;
  v_state record;
  v_result jsonb;
  v_new_updated_at timestamptz;
begin
  select * into v_context from i10d1_smoke_context;
  select * into v_state from i10d1_recipe_state;

  v_result := public.inventory_replace_recipe(
    v_context.product_size_id,
    jsonb_build_array(
      jsonb_build_object(
        'inventory_item_id', v_context.item_id_a,
        'quantity_required', '1.500',
        'sort_order', 0
      )
    ),
    'I10D1 smoke edit',
    v_state.recipe_id,
    v_state.updated_at
  );

  v_new_updated_at := (v_result ->> 'updated_at')::timestamptz;

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
    or v_result ->> 'operation' <> 'replace_recipe'
    or (v_result ->> 'recipe_id')::uuid is distinct from v_state.recipe_id
    or v_new_updated_at is not distinct from v_state.updated_at
  then
    raise exception 'I10D1 smoke cases 3-4 failed: unexpected edit result %, old token %',
      v_result,
      v_state.updated_at;
  end if;

  update i10d1_recipe_state
  set
    previous_updated_at = v_state.updated_at,
    updated_at = v_new_updated_at;

  raise notice 'I10D1 smoke cases 3-4 passed.';
end;
$$;

-- =========================================================
-- 5. Edit With Stale Updated_At Conflicts
-- =========================================================

select pg_temp.i10d1_expect_error(
  'case 5 stale edit token',
  'INV_RECIPE_CONFLICT',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')),
      'I10D1 smoke stale edit',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.recipe_id::text,
    s.previous_updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

-- =========================================================
-- 7-8. Partial Expectation Tokens Are Invalid
-- =========================================================

select pg_temp.i10d1_expect_error(
  'case 7 partial token recipe id only',
  'INV_RECIPE_EXPECTATION_INVALID',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')),
      'I10D1 smoke partial token',
      %L::uuid,
      null
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.recipe_id::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 8 partial token updated_at only',
  'INV_RECIPE_EXPECTATION_INVALID',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')),
      'I10D1 smoke partial token',
      null,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

-- =========================================================
-- 9. Delete With Stale Updated_At Conflicts
-- =========================================================

select pg_temp.i10d1_expect_error(
  'case 9 stale delete token',
  'INV_RECIPE_CONFLICT',
  format(
    $sql$select public.inventory_delete_recipe(%L::uuid, %L::uuid, %L::timestamptz)$sql$,
    c.product_size_id::text,
    s.recipe_id::text,
    s.previous_updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 9b delete existing recipe without token',
  'INV_RECIPE_EXPECTATION_REQUIRED',
  format(
    $sql$select public.inventory_delete_recipe(%L::uuid)$sql$,
    c.product_size_id::text
  )
)
from i10d1_smoke_context c;

-- =========================================================
-- 10. Delete With Matching Token Succeeds
-- =========================================================

do $$
declare
  v_context record;
  v_state record;
  v_result jsonb;
begin
  select * into v_context from i10d1_smoke_context;
  select * into v_state from i10d1_recipe_state;

  v_result := public.inventory_delete_recipe(
    v_context.product_size_id,
    v_state.recipe_id,
    v_state.updated_at
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
    or v_result ->> 'operation' <> 'delete_recipe'
    or coalesce((v_result ->> 'deleted')::boolean, false) is not true
    or (v_result ->> 'recipe_id')::uuid is distinct from v_state.recipe_id
  then
    raise exception 'I10D1 smoke case 10 failed: unexpected delete result %', v_result;
  end if;

  update i10d1_recipe_state
  set
    deleted_recipe_id = v_state.recipe_id,
    deleted_updated_at = v_state.updated_at,
    recipe_id = null,
    updated_at = null,
    previous_updated_at = null;

  raise notice 'I10D1 smoke case 10 passed.';
end;
$$;

-- =========================================================
-- 11. Delete Missing Recipe Returns Deleted False
-- =========================================================

do $$
declare
  v_context record;
  v_result jsonb;
begin
  select * into v_context from i10d1_smoke_context;

  v_result := public.inventory_delete_recipe(v_context.product_size_id);

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
    or v_result ->> 'operation' <> 'delete_recipe'
    or coalesce((v_result ->> 'deleted')::boolean, true) is not false
    or v_result ->> 'recipe_id' is not null
  then
    raise exception 'I10D1 smoke case 11 failed: unexpected missing-delete result %', v_result;
  end if;

  raise notice 'I10D1 smoke case 11 passed.';
end;
$$;

-- =========================================================
-- 6. Edit With Token After Delete Conflicts Because Recipe Is Missing
-- =========================================================

select pg_temp.i10d1_expect_error(
  'case 6 edit token after delete',
  'INV_RECIPE_CONFLICT',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')),
      'I10D1 smoke edit after delete',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.deleted_recipe_id::text,
    s.deleted_updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

-- =========================================================
-- 12. Create After Delete Succeeds With Null/Null Expectation
-- =========================================================

do $$
declare
  v_context record;
  v_state record;
  v_result jsonb;
begin
  select * into v_context from i10d1_smoke_context;
  select * into v_state from i10d1_recipe_state;

  v_result := public.inventory_replace_recipe(
    v_context.product_size_id,
    jsonb_build_array(
      jsonb_build_object(
        'inventory_item_id', v_context.item_id_a,
        'quantity_required', '1',
        'sort_order', 0
      )
    ),
    'I10D1 smoke recreate',
    null,
    null
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
    or (v_result ->> 'recipe_id')::uuid is not distinct from v_state.deleted_recipe_id
  then
    raise exception 'I10D1 smoke case 12 failed: unexpected recreate result %', v_result;
  end if;

  update i10d1_recipe_state
  set
    recipe_id = (v_result ->> 'recipe_id')::uuid,
    updated_at = (v_result ->> 'updated_at')::timestamptz,
    recreated_recipe_id = (v_result ->> 'recipe_id')::uuid,
    recreated_updated_at = (v_result ->> 'updated_at')::timestamptz;

  raise notice 'I10D1 smoke case 12 passed.';
end;
$$;

-- =========================================================
-- 13-14. Old Deleted Tokens Cannot Affect Recreated Recipe
-- =========================================================

select pg_temp.i10d1_expect_error(
  'case 13 old deleted edit token on recreated recipe',
  'INV_RECIPE_CONFLICT',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')),
      'I10D1 smoke old deleted edit token',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.deleted_recipe_id::text,
    s.deleted_updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 14 old deleted delete token on recreated recipe',
  'INV_RECIPE_CONFLICT',
  format(
    $sql$select public.inventory_delete_recipe(%L::uuid, %L::uuid, %L::timestamptz)$sql$,
    c.product_size_id::text,
    s.deleted_recipe_id::text,
    s.deleted_updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

-- =========================================================
-- 15. I10B Validation Errors Still Map To Approved Codes
-- =========================================================

select pg_temp.i10d1_expect_error(
  'case 15 duplicate ingredient',
  'INV_RECIPE_DUPLICATE_ITEM',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(
        jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', 0),
        jsonb_build_object('inventory_item_id', %L, 'quantity_required', '2', 'sort_order', 1)
      ),
      'I10D1 smoke duplicate ingredient',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    c.item_id_a::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 15 inactive ingredient',
  'INV_RECIPE_ITEM_INACTIVE',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')),
      'I10D1 smoke inactive ingredient',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.inactive_item_id::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 15 zero quantity',
  'INV_RECIPE_INVALID_QUANTITY',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '0')),
      'I10D1 smoke zero quantity',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 15 quantity scale',
  'INV_RECIPE_QUANTITY_SCALE',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1.2345')),
      'I10D1 smoke quantity scale',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 15 quantity overflow',
  'INV_RECIPE_INVALID_QUANTITY',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '100000000000.000')),
      'I10D1 smoke quantity overflow',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 15 invalid sort order',
  'INV_RECIPE_INVALID_SORT_ORDER',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', '1.5')),
      'I10D1 smoke invalid sort order',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 15 sort order overflow',
  'INV_RECIPE_INVALID_SORT_ORDER',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', '2147483648')),
      'I10D1 smoke sort order overflow',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 15 empty lines',
  'INV_RECIPE_LINES_REQUIRED',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, '[]'::jsonb, null, %L::uuid, %L::timestamptz)$sql$,
    c.product_size_id::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 15 too many lines',
  'INV_RECIPE_TOO_MANY_LINES',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      (
        select jsonb_agg(
          jsonb_build_object(
            'inventory_item_id', %L,
            'quantity_required', '1',
            'sort_order', line_number
          )
        )
        from generate_series(1, 101) as line_number
      ),
      'I10D1 smoke too many lines',
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

select pg_temp.i10d1_expect_error(
  'case 15 notes too long',
  'INV_RECIPE_NOTES_TOO_LONG',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')),
      repeat('x', 501),
      %L::uuid,
      %L::timestamptz
    )$sql$,
    c.product_size_id::text,
    c.item_id_a::text,
    s.recipe_id::text,
    s.updated_at::text
  )
)
from i10d1_smoke_context c
cross join i10d1_recipe_state s;

-- =========================================================
-- 16. Invalid Replacement Remains Atomic
-- =========================================================

do $$
declare
  v_context record;
  v_state record;
  v_result jsonb;
  v_line_count integer;
  v_quantity numeric;
  v_notes text;
begin
  select * into v_context from i10d1_smoke_context;
  select * into v_state from i10d1_recipe_state;

  v_result := public.inventory_replace_recipe(
    v_context.product_size_id,
    jsonb_build_array(
      jsonb_build_object(
        'inventory_item_id', v_context.item_id_a,
        'quantity_required', '4',
        'sort_order', 0
      )
    ),
    'I10D1 smoke atomic baseline',
    v_state.recipe_id,
    v_state.updated_at
  );

  update i10d1_recipe_state
  set
    recipe_id = (v_result ->> 'recipe_id')::uuid,
    updated_at = (v_result ->> 'updated_at')::timestamptz;

  select * into v_state from i10d1_recipe_state;

  perform pg_temp.i10d1_expect_error(
    'case 16 invalid replacement rollback',
    'INV_RECIPE_DUPLICATE_ITEM',
    format(
      $sql$select public.inventory_replace_recipe(
        %L::uuid,
        jsonb_build_array(
          jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', 0),
          jsonb_build_object('inventory_item_id', %L, 'quantity_required', '2', 'sort_order', 1)
        ),
        'I10D1 smoke invalid replacement should not persist',
        %L::uuid,
        %L::timestamptz
      )$sql$,
      v_context.product_size_id::text,
      v_context.item_id_a::text,
      v_context.item_id_a::text,
      v_state.recipe_id::text,
      v_state.updated_at::text
    )
  );

  select
    count(*)::integer,
    max(rl.quantity_required),
    max(r.notes)
  into
    v_line_count,
    v_quantity,
    v_notes
  from public.inventory_recipes r
  join public.inventory_recipe_lines rl on rl.recipe_id = r.id
  where r.product_size_id = v_context.product_size_id
  group by r.id;

  if v_line_count <> 1
    or v_quantity <> 4
    or v_notes <> 'I10D1 smoke atomic baseline'
  then
    raise exception 'I10D1 smoke case 16 failed: invalid replacement changed persisted recipe. line_count %, quantity %, notes %',
      v_line_count,
      v_quantity,
      v_notes;
  end if;

  raise notice 'I10D1 smoke case 16 passed.';
end;
$$;

-- =========================================================
-- Optional Non-Admin Test Template
-- =========================================================
-- Keep this commented unless you intentionally paste a known authenticated
-- non-admin user ID. Run only inside this same BEGIN/ROLLBACK harness.
--
-- select set_config('request.jwt.claim.sub', '<non_admin_user_id>', true);
-- select set_config('request.jwt.claim.role', 'authenticated', true);
-- select set_config(
--   'request.jwt.claims',
--   json_build_object('sub', '<non_admin_user_id>', 'role', 'authenticated')::text,
--   true
-- );
--
-- select pg_temp.i10d1_expect_error(
--   'optional non-admin replace rejection',
--   'INV_ADMIN_REQUIRED',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, '[]'::jsonb, null, null, null)$sql$,
--     (select product_size_id from i10d1_smoke_context)::text
--   )
-- );

rollback;
