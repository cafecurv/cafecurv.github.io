-- CURV Menu Manager Phase M-P2C.1 verification
--
-- Run manually in Supabase SQL Editor only after reviewing and applying:
-- admin/MENU_MANAGER_PHASE_M_P2C1_PRODUCT_SIZE_RECONCILIATION.sql
--
-- This verification creates temporary rows and ends with ROLLBACK. It requires
-- one existing CURV owner profile and one existing inventory item.

begin;

-- =========================================================
-- Structural checks
-- =========================================================

select
  p.oid::regprocedure::text as function_signature,
  p.prosecdef as security_definer,
  pg_get_function_result(p.oid) as return_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'menu_manager_reconcile_product_sizes';

select
  has_function_privilege('anon', 'public.menu_manager_reconcile_product_sizes(uuid, jsonb)', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.menu_manager_reconcile_product_sizes(uuid, jsonb)', 'EXECUTE') as authenticated_can_execute;

-- Expected:
-- - one security-definer jsonb function
-- - anon_can_execute = false
-- - authenticated_can_execute = true

-- =========================================================
-- Transactional behavior checks
-- =========================================================

do $$
declare
  v_owner_id uuid;
  v_inventory_item_id uuid;
  v_category_id uuid;
  v_product_id uuid;
  v_size_a_id uuid;
  v_size_b_id uuid;
  v_size_c_id uuid;
  v_recipe_id uuid;
  v_recipe_line_id uuid;
  v_original_ids uuid[];
  v_current_ids uuid[];
  v_result jsonb;
  v_public_size_count integer;
  v_recipe_removal_blocked boolean := false;
begin
  select ap.id
  into v_owner_id
  from public.admin_profiles ap
  where ap.role in ('owner', 'admin')
  order by ap.created_at nulls last, ap.id
  limit 1;

  if v_owner_id is null then
    raise exception 'M-P2C.1 verification needs an existing owner/admin profile.';
  end if;

  select ii.id
  into v_inventory_item_id
  from public.inventory_items ii
  order by ii.created_at, ii.id
  limit 1;

  if v_inventory_item_id is null then
    raise exception 'M-P2C.1 verification needs one existing inventory item for the temporary recipe line.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C1 Verify ' || gen_random_uuid()::text, 999999, true)
  returning id into v_category_id;

  insert into public.products (
    category_id,
    name,
    description,
    is_available,
    is_published,
    is_curv_pick,
    is_seasonal,
    sort_order,
    variant_group_name
  ) values (
    v_category_id,
    'M-P2C1 Verification Product',
    'Temporary verification row',
    true,
    true,
    false,
    false,
    0,
    'Size'
  )
  returning id into v_product_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_product_id, 'A', 100, 40, 0)
  returning id into v_size_a_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_product_id, 'B', 120, 50, 1)
  returning id into v_size_b_id;

  select array_agg(ps.id order by ps.id)
  into v_original_ids
  from public.product_sizes ps
  where ps.product_id = v_product_id;

  insert into public.inventory_recipes (
    product_size_id,
    notes,
    created_by,
    updated_by
  ) values (
    v_size_a_id,
    'M-P2C1 temporary recipe',
    v_owner_id,
    v_owner_id
  )
  returning id into v_recipe_id;

  insert into public.inventory_recipe_lines (
    recipe_id,
    inventory_item_id,
    quantity_required,
    sort_order,
    created_by,
    updated_by
  ) values (
    v_recipe_id,
    v_inventory_item_id,
    1,
    0,
    v_owner_id,
    v_owner_id
  )
  returning id into v_recipe_line_id;

  -- 1. Price edit keeps existing IDs.
  v_result := public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 0),
      jsonb_build_object('id', v_size_b_id, 'label', 'B', 'price', 120, 'cost', 50, 'sort_order', 1)
    )
  );

  if (select price from public.product_sizes where id = v_size_a_id) is distinct from 105 then
    raise exception 'Price-edit verification failed.';
  end if;

  -- 2. Label edit keeps the existing ID.
  perform public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 0),
      jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 1)
    )
  );

  if (select label from public.product_sizes where id = v_size_b_id) is distinct from 'B renamed' then
    raise exception 'Label-edit verification failed.';
  end if;

  -- 3-5. Metadata edit keeps IDs, recipe header, and recipe line.
  update public.products
  set description = 'Metadata changed without replacing sizes'
  where id = v_product_id;

  perform public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 0),
      jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 1)
    )
  );

  select array_agg(ps.id order by ps.id)
  into v_current_ids
  from public.product_sizes ps
  where ps.product_id = v_product_id;

  if v_current_ids is distinct from v_original_ids then
    raise exception 'Metadata-edit ID preservation failed.';
  end if;

  if not exists (select 1 from public.inventory_recipes where id = v_recipe_id and product_size_id = v_size_a_id) then
    raise exception 'Recipe header was not preserved.';
  end if;

  if not exists (select 1 from public.inventory_recipe_lines where id = v_recipe_line_id and recipe_id = v_recipe_id) then
    raise exception 'Recipe line was not preserved.';
  end if;

  -- 6. Adding C leaves A and B unchanged.
  v_result := public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 0),
      jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 1),
      jsonb_build_object('id', null, 'label', 'C', 'price', 140, 'cost', 60, 'sort_order', 2)
    )
  );

  select ps.id
  into v_size_c_id
  from public.product_sizes ps
  where ps.product_id = v_product_id
    and ps.label = 'C';

  if v_size_c_id is null
    or not exists (select 1 from public.product_sizes where id = v_size_a_id)
    or not exists (select 1 from public.product_sizes where id = v_size_b_id) then
    raise exception 'New-size verification failed.';
  end if;

  -- 7. Reordering updates sort_order without changing IDs.
  perform public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_c_id, 'label', 'C', 'price', 140, 'cost', 60, 'sort_order', 0),
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 1),
      jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 2)
    )
  );

  if (select sort_order from public.product_sizes where id = v_size_c_id) is distinct from 0
    or (select sort_order from public.product_sizes where id = v_size_a_id) is distinct from 1
    or (select sort_order from public.product_sizes where id = v_size_b_id) is distinct from 2 then
    raise exception 'Size reorder verification failed.';
  end if;

  -- 8-9. Removing recipe-backed A must fail and rollback every size change.
  begin
    perform public.menu_manager_reconcile_product_sizes(
      v_product_id,
      jsonb_build_array(
        jsonb_build_object('id', v_size_c_id, 'label', 'C changed before protected removal', 'price', 999, 'cost', 60, 'sort_order', 0),
        jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 1)
      )
    );
  exception when others then
    if sqlerrm like '%used by a recipe and cannot be removed yet%' then
      v_recipe_removal_blocked := true;
    else
      raise;
    end if;
  end;

  if not v_recipe_removal_blocked then
    raise exception 'Recipe-backed size removal was not blocked.';
  end if;

  if not exists (select 1 from public.product_sizes where id = v_size_a_id)
    or not exists (select 1 from public.inventory_recipes where id = v_recipe_id)
    or not exists (select 1 from public.inventory_recipe_lines where id = v_recipe_line_id) then
    raise exception 'Recipe protection rollback failed.';
  end if;

  if (select label from public.product_sizes where id = v_size_c_id) is distinct from 'C'
    or (select price from public.product_sizes where id = v_size_c_id) is distinct from 140 then
    raise exception 'Protected-removal transaction did not roll back other size changes.';
  end if;

  -- 10. Published unavailable products still expose size rows through M-P2A.
  update public.products
  set is_available = false
  where id = v_product_id;

  select count(*)
  into v_public_size_count
  from public.public_menu_product_sizes ps
  where ps.product_id = v_product_id;

  if v_public_size_count <> 3 then
    raise exception 'Public menu size verification failed. Expected 3 rows, found %.', v_public_size_count;
  end if;

  raise notice 'M-P2C.1 verification passed. Product %, sizes %, recipe %, line % remain transaction-local.',
    v_product_id,
    array[v_size_a_id, v_size_b_id, v_size_c_id],
    v_recipe_id,
    v_recipe_line_id;
end;
$$;

rollback;
