-- CURV Menu Manager Phase M-P2C.2 verification
--
-- Run manually in Supabase SQL Editor only after reviewing and applying:
-- admin/MENU_MANAGER_PHASE_M_P2C2_CATEGORY_MANAGEMENT.sql
--
-- All category, product, size, section, and recipe fixtures are created inside
-- this transaction. The script ends with ROLLBACK and uses no production
-- category, product, product-size, section, or recipe id.

begin;

-- =========================================================
-- Structural, policy, and privilege checks
-- =========================================================

do $$
declare
  v_public_move_execute boolean;
  v_public_delete_execute boolean;
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'menu_manager_move_category'
      and pg_get_function_identity_arguments(p.oid) = 'p_category_id uuid, p_direction text'
      and pg_get_function_result(p.oid) = 'jsonb'
      and p.prosecdef = true
      and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'menu_manager_move_category structure/security verification failed.';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'menu_manager_delete_empty_category'
      and pg_get_function_identity_arguments(p.oid) = 'p_category_id uuid'
      and pg_get_function_result(p.oid) = 'jsonb'
      and p.prosecdef = true
      and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'menu_manager_delete_empty_category structure/security verification failed.';
  end if;

  select exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.menu_manager_move_category(uuid, text)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) into v_public_move_execute;

  select exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.menu_manager_delete_empty_category(uuid)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) into v_public_delete_execute;

  if v_public_move_execute
    or v_public_delete_execute
    or has_function_privilege('anon', 'public.menu_manager_move_category(uuid, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.menu_manager_delete_empty_category(uuid)', 'EXECUTE')
  then
    raise exception 'PUBLIC/anon category RPC execution must remain revoked.';
  end if;

  if not has_function_privilege('authenticated', 'public.menu_manager_move_category(uuid, text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.menu_manager_delete_empty_category(uuid)', 'EXECUTE')
  then
    raise exception 'Authenticated category RPC grants are missing.';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'categories'
      and p.cmd = 'ALL'
      and 'authenticated' = any(p.roles)
      and lower(coalesce(p.qual, '')) like '%is_admin%'
      and lower(coalesce(p.with_check, '')) like '%is_admin%'
  ) then
    raise exception 'Authenticated category writes are not guarded by the existing is_admin RLS policy.';
  end if;
end;
$$;

select
  p.oid::regprocedure::text as function_signature,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_function_result(p.oid) as return_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'menu_manager_move_category',
    'menu_manager_delete_empty_category'
  )
order by p.proname;

-- =========================================================
-- Transactional behavior checks
-- =========================================================

do $$
declare
  v_owner_id uuid;
  v_inventory_item_id uuid;
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_base_order integer;
  v_order_a_id uuid;
  v_order_b_id uuid;
  v_order_c_id uuid;
  v_lifecycle_category_id uuid;
  v_lifecycle_section_id uuid;
  v_lifecycle_product_id uuid;
  v_lifecycle_size_id uuid;
  v_lifecycle_recipe_id uuid;
  v_lifecycle_recipe_line_id uuid;
  v_empty_category_id uuid;
  v_empty_section_category_id uuid;
  v_empty_section_id uuid;
  v_blocked_category_id uuid;
  v_blocked_product_id uuid;
  v_blocked_size_id uuid;
  v_section_ref_category_id uuid;
  v_section_ref_section_id uuid;
  v_section_ref_product_id uuid;
  v_section_ref_size_id uuid;
  v_first_category_id uuid;
  v_last_category_id uuid;
  v_preserved_sort_order integer;
  v_category_count integer;
  v_distinct_order_count integer;
  v_min_order integer;
  v_max_order integer;
  v_count integer;
  v_result jsonb;
  v_before_order uuid[];
  v_after_order uuid[];
  v_error_detail text;
  v_error_message text;
  v_move_auth_blocked boolean := false;
  v_move_admin_blocked boolean := false;
  v_delete_admin_blocked boolean := false;
  v_nonempty_delete_blocked boolean := false;
  v_section_ref_delete_blocked boolean := false;
begin
  select ap.id
  into v_owner_id
  from public.admin_profiles ap
  where ap.role = 'owner'
  order by ap.created_at nulls last, ap.id
  limit 1;

  if v_owner_id is null then
    raise exception 'M-P2C.2 verification needs an existing owner profile.';
  end if;

  select ii.id
  into v_inventory_item_id
  from public.inventory_items ii
  order by ii.created_at, ii.id
  limit 1;

  if v_inventory_item_id is null then
    raise exception 'M-P2C.2 verification needs one existing inventory item for the temporary recipe line.';
  end if;

  -- Both RPCs must perform their own auth/admin checks even though they are
  -- SECURITY DEFINER functions.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.menu_manager_move_category(gen_random_uuid(), 'up');
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_move_auth_blocked := v_error_detail = 'MM_CATEGORY_AUTH_REQUIRED';
  end;

  if not v_move_auth_blocked then
    raise exception 'Move RPC auth guard verification failed.';
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.menu_manager_move_category(gen_random_uuid(), 'up');
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_move_admin_blocked := v_error_detail = 'MM_CATEGORY_ADMIN_REQUIRED';
  end;

  begin
    perform public.menu_manager_delete_empty_category(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_delete_admin_blocked := v_error_detail = 'MM_CATEGORY_ADMIN_REQUIRED';
  end;

  if not v_move_admin_blocked or not v_delete_admin_blocked then
    raise exception 'Category RPC owner/admin guard verification failed.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  select coalesce(max(c.sort_order), 0) + 100
  into v_base_order
  from public.categories c;

  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C2 Order A ' || v_suffix, v_base_order, true)
  returning id into v_order_a_id;

  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C2 Order B ' || v_suffix, v_base_order + 20, true)
  returning id into v_order_b_id;

  -- Duplicate B/C position plus sparse values verifies deterministic repair.
  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C2 Order C ' || v_suffix, v_base_order + 20, true)
  returning id into v_order_c_id;

  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C2 Lifecycle ' || v_suffix, v_base_order + 40, true)
  returning id into v_lifecycle_category_id;

  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C2 Empty ' || v_suffix, v_base_order + 60, true)
  returning id into v_empty_category_id;

  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C2 Empty Sections ' || v_suffix, v_base_order + 80, false)
  returning id into v_empty_section_category_id;

  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C2 Blocked ' || v_suffix, v_base_order + 100, true)
  returning id into v_blocked_category_id;

  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C2 Section Ref ' || v_suffix, v_base_order + 120, true)
  returning id into v_section_ref_category_id;

  insert into public.category_sections (category_id, name, sort_order, is_active)
  values (v_lifecycle_category_id, 'Lifecycle Section', 0, true)
  returning id into v_lifecycle_section_id;

  insert into public.products (
    category_id,
    category_section_id,
    name,
    description,
    is_available,
    is_sold_out,
    is_published,
    is_curv_pick,
    is_seasonal,
    sort_order,
    variant_group_name
  ) values (
    v_lifecycle_category_id,
    v_lifecycle_section_id,
    'M-P2C2 Lifecycle Product',
    'Temporary unavailable product for category lifecycle verification',
    false,
    false,
    true,
    true,
    false,
    0,
    'Each'
  )
  returning id into v_lifecycle_product_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_lifecycle_product_id, 'Each', 180, 80, 0)
  returning id into v_lifecycle_size_id;

  insert into public.inventory_recipes (
    product_size_id,
    notes,
    created_by,
    updated_by
  ) values (
    v_lifecycle_size_id,
    'M-P2C2 temporary recipe',
    v_owner_id,
    v_owner_id
  )
  returning id into v_lifecycle_recipe_id;

  insert into public.inventory_recipe_lines (
    recipe_id,
    inventory_item_id,
    quantity_required,
    sort_order,
    created_by,
    updated_by
  ) values (
    v_lifecycle_recipe_id,
    v_inventory_item_id,
    1,
    0,
    v_owner_id,
    v_owner_id
  )
  returning id into v_lifecycle_recipe_line_id;

  insert into public.category_sections (category_id, name, sort_order, is_active)
  values (v_empty_section_category_id, 'Empty Section', 0, true)
  returning id into v_empty_section_id;

  insert into public.products (
    category_id,
    name,
    is_available,
    is_sold_out,
    is_published,
    is_curv_pick,
    is_seasonal,
    sort_order,
    variant_group_name
  ) values (
    v_blocked_category_id,
    'M-P2C2 Blocking Product',
    true,
    false,
    false,
    false,
    false,
    0,
    'Each'
  )
  returning id into v_blocked_product_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_blocked_product_id, 'Each', 100, null, 0)
  returning id into v_blocked_size_id;

  -- The schema permits a legacy mismatch between products.category_id and the
  -- category that owns category_section_id. Safe deletion must still treat the
  -- section reference as product membership and refuse to clear it implicitly.
  insert into public.category_sections (category_id, name, sort_order, is_active)
  values (v_section_ref_category_id, 'Referenced Section', 0, true)
  returning id into v_section_ref_section_id;

  insert into public.products (
    category_id,
    category_section_id,
    name,
    is_available,
    is_sold_out,
    is_published,
    is_curv_pick,
    is_seasonal,
    sort_order,
    variant_group_name
  ) values (
    v_lifecycle_category_id,
    v_section_ref_section_id,
    'M-P2C2 Section Reference Product',
    true,
    false,
    false,
    false,
    false,
    1,
    'Each'
  )
  returning id into v_section_ref_product_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_section_ref_product_id, 'Each', 110, null, 0)
  returning id into v_section_ref_size_id;

  -- Move B down: duplicate/sparse values normalize, then C is B's immediate
  -- neighbor and the swap is atomic.
  v_result := public.menu_manager_move_category(v_order_b_id, 'down');

  if v_result ->> 'operation' is distinct from 'moved'
    or (select sort_order from public.categories where id = v_order_c_id)
       >= (select sort_order from public.categories where id = v_order_b_id)
    or (select sort_order from public.categories where id = v_order_a_id)
       >= (select sort_order from public.categories where id = v_order_c_id)
  then
    raise exception 'Move-down neighboring swap verification failed.';
  end if;

  select count(*), count(distinct c.sort_order), min(c.sort_order), max(c.sort_order)
  into v_category_count, v_distinct_order_count, v_min_order, v_max_order
  from public.categories c;

  if v_distinct_order_count <> v_category_count
    or v_min_order <> 0
    or v_max_order <> v_category_count - 1
  then
    raise exception 'Duplicate/sparse category normalization verification failed.';
  end if;

  -- Move B up restores A/B/C.
  perform public.menu_manager_move_category(v_order_b_id, 'up');
  if (select sort_order from public.categories where id = v_order_a_id)
       >= (select sort_order from public.categories where id = v_order_b_id)
    or (select sort_order from public.categories where id = v_order_b_id)
       >= (select sort_order from public.categories where id = v_order_c_id)
  then
    raise exception 'Move-up restore verification failed.';
  end if;

  -- First/last moves are controlled no-ops and preserve canonical ordering.
  select c.id into v_first_category_id
  from public.categories c
  order by c.sort_order, lower(c.name), c.id
  limit 1;

  select array_agg(c.id order by c.sort_order, lower(c.name), c.id)
  into v_before_order
  from public.categories c;

  v_result := public.menu_manager_move_category(v_first_category_id, 'up');

  select array_agg(c.id order by c.sort_order, lower(c.name), c.id)
  into v_after_order
  from public.categories c;

  if v_result ->> 'operation' is distinct from 'no_op' or v_before_order is distinct from v_after_order then
    raise exception 'First-category no-op verification failed.';
  end if;

  select c.id into v_last_category_id
  from public.categories c
  order by c.sort_order desc, lower(c.name) desc, c.id desc
  limit 1;

  select array_agg(c.id order by c.sort_order, lower(c.name), c.id)
  into v_before_order
  from public.categories c;

  v_result := public.menu_manager_move_category(v_last_category_id, 'down');

  select array_agg(c.id order by c.sort_order, lower(c.name), c.id)
  into v_after_order
  from public.categories c;

  if v_result ->> 'operation' is distinct from 'no_op' or v_before_order is distinct from v_after_order then
    raise exception 'Last-category no-op verification failed.';
  end if;

  -- M-P2A/M-P2B baseline: active arbitrary category and published unavailable
  -- product remain exposed, including the size needed for disabled rendering.
  if not exists (
    select 1
    from public.public_menu_categories c
    where c.id = v_lifecycle_category_id
      and c.sort_order = (
        select raw.sort_order
        from public.categories raw
        where raw.id = v_lifecycle_category_id
      )
  ) or not exists (
    select 1
    from public.public_menu_products p
    where p.id = v_lifecycle_product_id
      and p.is_available = false
      and p.is_sold_out = false
  ) or not exists (
    select 1
    from public.public_menu_product_sizes ps
    where ps.id = v_lifecycle_size_id
      and ps.product_id = v_lifecycle_product_id
  ) then
    raise exception 'M-P2A/M-P2B public-view baseline verification failed.';
  end if;

  select c.sort_order
  into v_preserved_sort_order
  from public.categories c
  where c.id = v_lifecycle_category_id;

  update public.categories
  set is_active = false
  where id = v_lifecycle_category_id;

  if (select is_active from public.categories where id = v_lifecycle_category_id) is distinct from false
    or (select sort_order from public.categories where id = v_lifecycle_category_id) <> v_preserved_sort_order
    or not exists (
      select 1
      from public.products p
      where p.id = v_lifecycle_product_id
        and p.category_id = v_lifecycle_category_id
        and p.category_section_id = v_lifecycle_section_id
        and p.is_published = true
        and p.is_available = false
        and p.is_sold_out = false
        and p.is_curv_pick = true
    )
    or not exists (select 1 from public.product_sizes where id = v_lifecycle_size_id)
    or not exists (select 1 from public.category_sections where id = v_lifecycle_section_id)
    or not exists (select 1 from public.inventory_recipes where id = v_lifecycle_recipe_id)
    or not exists (select 1 from public.inventory_recipe_lines where id = v_lifecycle_recipe_line_id)
    or exists (select 1 from public.public_menu_categories where id = v_lifecycle_category_id)
  then
    raise exception 'Hide-category preservation/public exclusion verification failed.';
  end if;

  update public.categories
  set is_active = true
  where id = v_lifecycle_category_id;

  if (select is_active from public.categories where id = v_lifecycle_category_id) is distinct from true
    or (select sort_order from public.categories where id = v_lifecycle_category_id) <> v_preserved_sort_order
    or not exists (select 1 from public.public_menu_categories where id = v_lifecycle_category_id)
  then
    raise exception 'Show-category restoration verification failed.';
  end if;

  -- Empty category deletion succeeds.
  perform public.menu_manager_delete_empty_category(v_empty_category_id);
  if exists (select 1 from public.categories where id = v_empty_category_id) then
    raise exception 'Empty category deletion verification failed.';
  end if;

  -- Hidden empty categories remain manageable; empty sections are removed in
  -- the same transaction before permanent category deletion.
  v_result := public.menu_manager_delete_empty_category(v_empty_section_category_id);
  if exists (select 1 from public.categories where id = v_empty_section_category_id)
    or exists (select 1 from public.category_sections where id = v_empty_section_id)
    or (v_result ->> 'deleted_section_count')::integer is distinct from 1
  then
    raise exception 'Empty-section category deletion verification failed.';
  end if;

  -- One referencing product blocks deletion and preserves all rows.
  begin
    perform public.menu_manager_delete_empty_category(v_blocked_category_id);
  exception when others then
    get stacked diagnostics
      v_error_detail = pg_exception_detail,
      v_error_message = message_text;
    v_nonempty_delete_blocked := v_error_detail = 'MM_CATEGORY_NOT_EMPTY'
      and v_error_message like '%1 product%';
  end;

  if not v_nonempty_delete_blocked
    or not exists (select 1 from public.categories where id = v_blocked_category_id)
    or not exists (select 1 from public.products where id = v_blocked_product_id)
    or not exists (select 1 from public.product_sizes where id = v_blocked_size_id)
  then
    raise exception 'Nonempty category deletion protection verification failed.';
  end if;

  begin
    perform public.menu_manager_delete_empty_category(v_section_ref_category_id);
  exception when others then
    get stacked diagnostics
      v_error_detail = pg_exception_detail,
      v_error_message = message_text;
    v_section_ref_delete_blocked := v_error_detail = 'MM_CATEGORY_NOT_EMPTY'
      and v_error_message like '%1 product%';
  end;

  if not v_section_ref_delete_blocked
    or not exists (select 1 from public.categories where id = v_section_ref_category_id)
    or not exists (select 1 from public.category_sections where id = v_section_ref_section_id)
    or not exists (
      select 1
      from public.products
      where id = v_section_ref_product_id
        and category_section_id = v_section_ref_section_id
    )
    or not exists (select 1 from public.product_sizes where id = v_section_ref_size_id)
  then
    raise exception 'Section-referenced category deletion protection verification failed.';
  end if;

  select count(*), count(distinct c.sort_order), min(c.sort_order), max(c.sort_order)
  into v_category_count, v_distinct_order_count, v_min_order, v_max_order
  from public.categories c;

  if v_distinct_order_count <> v_category_count
    or v_min_order <> 0
    or v_max_order <> v_category_count - 1
  then
    raise exception 'Post-deletion deterministic category ordering verification failed.';
  end if;

  select count(*)
  into v_count
  from public.public_menu_product_sizes ps
  where ps.id = v_lifecycle_size_id;

  if v_count <> 1 then
    raise exception 'M-P2A public size view regressed after category lifecycle operations.';
  end if;

  raise notice 'M-P2C.2 verification passed. Category/product/size/section/recipe fixtures are transaction-local.';
end;
$$;

rollback;
