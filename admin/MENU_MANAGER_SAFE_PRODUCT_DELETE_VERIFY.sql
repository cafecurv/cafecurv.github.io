-- CURV Menu Manager - Safe Product Delete Verification
-- Run only after applying MENU_MANAGER_SAFE_PRODUCT_DELETE.sql.
-- All fixtures are temporary because this script ends with ROLLBACK.

begin;

do $$
declare
  v_public_execute boolean;
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'menu_manager_delete_product'
      and pg_get_function_identity_arguments(p.oid) = 'p_product_id uuid'
      and pg_get_function_result(p.oid) = 'jsonb'
      and p.prosecdef = true
      and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'menu_manager_delete_product structure/security verification failed.';
  end if;

  select exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.menu_manager_delete_product(uuid)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) into v_public_execute;

  if v_public_execute
    or has_function_privilege('anon', 'public.menu_manager_delete_product(uuid)', 'EXECUTE')
  then
    raise exception 'PUBLIC/anon safe product delete execution must be revoked.';
  end if;

  if not has_function_privilege('authenticated', 'public.menu_manager_delete_product(uuid)', 'EXECUTE') then
    raise exception 'Authenticated safe product delete grant is missing.';
  end if;

  if has_table_privilege('anon', 'public.products', 'DELETE') then
    raise exception 'Anon must not have direct product delete access.';
  end if;
end;
$$;

do $$
declare
  v_owner_id uuid;
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_protected_category_id uuid;
  v_protected_product_id uuid;
  v_protected_size_id uuid;
  v_recipe_id uuid;
  v_archived_product_id uuid;
  v_safe_category_id uuid;
  v_safe_product_id uuid;
  v_safe_size_id uuid;
  v_option_group_id uuid;
  v_option_choice_id uuid;
  v_option_assignment_id uuid;
  v_option_default_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_result jsonb;
  v_error_detail text;
  v_auth_blocked boolean := false;
  v_admin_blocked boolean := false;
  v_missing_blocked boolean := false;
  v_recipe_blocked boolean := false;
  v_archived_blocked boolean := false;
  v_protected_product_snapshot jsonb;
  v_protected_size_snapshot jsonb;
  v_recipe_snapshot jsonb;
  v_category_snapshot jsonb;
  v_order_item_snapshot jsonb;
begin
  select ap.id into v_owner_id
  from public.admin_profiles ap
  where ap.role = 'owner'
  order by ap.created_at nulls last, ap.id
  limit 1;

  if v_owner_id is null then
    raise exception 'Safe product delete verification needs an existing owner profile.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.menu_manager_delete_product(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_auth_blocked := v_error_detail = 'MM_PRODUCT_DELETE_AUTH_REQUIRED';
  end;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.menu_manager_delete_product(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_admin_blocked := v_error_detail = 'MM_PRODUCT_DELETE_ADMIN_REQUIRED';
  end;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  begin
    perform public.menu_manager_delete_product(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_missing_blocked := v_error_detail = 'MM_PRODUCT_DELETE_NOT_FOUND';
  end;

  if not v_auth_blocked or not v_admin_blocked or not v_missing_blocked then
    raise exception 'Safe product delete authentication/admin/missing-product guards failed.';
  end if;

  insert into public.categories (name, sort_order, is_active)
  values ('Delete Protected ' || v_suffix, 910000, true)
  returning id into v_protected_category_id;

  insert into public.products (
    category_id, name, is_available, is_sold_out, is_published,
    is_curv_pick, is_seasonal, sort_order, variant_group_name
  ) values (
    v_protected_category_id, 'Recipe Protected ' || v_suffix, true, false,
    false, false, false, 0, 'Each'
  ) returning id into v_protected_product_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_protected_product_id, 'Each', 100, 40, 0)
  returning id into v_protected_size_id;

  insert into public.inventory_recipes (product_size_id, notes, created_by, updated_by)
  values (v_protected_size_id, 'Safe-delete blocker', v_owner_id, v_owner_id)
  returning id into v_recipe_id;

  select to_jsonb(p) into v_protected_product_snapshot
  from public.products p where p.id = v_protected_product_id;
  select to_jsonb(ps) into v_protected_size_snapshot
  from public.product_sizes ps where ps.id = v_protected_size_id;
  select to_jsonb(ir) into v_recipe_snapshot
  from public.inventory_recipes ir where ir.id = v_recipe_id;

  begin
    perform public.menu_manager_delete_product(v_protected_product_id);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_recipe_blocked := v_error_detail = 'MM_PRODUCT_RECIPE_PROTECTED';
  end;

  if not v_recipe_blocked
    or (select to_jsonb(p) from public.products p where p.id = v_protected_product_id) is distinct from v_protected_product_snapshot
    or (select to_jsonb(ps) from public.product_sizes ps where ps.id = v_protected_size_id) is distinct from v_protected_size_snapshot
    or (select to_jsonb(ir) from public.inventory_recipes ir where ir.id = v_recipe_id) is distinct from v_recipe_snapshot
  then
    raise exception 'Recipe-protected rejection or no-mutation verification failed.';
  end if;

  insert into public.products (
    category_id, name, is_available, is_sold_out, is_published,
    is_curv_pick, is_seasonal, archived_at, sort_order, variant_group_name
  ) values (
    v_protected_category_id, 'Legacy Archived ' || v_suffix, false, false,
    false, false, false, clock_timestamp(), 1, 'Each'
  ) returning id into v_archived_product_id;

  begin
    perform public.menu_manager_delete_product(v_archived_product_id);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_archived_blocked := v_error_detail = 'MM_PRODUCT_ARCHIVED_REVIEW_REQUIRED';
  end;

  if not v_archived_blocked
    or not exists (
      select 1 from public.products p
      where p.id = v_archived_product_id and p.archived_at is not null
    )
  then
    raise exception 'Legacy archived-product review guard verification failed.';
  end if;

  insert into public.categories (name, sort_order, is_active)
  values ('Delete Safe ' || v_suffix, 910001, true)
  returning id into v_safe_category_id;

  insert into public.products (
    category_id, name, is_available, is_sold_out, is_published,
    is_curv_pick, is_seasonal, sort_order, variant_group_name
  ) values (
    v_safe_category_id, 'Safe Delete ' || v_suffix, true, false,
    false, false, false, 0, 'Each'
  ) returning id into v_safe_product_id;

  insert into public.product_sizes (product_id, label, price, cost, sort_order)
  values (v_safe_product_id, 'Each', 150, 60, 0)
  returning id into v_safe_size_id;

  insert into public.option_groups (name, group_key, selection_type, is_active, sort_order)
  values ('Delete Option ' || v_suffix, 'delete_' || v_suffix, 'single', true, 0)
  returning id into v_option_group_id;

  insert into public.option_choices (option_group_id, label, value, price_delta, sort_order, is_active)
  values (v_option_group_id, 'Choice', 'choice', 0, 0, true)
  returning id into v_option_choice_id;

  insert into public.product_option_groups (
    product_id, option_group_id, is_required, min_selections,
    max_selections, sort_order, is_active
  ) values (
    v_safe_product_id, v_option_group_id, true, 1, 1, 0, true
  ) returning id into v_option_assignment_id;

  insert into public.product_option_defaults (product_id, option_group_id, option_choice_id)
  values (v_safe_product_id, v_option_group_id, v_option_choice_id)
  returning id into v_option_default_id;

  insert into public.orders (
    order_number, status, customer_name, customer_phone, fulfillment_type,
    subtotal, total, currency, payment_status, source
  ) values (
    'DEL-' || upper(v_suffix), 'submitted', 'Delete Verification',
    '00000000000', 'pickup', 150, 150, 'PHP', 'unpaid', 'website'
  ) returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, product_size_id, product_name, category_name,
    variant_label, quantity, unit_price, line_total, options, item_note, sort_order
  ) values (
    v_order_id, v_safe_product_id, v_safe_size_id, 'Historical Product',
    'Historical Category', 'Each', 1, 150, 150,
    jsonb_build_object('Option', 'Choice'), 'Preserve snapshot', 0
  ) returning id into v_order_item_id;

  select to_jsonb(c) into v_category_snapshot
  from public.categories c where c.id = v_safe_category_id;
  select to_jsonb(oi) into v_order_item_snapshot
  from public.order_items oi where oi.id = v_order_item_id;

  v_result := public.menu_manager_delete_product(v_safe_product_id);

  if v_result ->> 'operation' is distinct from 'deleted'
    or (v_result ->> 'deleted_size_count')::integer <> 1
    or (v_result ->> 'deleted_option_assignment_count')::integer <> 1
    or (v_result ->> 'deleted_option_default_count')::integer <> 1
    or (v_result ->> 'preserved_order_item_reference_count')::integer <> 1
    or exists (select 1 from public.products p where p.id = v_safe_product_id)
    or exists (select 1 from public.product_sizes ps where ps.id = v_safe_size_id)
    or exists (select 1 from public.product_option_groups pog where pog.id = v_option_assignment_id)
    or exists (select 1 from public.product_option_defaults pod where pod.id = v_option_default_id)
  then
    raise exception 'Safe product and child-row deletion verification failed.';
  end if;

  if (select to_jsonb(c) from public.categories c where c.id = v_safe_category_id) is distinct from v_category_snapshot
    or (select to_jsonb(oi) from public.order_items oi where oi.id = v_order_item_id) is distinct from v_order_item_snapshot
    or (select to_jsonb(p) from public.products p where p.id = v_protected_product_id) is distinct from v_protected_product_snapshot
    or not exists (select 1 from public.option_groups og where og.id = v_option_group_id)
    or not exists (select 1 from public.option_choices oc where oc.id = v_option_choice_id)
  then
    raise exception 'Category, historical order, unrelated product, or reusable option data changed during delete.';
  end if;

  if not exists (
    select 1 from public.categories c
    where c.id = v_safe_category_id and c.is_active = true
  ) then
    raise exception 'Deleting the last product removed or deactivated its category.';
  end if;

  raise notice 'Safe product delete verification passed: authorization, blockers, cascades, history, unrelated products, and categories are preserved.';
end;
$$;

rollback;
