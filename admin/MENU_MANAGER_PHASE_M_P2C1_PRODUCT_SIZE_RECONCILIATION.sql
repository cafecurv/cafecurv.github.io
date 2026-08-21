-- CURV Menu Manager Phase M-P2C.1
-- Transactional product-size reconciliation with recipe protection
--
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Current protected dependency:
-- - inventory_recipes.product_size_id references product_sizes.id on delete
--   cascade, so deleting a recipe-backed size would also delete its recipe and
--   recipe lines.
--
-- Historical order_items keep product_size_id only as a nullable identifier
-- and snapshot product/variant names and prices. Product option tables attach
-- to products and option groups, not product_sizes.

begin;

drop function if exists public.menu_manager_reconcile_product_sizes(uuid, jsonb);

create function public.menu_manager_reconcile_product_sizes(
  p_product_id uuid,
  p_sizes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product_id uuid;
  v_size jsonb;
  v_size_number integer;
  v_size_id_text text;
  v_size_id uuid;
  v_label text;
  v_normalized_label text;
  v_price_text text;
  v_price numeric;
  v_cost_text text;
  v_cost numeric;
  v_sort_order_text text;
  v_sort_order integer;
  v_matching_existing_count integer;
  v_existing_size public.product_sizes%rowtype;
  v_input record;
  v_removed_size record;
  v_inserted_size_id uuid;
  v_updated_count integer := 0;
  v_inserted_count integer := 0;
  v_deleted_count integer := 0;
  v_result_sizes jsonb;
begin
  if v_actor is null then
    raise exception 'Please sign in before saving product sizes.'
      using errcode = 'P0001',
        detail = 'MM_SIZE_AUTH_REQUIRED',
        hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can save product sizes.'
      using errcode = 'P0001',
        detail = 'MM_SIZE_ADMIN_REQUIRED',
        hint = 'Use an approved owner account.';
  end if;

  if p_product_id is null then
    raise exception 'Choose a product before saving its sizes.'
      using errcode = 'P0001',
        detail = 'MM_SIZE_PRODUCT_REQUIRED';
  end if;

  if p_sizes is null or jsonb_typeof(p_sizes) is distinct from 'array' then
    raise exception 'Product sizes must be submitted as a list.'
      using errcode = 'P0001',
        detail = 'MM_SIZE_LIST_REQUIRED';
  end if;

  if jsonb_array_length(p_sizes) = 0 then
    raise exception 'A product must keep at least one size.'
      using errcode = 'P0001',
        detail = 'MM_SIZE_AT_LEAST_ONE_REQUIRED';
  end if;

  if jsonb_array_length(p_sizes) > 50 then
    raise exception 'A product cannot have more than 50 sizes.'
      using errcode = 'P0001',
        detail = 'MM_SIZE_LIMIT_EXCEEDED';
  end if;

  -- Every reconciliation for one product takes the product lock first. This
  -- serializes concurrent Menu Manager saves before size state is inspected.
  select p.id
  into v_product_id
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'That product was not found.'
      using errcode = 'P0001',
        detail = 'MM_SIZE_PRODUCT_NOT_FOUND',
        hint = 'Refresh Menu Manager and choose an existing product.';
  end if;

  -- Recipe mutation RPCs lock their product_size row first. Holding the same
  -- row locks ensures recipe creation/deletion and size removal cannot race.
  perform 1
  from public.product_sizes ps
  where ps.product_id = p_product_id
  order by ps.id
  for update;

  -- A Supabase session can call this function repeatedly inside one outer
  -- transaction, so recreate the staging table on every call.
  drop table if exists pg_temp.menu_manager_product_size_input;
  create temporary table menu_manager_product_size_input (
    input_order integer primary key,
    size_id uuid unique,
    label text not null,
    normalized_label text not null unique,
    price numeric not null,
    cost numeric,
    sort_order integer not null
  ) on commit drop;

  -- Stage and validate the complete desired state before changing live rows.
  for v_size, v_size_number in
    select value, ordinality::integer
    from jsonb_array_elements(p_sizes) with ordinality
  loop
    if jsonb_typeof(v_size) is distinct from 'object' then
      raise exception 'Product size row % must be an object.', v_size_number
        using errcode = 'P0001',
          detail = 'MM_SIZE_ROW_INVALID';
    end if;

    v_label := btrim(coalesce(v_size ->> 'label', ''));
    if v_label = '' then
      raise exception 'Product size row % needs a label.', v_size_number
        using errcode = 'P0001',
          detail = 'MM_SIZE_LABEL_REQUIRED';
    end if;

    if length(v_label) > 120 then
      raise exception 'Product size row % label must be 120 characters or fewer.', v_size_number
        using errcode = 'P0001',
          detail = 'MM_SIZE_LABEL_TOO_LONG';
    end if;

    v_normalized_label := lower(v_label);
    if exists (
      select 1
      from pg_temp.menu_manager_product_size_input i
      where i.normalized_label = v_normalized_label
    ) then
      raise exception 'Each product size label must be unique.'
        using errcode = 'P0001',
          detail = 'MM_SIZE_LABEL_DUPLICATE',
          hint = 'Rename or remove the duplicate variant.';
    end if;

    v_price_text := nullif(btrim(coalesce(v_size ->> 'price', '')), '');
    begin
      v_price := v_price_text::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Product size row % needs a valid nonnegative price.', v_size_number
        using errcode = 'P0001',
          detail = 'MM_SIZE_PRICE_INVALID';
    end;

    if v_price is null or v_price < 0 then
      raise exception 'Product size row % needs a valid nonnegative price.', v_size_number
        using errcode = 'P0001',
          detail = 'MM_SIZE_PRICE_INVALID';
    end if;

    v_cost_text := nullif(btrim(coalesce(v_size ->> 'cost', '')), '');
    if v_cost_text is null then
      v_cost := null;
    else
      begin
        v_cost := v_cost_text::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Product size row % needs a valid nonnegative cost.', v_size_number
          using errcode = 'P0001',
            detail = 'MM_SIZE_COST_INVALID';
      end;

      if v_cost < 0 then
        raise exception 'Product size row % needs a valid nonnegative cost.', v_size_number
          using errcode = 'P0001',
            detail = 'MM_SIZE_COST_INVALID';
      end if;
    end if;

    v_sort_order_text := nullif(btrim(coalesce(v_size ->> 'sort_order', '')), '');
    begin
      v_sort_order := coalesce(v_sort_order_text::integer, v_size_number - 1);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Product size row % needs a valid sort order.', v_size_number
        using errcode = 'P0001',
          detail = 'MM_SIZE_SORT_ORDER_INVALID';
    end;

    if v_sort_order < 0 then
      raise exception 'Product size row % sort order cannot be negative.', v_size_number
        using errcode = 'P0001',
          detail = 'MM_SIZE_SORT_ORDER_INVALID';
    end if;

    v_size_id_text := nullif(btrim(coalesce(v_size ->> 'id', '')), '');
    v_size_id := null;

    if v_size_id_text is not null then
      if v_size_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Product size row % has an invalid saved id.', v_size_number
          using errcode = 'P0001',
            detail = 'MM_SIZE_ID_INVALID';
      end if;

      v_size_id := v_size_id_text::uuid;

      if exists (
        select 1
        from pg_temp.menu_manager_product_size_input i
        where i.size_id = v_size_id
      ) then
        raise exception 'The same saved product size was submitted more than once.'
          using errcode = 'P0001',
            detail = 'MM_SIZE_ID_DUPLICATE';
      end if;

      if not exists (
        select 1
        from public.product_sizes ps
        where ps.id = v_size_id
          and ps.product_id = p_product_id
      ) then
        raise exception 'A saved product size no longer belongs to this product.'
          using errcode = 'P0001',
            detail = 'MM_SIZE_ID_NOT_FOUND',
            hint = 'Refresh Menu Manager before saving again.';
      end if;
    end if;

    insert into pg_temp.menu_manager_product_size_input (
      input_order,
      size_id,
      label,
      normalized_label,
      price,
      cost,
      sort_order
    ) values (
      v_size_number,
      v_size_id,
      v_label,
      v_normalized_label,
      v_price,
      v_cost,
      v_sort_order
    );
  end loop;

  -- If a successful response was lost and the exact new no-id payload is
  -- retried, adopt the matching row instead of replacing it with another UUID.
  for v_input in
    select *
    from pg_temp.menu_manager_product_size_input
    where size_id is null
    order by input_order
  loop
    select count(*)
    into v_matching_existing_count
    from public.product_sizes ps
    where ps.product_id = p_product_id
      and lower(btrim(ps.label)) = v_input.normalized_label
      and not exists (
        select 1
        from pg_temp.menu_manager_product_size_input i
        where i.size_id = ps.id
      );

    if v_matching_existing_count > 1 then
      raise exception 'Existing product sizes contain an ambiguous duplicate label.'
        using errcode = 'P0001',
          detail = 'MM_SIZE_EXISTING_LABEL_AMBIGUOUS',
          hint = 'Review duplicate product size labels before saving.';
    end if;

    if v_matching_existing_count = 1 then
      select ps.*
      into v_existing_size
      from public.product_sizes ps
      where ps.product_id = p_product_id
        and lower(btrim(ps.label)) = v_input.normalized_label
        and not exists (
          select 1
          from pg_temp.menu_manager_product_size_input i
          where i.size_id = ps.id
        )
      limit 1;

      if v_existing_size.label is distinct from v_input.label
        or v_existing_size.price is distinct from v_input.price
        or v_existing_size.cost is distinct from v_input.cost
        or v_existing_size.sort_order is distinct from v_input.sort_order
      then
        raise exception 'A size named "%" already exists with different saved values.', v_input.label
          using errcode = 'P0001',
            detail = 'MM_SIZE_NEW_LABEL_CONFLICT',
            hint = 'Refresh Menu Manager before saving again.';
      end if;

      update pg_temp.menu_manager_product_size_input
      set size_id = v_existing_size.id
      where input_order = v_input.input_order;
    end if;
  end loop;

  -- Check every removal candidate before performing any update, insert, or
  -- delete. A protected candidate aborts the entire reconciliation unchanged.
  select ps.id, ps.label
  into v_removed_size
  from public.product_sizes ps
  join public.inventory_recipes r
    on r.product_size_id = ps.id
  where ps.product_id = p_product_id
    and not exists (
      select 1
      from pg_temp.menu_manager_product_size_input i
      where i.size_id = ps.id
    )
  order by ps.sort_order, ps.label, ps.id
  limit 1;

  if found then
    raise exception 'The size "%" is used by a recipe and cannot be removed yet.', v_removed_size.label
      using errcode = 'P0001',
        detail = 'MM_SIZE_RECIPE_PROTECTED',
        hint = 'Remove the recipe through the Recipes workflow before removing this size.';
  end if;

  update public.product_sizes ps
  set
    label = i.label,
    price = i.price,
    cost = i.cost,
    sort_order = i.sort_order
  from pg_temp.menu_manager_product_size_input i
  where i.size_id = ps.id
    and ps.product_id = p_product_id
    and (
      ps.label is distinct from i.label
      or ps.price is distinct from i.price
      or ps.cost is distinct from i.cost
      or ps.sort_order is distinct from i.sort_order
    );

  get diagnostics v_updated_count = row_count;

  for v_input in
    select *
    from pg_temp.menu_manager_product_size_input
    where size_id is null
    order by input_order
  loop
    begin
      insert into public.product_sizes (
        product_id,
        label,
        price,
        cost,
        sort_order
      ) values (
        p_product_id,
        v_input.label,
        v_input.price,
        v_input.cost,
        v_input.sort_order
      )
      returning id into v_inserted_size_id;
    exception when unique_violation then
      raise exception 'A size named "%" already exists.', v_input.label
        using errcode = 'P0001',
          detail = 'MM_SIZE_NEW_LABEL_CONFLICT',
          hint = 'Refresh Menu Manager before saving again.';
    end;

    update pg_temp.menu_manager_product_size_input
    set size_id = v_inserted_size_id
    where input_order = v_input.input_order;

    v_inserted_count := v_inserted_count + 1;
  end loop;

  delete from public.product_sizes ps
  where ps.product_id = p_product_id
    and not exists (
      select 1
      from pg_temp.menu_manager_product_size_input i
      where i.size_id = ps.id
    );

  get diagnostics v_deleted_count = row_count;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ps.id,
        'product_id', ps.product_id,
        'label', ps.label,
        'price', ps.price,
        'cost', ps.cost,
        'sort_order', ps.sort_order
      )
      order by ps.sort_order, ps.label, ps.id
    ),
    '[]'::jsonb
  )
  into v_result_sizes
  from public.product_sizes ps
  where ps.product_id = p_product_id;

  return jsonb_build_object(
    'ok', true,
    'operation', 'reconcile_product_sizes',
    'product_id', p_product_id,
    'updated_count', v_updated_count,
    'inserted_count', v_inserted_count,
    'deleted_count', v_deleted_count,
    'sizes', v_result_sizes
  );
end;
$$;

revoke all on function public.menu_manager_reconcile_product_sizes(uuid, jsonb) from public;
revoke execute on function public.menu_manager_reconcile_product_sizes(uuid, jsonb) from anon;
grant execute on function public.menu_manager_reconcile_product_sizes(uuid, jsonb) to authenticated;

comment on function public.menu_manager_reconcile_product_sizes(uuid, jsonb) is
  'Owner-only atomic product-size reconciliation. Preserves saved ids, serializes per product, and blocks recipe-backed removal.';

commit;
