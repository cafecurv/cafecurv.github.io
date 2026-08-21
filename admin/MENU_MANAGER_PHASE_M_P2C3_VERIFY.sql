-- CURV Menu Manager Phase M-P2C.3 verification
--
-- Run manually in Supabase SQL Editor only after reviewing and applying:
-- admin/MENU_MANAGER_PHASE_M_P2C3_PRODUCT_ARCHIVE.sql
--
-- All category, section, product, size, recipe, option, order, and order-item
-- fixtures are transaction-local. This script ends with ROLLBACK and uses no
-- production product, product-size, recipe, option-assignment, or order ID.

begin;

-- =========================================================
-- Structural, policy, and privilege checks
-- =========================================================

do $$
declare
  v_public_archive_execute boolean;
  v_public_restore_execute boolean;
begin
  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'products'
      and c.column_name = 'archived_at'
      and c.data_type = 'timestamp with time zone'
      and c.is_nullable = 'YES'
  ) then
    raise exception 'products.archived_at column verification failed.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.products'::regclass
      and c.conname = 'products_archived_state_safe'
      and c.contype = 'c'
  ) then
    raise exception 'Archived product lifecycle safety constraint is missing.';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.product_sizes'::regclass
      and t.tgname = 'guard_archived_product_sizes'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'Archived product-size read-only trigger is missing.';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'menu_manager_archive_product'
      and pg_get_function_identity_arguments(p.oid) = 'p_product_id uuid'
      and pg_get_function_result(p.oid) = 'jsonb'
      and p.prosecdef = true
      and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'menu_manager_archive_product structure/security verification failed.';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'menu_manager_restore_product'
      and pg_get_function_identity_arguments(p.oid) = 'p_product_id uuid'
      and pg_get_function_result(p.oid) = 'jsonb'
      and p.prosecdef = true
      and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'menu_manager_restore_product structure/security verification failed.';
  end if;

  select exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.menu_manager_archive_product(uuid)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) into v_public_archive_execute;

  select exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.menu_manager_restore_product(uuid)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) into v_public_restore_execute;

  if v_public_archive_execute
    or v_public_restore_execute
    or has_function_privilege('anon', 'public.menu_manager_archive_product(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.menu_manager_restore_product(uuid)', 'EXECUTE')
  then
    raise exception 'PUBLIC/anon product lifecycle RPC execution must remain revoked.';
  end if;

  if not has_function_privilege('authenticated', 'public.menu_manager_archive_product(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.menu_manager_restore_product(uuid)', 'EXECUTE')
  then
    raise exception 'Authenticated product lifecycle RPC grants are missing.';
  end if;

  if not has_column_privilege('anon', 'public.products', 'archived_at', 'SELECT') then
    raise exception 'The security_invoker public views cannot evaluate products.archived_at as anon.';
  end if;

  if position('archived_at' in lower(pg_get_viewdef('public.public_menu_products'::regclass, true))) = 0
    or position('archived_at' in lower(pg_get_viewdef('public.public_menu_product_sizes'::regclass, true))) = 0
    or position('archived_at' in lower(pg_get_viewdef('public.public_menu_option_groups'::regclass, true))) = 0
    or position('archived_at' in lower(pg_get_viewdef('public.public_menu_option_choices'::regclass, true))) = 0
    or position('archived_at' in lower(pg_get_viewdef('public.public_menu_option_defaults'::regclass, true))) = 0
  then
    raise exception 'One or more public menu views are missing the archive safeguard.';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'products'
      and p.policyname = 'Public can read published menu products'
      and lower(coalesce(p.qual, '')) like '%archived_at%is null%'
  ) or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'product_sizes'
      and p.policyname = 'Public can read published menu product sizes'
      and lower(coalesce(p.qual, '')) like '%archived_at%is null%'
  ) then
    raise exception 'Public product/product-size RLS archive safeguards are missing.';
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
    'menu_manager_archive_product',
    'menu_manager_restore_product'
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
  v_category_id uuid;
  v_section_id uuid;
  v_product_id uuid;
  v_size_id uuid;
  v_recipe_id uuid;
  v_recipe_line_id uuid;
  v_option_group_id uuid;
  v_option_choice_id uuid;
  v_option_assignment_id uuid;
  v_option_default_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_baseline_category_id uuid;
  v_baseline_product_id uuid;
  v_baseline_size_id uuid;
  v_result jsonb;
  v_archived_at timestamptz;
  v_product_snapshot jsonb;
  v_size_snapshot jsonb;
  v_recipe_snapshot jsonb;
  v_recipe_line_snapshot jsonb;
  v_option_assignment_snapshot jsonb;
  v_option_default_snapshot jsonb;
  v_order_item_snapshot jsonb;
  v_error_detail text;
  v_archive_auth_blocked boolean := false;
  v_restore_auth_blocked boolean := false;
  v_archive_admin_blocked boolean := false;
  v_restore_admin_blocked boolean := false;
  v_archived_size_edit_blocked boolean := false;
  v_stale_state_blocked boolean := false;
  v_category_delete_blocked boolean := false;
begin
  select ap.id
  into v_owner_id
  from public.admin_profiles ap
  where ap.role = 'owner'
  order by ap.created_at nulls last, ap.id
  limit 1;

  if v_owner_id is null then
    raise exception 'M-P2C.3 verification needs an existing owner profile.';
  end if;

  select ii.id
  into v_inventory_item_id
  from public.inventory_items ii
  order by ii.created_at, ii.id
  limit 1;

  if v_inventory_item_id is null then
    raise exception 'M-P2C.3 verification needs one existing inventory item for the temporary recipe line.';
  end if;

  -- SECURITY DEFINER functions must enforce authentication and owner access.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.menu_manager_archive_product(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_archive_auth_blocked := v_error_detail = 'MM_PRODUCT_ARCHIVE_AUTH_REQUIRED';
  end;

  begin
    perform public.menu_manager_restore_product(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_restore_auth_blocked := v_error_detail = 'MM_PRODUCT_RESTORE_AUTH_REQUIRED';
  end;

  if not v_archive_auth_blocked or not v_restore_auth_blocked then
    raise exception 'Product lifecycle RPC authentication guard verification failed.';
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.menu_manager_archive_product(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_archive_admin_blocked := v_error_detail = 'MM_PRODUCT_ARCHIVE_ADMIN_REQUIRED';
  end;

  begin
    perform public.menu_manager_restore_product(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_restore_admin_blocked := v_error_detail = 'MM_PRODUCT_RESTORE_ADMIN_REQUIRED';
  end;

  if not v_archive_admin_blocked or not v_restore_admin_blocked then
    raise exception 'Product lifecycle RPC owner/admin guard verification failed.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C3 Archive ' || v_suffix, 900000, true)
  returning id into v_category_id;

  insert into public.category_sections (category_id, name, sort_order, is_active)
  values (v_category_id, 'Archive Section', 0, true)
  returning id into v_section_id;

  insert into public.products (
    category_id,
    category_section_id,
    name,
    description,
    image_url,
    notes,
    is_available,
    is_sold_out,
    is_published,
    is_curv_pick,
    is_seasonal,
    sort_order,
    variant_group_name
  ) values (
    v_category_id,
    v_section_id,
    'M-P2C3 Archive Product',
    'Temporary archive verification row',
    'https://example.invalid/mp2c3.jpg',
    'Preserve this owner note',
    true,
    true,
    true,
    true,
    true,
    0,
    'Each'
  )
  returning id into v_product_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_product_id, 'Each', 150, 60, 0)
  returning id into v_size_id;

  insert into public.inventory_recipes (
    product_size_id,
    notes,
    created_by,
    updated_by
  ) values (
    v_size_id,
    'M-P2C3 temporary recipe',
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

  insert into public.option_groups (
    name,
    group_key,
    selection_type,
    is_active,
    sort_order
  ) values (
    'M-P2C3 Option ' || v_suffix,
    'mp2c3_' || v_suffix,
    'single',
    true,
    0
  )
  returning id into v_option_group_id;

  insert into public.option_choices (
    option_group_id,
    label,
    value,
    price_delta,
    sort_order,
    is_active
  ) values (
    v_option_group_id,
    'M-P2C3 Choice',
    'mp2c3_choice',
    0,
    0,
    true
  )
  returning id into v_option_choice_id;

  insert into public.product_option_groups (
    product_id,
    option_group_id,
    is_required,
    min_selections,
    max_selections,
    sort_order,
    is_active
  ) values (
    v_product_id,
    v_option_group_id,
    true,
    1,
    1,
    0,
    true
  )
  returning id into v_option_assignment_id;

  insert into public.product_option_defaults (
    product_id,
    option_group_id,
    option_choice_id
  ) values (
    v_product_id,
    v_option_group_id,
    v_option_choice_id
  )
  returning id into v_option_default_id;

  insert into public.orders (
    order_number,
    status,
    customer_name,
    customer_phone,
    fulfillment_type,
    subtotal,
    total,
    currency,
    payment_status,
    source
  ) values (
    'MP2C3-' || upper(v_suffix),
    'submitted',
    'M-P2C3 Verification',
    '00000000000',
    'pickup',
    150,
    150,
    'PHP',
    'unpaid',
    'website'
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id,
    product_id,
    product_size_id,
    product_name,
    category_name,
    variant_label,
    quantity,
    unit_price,
    line_total,
    options,
    item_note,
    sort_order
  ) values (
    v_order_id,
    v_product_id,
    v_size_id,
    'M-P2C3 Snapshot Product',
    'M-P2C3 Snapshot Category',
    'Each',
    1,
    150,
    150,
    jsonb_build_object('M-P2C3 Option', 'M-P2C3 Choice'),
    'Preserve snapshot',
    0
  )
  returning id into v_order_item_id;

  select to_jsonb(p) - array[
    'archived_at',
    'is_published',
    'is_available',
    'is_sold_out',
    'is_curv_pick',
    'updated_at'
  ]::text[] into v_product_snapshot
  from public.products p
  where p.id = v_product_id;

  select to_jsonb(ps) into v_size_snapshot
  from public.product_sizes ps where ps.id = v_size_id;
  select to_jsonb(r) into v_recipe_snapshot
  from public.inventory_recipes r where r.id = v_recipe_id;
  select to_jsonb(rl) into v_recipe_line_snapshot
  from public.inventory_recipe_lines rl where rl.id = v_recipe_line_id;
  select to_jsonb(pog) into v_option_assignment_snapshot
  from public.product_option_groups pog where pog.id = v_option_assignment_id;
  select to_jsonb(pod) into v_option_default_snapshot
  from public.product_option_defaults pod where pod.id = v_option_default_id;
  select to_jsonb(oi) into v_order_item_snapshot
  from public.order_items oi where oi.id = v_order_item_id;

  v_result := public.menu_manager_archive_product(v_product_id);

  select p.archived_at into v_archived_at
  from public.products p where p.id = v_product_id;

  if v_result ->> 'operation' is distinct from 'archived'
    or v_archived_at is null
    or (v_result #>> '{product,id}')::uuid is distinct from v_product_id
    or (v_result #>> '{product,archived_at}')::timestamptz is distinct from v_archived_at
    or (select p.is_published from public.products p where p.id = v_product_id) is distinct from false
    or (select p.is_available from public.products p where p.id = v_product_id) is distinct from false
    or (select p.is_sold_out from public.products p where p.id = v_product_id) is distinct from false
    or (select p.is_curv_pick from public.products p where p.id = v_product_id) is distinct from false
  then
    raise exception 'Archive canonical state verification failed.';
  end if;

  begin
    update public.product_sizes
    set price = price + 1
    where id = v_size_id;
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_archived_size_edit_blocked := v_error_detail = 'MM_ARCHIVED_PRODUCT_READ_ONLY';
  end;

  if not v_archived_size_edit_blocked then
    raise exception 'Archived product-size read-only verification failed.';
  end if;

  if (select to_jsonb(p) - array[
      'archived_at',
      'is_published',
      'is_available',
      'is_sold_out',
      'is_curv_pick',
      'updated_at'
    ]::text[] from public.products p where p.id = v_product_id) is distinct from v_product_snapshot
    or (select to_jsonb(ps) from public.product_sizes ps where ps.id = v_size_id) is distinct from v_size_snapshot
    or (select to_jsonb(r) from public.inventory_recipes r where r.id = v_recipe_id) is distinct from v_recipe_snapshot
    or (select to_jsonb(rl) from public.inventory_recipe_lines rl where rl.id = v_recipe_line_id) is distinct from v_recipe_line_snapshot
    or (select to_jsonb(pog) from public.product_option_groups pog where pog.id = v_option_assignment_id) is distinct from v_option_assignment_snapshot
    or (select to_jsonb(pod) from public.product_option_defaults pod where pod.id = v_option_default_id) is distinct from v_option_default_snapshot
  then
    raise exception 'Archive mutated preserved product, size, recipe, or option configuration.';
  end if;

  if exists (select 1 from public.public_menu_products p where p.id = v_product_id)
    or exists (select 1 from public.public_menu_product_sizes ps where ps.product_id = v_product_id)
    or exists (select 1 from public.public_menu_option_groups pog where pog.product_id = v_product_id)
    or exists (select 1 from public.public_menu_option_choices poc where poc.product_id = v_product_id)
    or exists (select 1 from public.public_menu_option_defaults pod where pod.product_id = v_product_id)
  then
    raise exception 'Archived product remains visible in a public menu view.';
  end if;

  -- Direct/stale updates cannot make an archived row public, orderable, sold
  -- out, or a CURV Pick. Public views also carry an explicit archive predicate.
  begin
    update public.products
    set is_published = true, is_available = true, is_sold_out = true, is_curv_pick = true
    where id = v_product_id;
  exception when check_violation then
    v_stale_state_blocked := true;
  end;

  if not v_stale_state_blocked
    or exists (select 1 from public.public_menu_products p where p.id = v_product_id)
    or exists (select 1 from public.public_menu_product_sizes ps where ps.product_id = v_product_id)
    or exists (select 1 from public.public_menu_option_groups pog where pog.product_id = v_product_id)
  then
    raise exception 'Archived stale-state public-view safeguard verification failed.';
  end if;

  v_result := public.menu_manager_archive_product(v_product_id);
  if v_result ->> 'operation' is distinct from 'already_archived'
    or (select p.archived_at from public.products p where p.id = v_product_id) is distinct from v_archived_at
    or (select p.is_published or p.is_available or p.is_sold_out or p.is_curv_pick from public.products p where p.id = v_product_id)
  then
    raise exception 'Archive retry/idempotence verification failed.';
  end if;

  v_result := public.menu_manager_restore_product(v_product_id);
  if v_result ->> 'operation' is distinct from 'restored'
    or (select p.archived_at from public.products p where p.id = v_product_id) is not null
    or (select p.is_published from public.products p where p.id = v_product_id) is distinct from false
    or (select p.is_available from public.products p where p.id = v_product_id) is distinct from false
    or (select p.is_sold_out from public.products p where p.id = v_product_id) is distinct from false
    or (select p.is_curv_pick from public.products p where p.id = v_product_id) is distinct from false
  then
    raise exception 'Restore canonical safe-state verification failed.';
  end if;

  if (select to_jsonb(p) - array[
      'archived_at',
      'is_published',
      'is_available',
      'is_sold_out',
      'is_curv_pick',
      'updated_at'
    ]::text[] from public.products p where p.id = v_product_id) is distinct from v_product_snapshot
    or (select to_jsonb(ps) from public.product_sizes ps where ps.id = v_size_id) is distinct from v_size_snapshot
    or (select to_jsonb(r) from public.inventory_recipes r where r.id = v_recipe_id) is distinct from v_recipe_snapshot
    or (select to_jsonb(rl) from public.inventory_recipe_lines rl where rl.id = v_recipe_line_id) is distinct from v_recipe_line_snapshot
    or (select to_jsonb(pog) from public.product_option_groups pog where pog.id = v_option_assignment_id) is distinct from v_option_assignment_snapshot
    or (select to_jsonb(pod) from public.product_option_defaults pod where pod.id = v_option_default_id) is distinct from v_option_default_snapshot
  then
    raise exception 'Restore mutated preserved product, size, recipe, or option configuration.';
  end if;

  -- A restore retry is a controlled no-op and does not change active state.
  v_result := public.menu_manager_restore_product(v_product_id);
  if v_result ->> 'operation' is distinct from 'not_archived'
    or (select p.is_published or p.is_available or p.is_sold_out or p.is_curv_pick from public.products p where p.id = v_product_id)
  then
    raise exception 'Restore retry/no-op verification failed.';
  end if;

  -- M-P2A baseline: a non-archived published unavailable product and its size
  -- remain public so the customer UI can render it disabled.
  insert into public.categories (name, sort_order, is_active)
  values ('M-P2C3 Baseline ' || v_suffix, 900001, true)
  returning id into v_baseline_category_id;

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
    v_baseline_category_id,
    'M-P2C3 Unavailable Baseline',
    false,
    false,
    true,
    false,
    false,
    0,
    'Each'
  )
  returning id into v_baseline_product_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_baseline_product_id, 'Each', 100, 40, 0)
  returning id into v_baseline_size_id;

  if not exists (
    select 1 from public.public_menu_products p
    where p.id = v_baseline_product_id
      and p.is_available = false
      and p.is_sold_out = false
  ) or not exists (
    select 1 from public.public_menu_product_sizes ps
    where ps.id = v_baseline_size_id
      and ps.product_id = v_baseline_product_id
  ) then
    raise exception 'M-P2A published-unavailable public-view behavior regressed.';
  end if;

  -- The archive preserves the category reference, so safe category deletion
  -- must continue to count and block it.
  perform public.menu_manager_archive_product(v_product_id);
  begin
    perform public.menu_manager_delete_empty_category(v_category_id);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_category_delete_blocked := v_error_detail = 'MM_CATEGORY_NOT_EMPTY';
  end;

  if not v_category_delete_blocked
    or not exists (select 1 from public.categories c where c.id = v_category_id)
    or not exists (select 1 from public.products p where p.id = v_product_id and p.archived_at is not null)
  then
    raise exception 'Archived category-reference safe-delete verification failed.';
  end if;

  if (select to_jsonb(oi) from public.order_items oi where oi.id = v_order_item_id) is distinct from v_order_item_snapshot then
    raise exception 'Archive/restore mutated the historical order-item snapshot.';
  end if;

  raise notice 'M-P2C.3 verification passed: archive/restore state, security, public views, M-P2A behavior, references, recipes, options, and order snapshots are preserved.';
end;
$$;

rollback;
