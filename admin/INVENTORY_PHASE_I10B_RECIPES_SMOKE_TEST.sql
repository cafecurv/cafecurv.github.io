-- RUN THE ENTIRE FILE TOGETHER.
-- DO NOT REMOVE THE FINAL ROLLBACK.
--
-- 8. Commented Manual RPC Smoke-Test Templates
-- =========================================================
-- These templates establish an authenticated owner context before invoking
-- RPCs, run inside one rollback-safe transaction, and use
-- pg_temp.i10b_expect_error() so expected failures do not abort the outer
-- transaction.
--
-- Never run only selected mutation snippets, because the setup/auth context
-- and rollback are part of the safety harness. The final ROLLBACK must remain
-- present. All smoke mutations are temporary and must not be committed.

begin;

create temp table i10b_smoke_context as
select
  (
    select ap.id
    from public.admin_profiles ap
    where ap.role = 'owner'
    order by ap.created_at, ap.id
    limit 1
  ) as owner_id,
  (
    select ps.id
    from public.product_sizes ps
    join public.products p on p.id = ps.product_id
    order by p.name, ps.sort_order, ps.label
    limit 1
  ) as product_size_id,
  (
    select ic.id
    from public.inventory_categories ic
    where ic.is_active = true
    order by ic.sort_order, ic.name, ic.id
    limit 1
  ) as category_id,
  (
    select iu.id
    from public.inventory_units iu
    where iu.is_active = true
    order by iu.sort_order, iu.name, iu.id
    limit 1
  ) as unit_id,
  to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || left(gen_random_uuid()::text, 8) as smoke_suffix,
  gen_random_uuid() as item_id_a,
  gen_random_uuid() as item_id_b,
  gen_random_uuid() as inactive_item_id;

do $$
declare
  v_context record;
begin
  select * into v_context from i10b_smoke_context;

  if v_context.owner_id is null then
    raise exception 'I10B smoke setup failed: no owner found in public.admin_profiles.';
  end if;
  if v_context.product_size_id is null then
    raise exception 'I10B smoke setup failed: no product_size row found.';
  end if;
  if v_context.category_id is null then
    raise exception 'I10B smoke setup failed: no active inventory category found.';
  end if;
  if v_context.unit_id is null then
    raise exception 'I10B smoke setup failed: no active inventory unit found.';
  end if;
  if v_context.item_id_a is null
    or v_context.item_id_b is null
    or v_context.inactive_item_id is null
  then
    raise exception 'I10B smoke setup failed: fixture IDs were not generated.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', owner_id::text, true)
from i10b_smoke_context;

select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', owner_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from i10b_smoke_context;

select
  auth.uid() as smoke_auth_uid,
  owner_id as expected_owner_id,
  auth.uid() = owner_id as auth_uid_matches_owner,
  public.is_admin() as smoke_is_admin
from i10b_smoke_context;

do $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id
  from i10b_smoke_context;

  if auth.uid() is distinct from v_owner_id then
    raise exception 'I10B smoke setup failed: auth.uid() does not match selected owner.';
  end if;

  if not public.is_admin() then
    raise exception 'I10B smoke setup failed: public.is_admin() returned false.';
  end if;
end;
$$;

-- Temporary inventory fixtures for this smoke test only. They are inserted
-- inside the rollback transaction, create no stock batches or movements, and
-- must never be committed.
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
  'CURV I10B Smoke Ingredient A ' || smoke_suffix,
  category_id,
  unit_id,
  0,
  false,
  'Smoke Test Only',
  'Temporary I10B smoke-test fixture. Rolled back at end of file.',
  true,
  owner_id,
  owner_id
from i10b_smoke_context
union all
select
  item_id_b,
  'CURV I10B Smoke Ingredient B ' || smoke_suffix,
  category_id,
  unit_id,
  0,
  false,
  'Smoke Test Only',
  'Temporary I10B smoke-test fixture. Rolled back at end of file.',
  true,
  owner_id,
  owner_id
from i10b_smoke_context
union all
select
  inactive_item_id,
  'CURV I10B Smoke Inactive Ingredient ' || smoke_suffix,
  category_id,
  unit_id,
  0,
  false,
  'Smoke Test Only',
  'Temporary I10B smoke-test fixture. Rolled back at end of file.',
  false,
  owner_id,
  owner_id
from i10b_smoke_context;

create or replace function pg_temp.i10b_expect_error(
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
      if v_detail = p_expected_detail then
        raise notice 'PASS % -> %', p_test_name, v_detail;
        return;
      end if;

      raise exception 'FAIL % expected detail %, got %',
        p_test_name,
        p_expected_detail,
        coalesce(v_detail, '<null>');
  end;

  raise exception 'FAIL % expected detail %, but SQL succeeded',
    p_test_name,
    p_expected_detail;
end;
$$;

-- ---------------------------------------------------------
-- Valid recipe with multiple ingredients
-- ---------------------------------------------------------
select public.inventory_replace_recipe(
  product_size_id,
  jsonb_build_array(
    jsonb_build_object('inventory_item_id', item_id_a, 'quantity_required', '1.250', 'sort_order', 0),
    jsonb_build_object('inventory_item_id', item_id_b, 'quantity_required', '0.500', 'sort_order', 1)
  ),
  'Rollback smoke test recipe.'
)
from i10b_smoke_context;

select * from public.inventory_recipe_summary
where recipe_id is not null
order by recipe_updated_at desc
limit 5;

-- ---------------------------------------------------------
-- Expected failure cases that keep the outer transaction usable
-- ---------------------------------------------------------
select pg_temp.i10b_expect_error(
  'duplicate ingredient',
  'INV_RECIPE_DUPLICATE_ITEM',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', 0),
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '2', 'sort_order', 1)
    ), null)$sql$,
    product_size_id,
    item_id_a::text,
    item_id_a::text
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'inactive ingredient',
  'INV_RECIPE_ITEM_INACTIVE',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', 0)
    ), null)$sql$,
    product_size_id,
    inactive_item_id::text
  )
)
from i10b_smoke_context
where inactive_item_id is not null;

select pg_temp.i10b_expect_error(
  'nonexistent ingredient',
  'INV_RECIPE_ITEM_NOT_FOUND',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', '00000000-0000-0000-0000-000000000000', 'quantity_required', '1')
    ), null)$sql$,
    product_size_id
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'zero quantity',
  'INV_RECIPE_INVALID_QUANTITY',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '0')
    ), null)$sql$,
    product_size_id,
    item_id_a::text
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'negative quantity',
  'INV_RECIPE_INVALID_QUANTITY',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '-1')
    ), null)$sql$,
    product_size_id,
    item_id_a::text
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'four decimal quantity',
  'INV_RECIPE_QUANTITY_SCALE',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1.2345')
    ), null)$sql$,
    product_size_id,
    item_id_a::text
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'scientific notation quantity',
  'INV_RECIPE_INVALID_QUANTITY',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1e-4')
    ), null)$sql$,
    product_size_id,
    item_id_a::text
  )
)
from i10b_smoke_context;

select public.inventory_replace_recipe(
  product_size_id,
  jsonb_build_array(
    jsonb_build_object('inventory_item_id', item_id_a, 'quantity_required', '99999999999.999')
  ),
  'Rollback maximum quantity smoke test.'
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'quantity overflow',
  'INV_RECIPE_INVALID_QUANTITY',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '100000000000.000')
    ), null)$sql$,
    product_size_id,
    item_id_a::text
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'extremely long quantity',
  'INV_RECIPE_INVALID_QUANTITY',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', %L)
    ), null)$sql$,
    product_size_id,
    item_id_a::text,
    repeat('9', 200)
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'invalid decimal sort order',
  'INV_RECIPE_INVALID_SORT_ORDER',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', '1.5')
    ), null)$sql$,
    product_size_id,
    item_id_a::text
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'sort order overflow',
  'INV_RECIPE_INVALID_SORT_ORDER',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', '2147483648')
    ), null)$sql$,
    product_size_id,
    item_id_a::text
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'empty lines',
  'INV_RECIPE_LINES_REQUIRED',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, '[]'::jsonb, null)$sql$,
    product_size_id
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'more than 100 lines',
  'INV_RECIPE_TOO_MANY_LINES',
  format(
    $sql$select public.inventory_replace_recipe(
      %L::uuid,
      (
        select jsonb_agg(jsonb_build_object(
          'inventory_item_id', gen_random_uuid(),
          'quantity_required', '1',
          'sort_order', n
        ))
        from generate_series(1, 101) as n
      ),
      null
    )$sql$,
    product_size_id
  )
)
from i10b_smoke_context;

select pg_temp.i10b_expect_error(
  'notes over 500 characters',
  'INV_RECIPE_NOTES_TOO_LONG',
  format(
    $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
      jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')
    ), %L)$sql$,
    product_size_id,
    item_id_a::text,
    repeat('x', 501)
  )
)
from i10b_smoke_context;

-- ---------------------------------------------------------
-- Atomic replacement behavior
-- ---------------------------------------------------------
do $$
declare
  v_context record;
  v_recipe_id uuid;
  v_notes text;
  v_line_count integer;
  v_item_a_quantity numeric;
  v_item_b_quantity numeric;
begin
  select * into v_context from i10b_smoke_context;

  perform public.inventory_replace_recipe(
    v_context.product_size_id,
    jsonb_build_array(
      jsonb_build_object('inventory_item_id', v_context.item_id_a, 'quantity_required', '1.000', 'sort_order', 0),
      jsonb_build_object('inventory_item_id', v_context.item_id_b, 'quantity_required', '2.000', 'sort_order', 1)
    ),
    'Atomic test original.'
  );

  perform pg_temp.i10b_expect_error(
    'atomic invalid replacement',
    'INV_RECIPE_QUANTITY_SCALE',
    format(
      $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
        jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1.2345')
      ), 'Atomic test invalid replacement.')$sql$,
      v_context.product_size_id,
      v_context.item_id_a::text
    )
  );

  select
    r.id,
    r.notes,
    count(rl.id)::integer,
    max(rl.quantity_required) filter (where rl.inventory_item_id = v_context.item_id_a),
    max(rl.quantity_required) filter (where rl.inventory_item_id = v_context.item_id_b)
  into
    v_recipe_id,
    v_notes,
    v_line_count,
    v_item_a_quantity,
    v_item_b_quantity
  from public.inventory_recipes r
  join public.inventory_recipe_lines rl on rl.recipe_id = r.id
  where r.product_size_id = v_context.product_size_id
  group by r.id, r.notes;

  if v_recipe_id is null
    or v_notes <> 'Atomic test original.'
    or v_line_count <> 2
    or v_item_a_quantity <> 1.000
    or v_item_b_quantity <> 2.000
  then
    raise exception 'FAIL atomic replacement did not preserve the prior valid recipe.';
  end if;

  raise notice 'PASS atomic replacement preserved prior recipe %', v_recipe_id;
end;
$$;

-- ---------------------------------------------------------
-- Recipe deletion
-- ---------------------------------------------------------
do $$
declare
  v_context record;
  v_recipe_id uuid;
  v_product_still_exists boolean;
  v_item_still_exists boolean;
  v_recipe_still_exists boolean;
  v_lines_still_exist boolean;
begin
  select * into v_context from i10b_smoke_context;

  select r.id into v_recipe_id
  from public.inventory_recipes r
  where r.product_size_id = v_context.product_size_id;

  perform public.inventory_delete_recipe(v_context.product_size_id);

  select exists (
    select 1 from public.product_sizes where id = v_context.product_size_id
  ) into v_product_still_exists;

  select exists (
    select 1 from public.inventory_items where id = v_context.item_id_a
  ) into v_item_still_exists;

  select exists (
    select 1 from public.inventory_recipes where product_size_id = v_context.product_size_id
  ) into v_recipe_still_exists;

  select exists (
    select 1 from public.inventory_recipe_lines where recipe_id = v_recipe_id
  ) into v_lines_still_exist;

  if not v_product_still_exists
    or not v_item_still_exists
    or v_recipe_still_exists
    or v_lines_still_exist
  then
    raise exception 'FAIL delete recipe affected the wrong records.';
  end if;

  raise notice 'PASS delete recipe removed only recipe configuration.';
end;
$$;

-- ---------------------------------------------------------
-- Non-admin access expectations
-- ---------------------------------------------------------
-- Optional: use a reviewed non-admin authenticated UUID in local/test only.
-- The UUID must not exist in public.admin_profiles.
-- select set_config('request.jwt.claim.sub', '<non_admin_user_id>', true);
-- select set_config('request.jwt.claim.role', 'authenticated', true);
-- select set_config(
--   'request.jwt.claims',
--   json_build_object('sub', '<non_admin_user_id>', 'role', 'authenticated')::text,
--   true
-- );
-- select auth.uid(), public.is_admin();
-- select pg_temp.i10b_expect_error(
--   'non-admin replace recipe',
--   'INV_ADMIN_REQUIRED',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, '[]'::jsonb, null)$sql$,
--     (select product_size_id from i10b_smoke_context)
--   )
-- );

rollback;
