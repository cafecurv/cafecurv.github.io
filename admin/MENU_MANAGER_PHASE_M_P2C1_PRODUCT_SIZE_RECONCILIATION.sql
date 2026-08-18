-- CURV Menu Manager Phase M-P2C.1
-- ID-preserving product size reconciliation
--
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- - Update saved product_sizes rows by id instead of deleting and recreating them.
-- - Insert genuinely new sizes without changing existing size ids.
-- - Delete removed sizes only when no inventory recipe references them.
-- - Keep all size changes for one product atomic and serialized.

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
  v_size_number integer := 0;
  v_size_id_text text;
  v_size_id uuid;
  v_label text;
  v_price_text text;
  v_price numeric;
  v_cost_text text;
  v_cost numeric;
  v_sort_order_text text;
  v_sort_order integer;
  v_existing_size public.product_sizes%rowtype;
  v_inserted_size_id uuid;
  v_removed_size record;
  v_original_size_ids uuid[] := array[]::uuid[];
  v_seen_existing_ids uuid[] := array[]::uuid[];
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

  -- Lock every existing size before validating or mutating. Recipe mutation
  -- RPCs lock the same size row, so recipe creation and size removal serialize.
  perform 1
  from public.product_sizes ps
  where ps.product_id = p_product_id
  for update;

  select coalesce(array_agg(ps.id order by ps.id), array[]::uuid[])
  into v_original_size_ids
  from public.product_sizes ps
  where ps.product_id = p_product_id;

  for v_size in
    select value
    from jsonb_array_elements(p_sizes)
  loop
    v_size_number := v_size_number + 1;

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
    if v_size_id_text is null then
      insert into public.product_sizes (
        product_id,
        label,
        price,
        cost,
        sort_order
      ) values (
        p_product_id,
        v_label,
        v_price,
        v_cost,
        v_sort_order
      )
      returning id into v_inserted_size_id;

      v_inserted_count := v_inserted_count + 1;
      continue;
    end if;

    begin
      v_size_id := v_size_id_text::uuid;
    exception when invalid_text_representation then
      raise exception 'Product size row % has an invalid saved id.', v_size_number
        using errcode = 'P0001',
          detail = 'MM_SIZE_ID_INVALID';
    end;

    if v_size_id = any(v_seen_existing_ids) then
      raise exception 'The same saved product size was submitted more than once.'
        using errcode = 'P0001',
          detail = 'MM_SIZE_ID_DUPLICATE';
    end if;

    select ps.*
    into v_existing_size
    from public.product_sizes ps
    where ps.id = v_size_id
      and ps.product_id = p_product_id;

    if not found then
      raise exception 'A saved product size no longer belongs to this product.'
        using errcode = 'P0001',
          detail = 'MM_SIZE_ID_NOT_FOUND',
          hint = 'Refresh Menu Manager before saving again.';
    end if;

    update public.product_sizes
    set
      label = v_label,
      price = v_price,
      cost = v_cost,
      sort_order = v_sort_order
    where id = v_size_id
      and product_id = p_product_id;

    v_seen_existing_ids := array_append(v_seen_existing_ids, v_size_id);
    v_updated_count := v_updated_count + 1;
  end loop;

  for v_removed_size in
    select ps.id, ps.label
    from public.product_sizes ps
    where ps.product_id = p_product_id
      and ps.id = any(v_original_size_ids)
      and not (ps.id = any(v_seen_existing_ids))
    order by ps.sort_order, ps.label, ps.id
  loop
    if exists (
      select 1
      from public.inventory_recipes r
      where r.product_size_id = v_removed_size.id
    ) then
      raise exception 'The size "%" is used by a recipe and cannot be removed yet.', v_removed_size.label
        using errcode = 'P0001',
          detail = 'MM_SIZE_RECIPE_PROTECTED',
          hint = 'Remove the recipe through the Recipes workflow before removing this size.';
    end if;

    delete from public.product_sizes
    where id = v_removed_size.id
      and product_id = p_product_id;

    v_deleted_count := v_deleted_count + 1;
  end loop;

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
  'Owner-only atomic product size reconciliation. Preserves submitted size ids and blocks deletion of recipe-backed sizes.';

commit;
