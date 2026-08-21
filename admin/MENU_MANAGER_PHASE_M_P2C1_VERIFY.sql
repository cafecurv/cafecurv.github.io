-- CURV Menu Manager Phase M-P2C.1 verification
--
-- Run manually in Supabase SQL Editor only after reviewing and applying:
-- admin/MENU_MANAGER_PHASE_M_P2C1_PRODUCT_SIZE_RECONCILIATION.sql
--
-- This verification creates transaction-local menu/recipe fixtures and ends
-- with ROLLBACK. It does not use any production product or product-size id.
-- It requires one existing CURV owner and one existing inventory item because
-- recipe audit columns and recipe lines reference those durable records.

begin;

-- =========================================================
-- Structural and privilege checks
-- =========================================================

select
  p.oid::regprocedure::text as function_signature,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_function_result(p.oid) as return_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'menu_manager_reconcile_product_sizes';

select
  exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    where p.oid = 'public.menu_manager_reconcile_product_sizes(uuid, jsonb)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as public_can_execute,
  has_function_privilege('anon', 'public.menu_manager_reconcile_product_sizes(uuid, jsonb)', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.menu_manager_reconcile_product_sizes(uuid, jsonb)', 'EXECUTE') as authenticated_can_execute;

select
  con.conname,
  con.confdeltype,
  pg_get_constraintdef(con.oid) as constraint_definition
from pg_constraint con
where con.contype = 'f'
  and con.conrelid = 'public.inventory_recipes'::regclass
  and con.confrelid = 'public.product_sizes'::regclass;

-- Expected:
-- - exactly one (uuid, jsonb) security-definer function returning jsonb
-- - function_settings includes "search_path=public, pg_temp"
-- - public_can_execute = false
-- - anon_can_execute = false
-- - authenticated_can_execute = true
-- - inventory_recipes_product_size_fk uses ON DELETE CASCADE, which is why the
--   RPC must reject recipe-backed removal before issuing a delete

-- =========================================================
-- Transactional behavior checks
-- =========================================================

do $$
declare
  v_owner_id uuid;
  v_inventory_item_id uuid;
  v_category_id uuid;
  v_product_id uuid;
  v_single_product_id uuid;
  v_size_a_id uuid;
  v_size_b_id uuid;
  v_size_c_id uuid;
  v_single_size_id uuid;
  v_recipe_id uuid;
  v_recipe_line_id uuid;
  v_original_ids uuid[];
  v_current_ids uuid[];
  v_result jsonb;
  v_public_product_count integer;
  v_public_size_count integer;
  v_size_count integer;
  v_error_detail text;
  v_error_message text;
  v_auth_guard_passed boolean := false;
  v_admin_guard_passed boolean := false;
  v_recipe_removal_blocked boolean := false;
  v_duplicate_label_blocked boolean := false;
begin
  select ap.id
  into v_owner_id
  from public.admin_profiles ap
  where ap.role = 'owner'
  order by ap.created_at nulls last, ap.id
  limit 1;

  if v_owner_id is null then
    raise exception 'M-P2C.1 verification needs an existing owner profile.';
  end if;

  select ii.id
  into v_inventory_item_id
  from public.inventory_items ii
  order by ii.created_at, ii.id
  limit 1;

  if v_inventory_item_id is null then
    raise exception 'M-P2C.1 verification needs one existing inventory item for the temporary recipe line.';
  end if;

  -- Internal auth guard: direct invocation with no JWT subject must fail even
  -- when the SQL runner itself has database privileges.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.menu_manager_reconcile_product_sizes(gen_random_uuid(), '[]'::jsonb);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_auth_guard_passed := v_error_detail = 'MM_SIZE_AUTH_REQUIRED';
  end;

  if not v_auth_guard_passed then
    raise exception 'Anonymous/internal auth guard verification failed.';
  end if;

  -- Authenticated but unapproved subjects must fail the public.is_admin check.
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.menu_manager_reconcile_product_sizes(gen_random_uuid(), '[]'::jsonb);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_admin_guard_passed := v_error_detail = 'MM_SIZE_ADMIN_REQUIRED';
  end;

  if not v_admin_guard_passed then
    raise exception 'Owner/admin guard verification failed.';
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
    'Temporary multi-size verification row',
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

  -- 1. Price edit keeps A's exact ID.
  v_result := public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 0),
      jsonb_build_object('id', v_size_b_id, 'label', 'B', 'price', 120, 'cost', 50, 'sort_order', 1)
    )
  );

  if (select price from public.product_sizes where id = v_size_a_id) is distinct from 105
    or (v_result ->> 'updated_count')::integer <> 1
  then
    raise exception 'Price-edit ID preservation failed.';
  end if;

  -- 2. Label edit keeps B's exact ID.
  perform public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 0),
      jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 1)
    )
  );

  if (select label from public.product_sizes where id = v_size_b_id) is distinct from 'B renamed' then
    raise exception 'Label-edit ID preservation failed.';
  end if;

  -- 3. Reordering updates sort_order only and keeps both IDs.
  perform public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 0),
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 1)
    )
  );

  if (select sort_order from public.product_sizes where id = v_size_b_id) is distinct from 0
    or (select sort_order from public.product_sizes where id = v_size_a_id) is distinct from 1
  then
    raise exception 'Size-reorder ID preservation failed.';
  end if;

  -- 4. Metadata-only save does not recreate or mutate size rows.
  update public.products
  set description = 'Metadata changed without replacing sizes'
  where id = v_product_id;

  v_result := public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 0),
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 1)
    )
  );

  select array_agg(ps.id order by ps.id)
  into v_current_ids
  from public.product_sizes ps
  where ps.product_id = v_product_id;

  if v_current_ids is distinct from v_original_ids
    or (v_result ->> 'updated_count')::integer <> 0
    or (v_result ->> 'inserted_count')::integer <> 0
    or (v_result ->> 'deleted_count')::integer <> 0
  then
    raise exception 'Metadata-only size preservation failed.';
  end if;

  -- 5. Adding C preserves A and B and creates exactly one new UUID.
  v_result := public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 0),
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 1),
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
    or not exists (select 1 from public.product_sizes where id = v_size_b_id)
    or (v_result ->> 'inserted_count')::integer <> 1
  then
    raise exception 'New-size insertion or old-ID preservation failed.';
  end if;

  -- 6. Retrying the exact no-ID add payload adopts C instead of duplicating or
  -- replacing it. This covers a lost successful response/retry.
  v_result := public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_b_id, 'label', 'B renamed', 'price', 120, 'cost', 50, 'sort_order', 0),
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 1),
      jsonb_build_object('id', null, 'label', 'C', 'price', 140, 'cost', 60, 'sort_order', 2)
    )
  );

  select count(*)
  into v_size_count
  from public.product_sizes ps
  where ps.product_id = v_product_id;

  if v_size_count <> 3
    or not exists (select 1 from public.product_sizes where id = v_size_c_id)
    or (v_result ->> 'inserted_count')::integer <> 0
    or (v_result ->> 'deleted_count')::integer <> 0
  then
    raise exception 'Retry idempotence verification failed.';
  end if;

  -- 7. B has no protected dependency and can be removed atomically.
  v_result := public.menu_manager_reconcile_product_sizes(
    v_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 0),
      jsonb_build_object('id', v_size_c_id, 'label', 'C', 'price', 140, 'cost', 60, 'sort_order', 1)
    )
  );

  if exists (select 1 from public.product_sizes where id = v_size_b_id)
    or not exists (select 1 from public.product_sizes where id = v_size_a_id)
    or not exists (select 1 from public.product_sizes where id = v_size_c_id)
    or (v_result ->> 'deleted_count')::integer <> 1
  then
    raise exception 'Safe size-removal verification failed.';
  end if;

  -- 8. Omitting recipe-backed A must return the controlled detail code and
  -- roll back the attempted C edit plus every delete.
  begin
    perform public.menu_manager_reconcile_product_sizes(
      v_product_id,
      jsonb_build_array(
        jsonb_build_object('id', v_size_c_id, 'label', 'C changed before protected removal', 'price', 999, 'cost', 60, 'sort_order', 0)
      )
    );
  exception when others then
    get stacked diagnostics
      v_error_detail = pg_exception_detail,
      v_error_message = message_text;
    v_recipe_removal_blocked :=
      v_error_detail = 'MM_SIZE_RECIPE_PROTECTED'
      and v_error_message like '%used by a recipe and cannot be removed yet%';
  end;

  if not v_recipe_removal_blocked then
    raise exception 'Recipe-backed size removal did not return the controlled error.';
  end if;

  if not exists (select 1 from public.product_sizes where id = v_size_a_id)
    or not exists (select 1 from public.inventory_recipes where id = v_recipe_id and product_size_id = v_size_a_id)
    or not exists (select 1 from public.inventory_recipe_lines where id = v_recipe_line_id and recipe_id = v_recipe_id)
  then
    raise exception 'Recipe or recipe-line preservation failed.';
  end if;

  if (select label from public.product_sizes where id = v_size_c_id) is distinct from 'C'
    or (select price from public.product_sizes where id = v_size_c_id) is distinct from 140
    or (select count(*) from public.product_sizes where product_id = v_product_id) <> 2
  then
    raise exception 'Protected-removal transaction did not leave all sizes unchanged.';
  end if;

  -- 9. Duplicate logical labels are rejected without mutating live rows.
  begin
    perform public.menu_manager_reconcile_product_sizes(
      v_product_id,
      jsonb_build_array(
        jsonb_build_object('id', v_size_a_id, 'label', 'A', 'price', 105, 'cost', 40, 'sort_order', 0),
        jsonb_build_object('id', v_size_c_id, 'label', 'a', 'price', 140, 'cost', 60, 'sort_order', 1)
      )
    );
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_duplicate_label_blocked := v_error_detail = 'MM_SIZE_LABEL_DUPLICATE';
  end;

  if not v_duplicate_label_blocked
    or (select label from public.product_sizes where id = v_size_c_id) is distinct from 'C'
  then
    raise exception 'Duplicate-label validation failed.';
  end if;

  -- 10. A single-size product updates in place with the same UUID.
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
    'M-P2C1 Single-Size Verification Product',
    'Temporary single-size verification row',
    true,
    false,
    false,
    false,
    1,
    'Each'
  )
  returning id into v_single_product_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_single_product_id, 'Each', 80, null, 0)
  returning id into v_single_size_id;

  perform public.menu_manager_reconcile_product_sizes(
    v_single_product_id,
    jsonb_build_array(
      jsonb_build_object('id', v_single_size_id, 'label', 'Each', 'price', 85, 'cost', null, 'sort_order', 0)
    )
  );

  if (select price from public.product_sizes where id = v_single_size_id) is distinct from 85
    or (select count(*) from public.product_sizes where product_id = v_single_product_id) <> 1
  then
    raise exception 'Single-size reconciliation failed.';
  end if;

  -- 11. M-P2A contract: published unavailable products and their sizes remain
  -- visible in the customer-safe views.
  update public.products
  set is_available = false,
      is_published = true
  where id = v_product_id;

  select count(*)
  into v_public_product_count
  from public.public_menu_products p
  where p.id = v_product_id
    and p.is_available = false;

  select count(*)
  into v_public_size_count
  from public.public_menu_product_sizes ps
  where ps.product_id = v_product_id;

  if v_public_product_count <> 1 or v_public_size_count <> 2 then
    raise exception 'Published-unavailable public-view verification failed.';
  end if;

  -- 12. Unpublished products and their sizes remain excluded publicly.
  update public.products
  set is_published = false
  where id = v_product_id;

  select count(*)
  into v_public_product_count
  from public.public_menu_products p
  where p.id = v_product_id;

  select count(*)
  into v_public_size_count
  from public.public_menu_product_sizes ps
  where ps.product_id = v_product_id;

  if v_public_product_count <> 0 or v_public_size_count <> 0 then
    raise exception 'Unpublished public-view exclusion verification failed.';
  end if;

  raise notice 'M-P2C.1 verification passed. Multi product %, single product %, protected recipe %, and line % are transaction-local.',
    v_product_id,
    v_single_product_id,
    v_recipe_id,
    v_recipe_line_id;
end;
$$;

rollback;
