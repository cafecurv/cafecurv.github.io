-- CURV Control Inventory Management
-- Phase I10D.1 Recipe Mutation Optimistic-Concurrency Patch
--
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- Replace the recipe mutation RPCs with optimistic-concurrency contracts so
-- stale edit/delete drawers cannot overwrite or delete newer recipe state.
--
-- This patch does not change recipe tables, recipe views, inventory stock
-- logic, menu objects, POS logic, or public availability behavior.

begin;

-- =========================================================
-- Signature Safety
-- =========================================================
-- Drop old and new signatures before recreating them so PostgREST cannot see
-- ambiguous overloads on rerun.

drop function if exists public.inventory_replace_recipe(uuid, jsonb, text);
drop function if exists public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz);

drop function if exists public.inventory_delete_recipe(uuid);
drop function if exists public.inventory_delete_recipe(uuid, uuid, timestamptz);

-- =========================================================
-- Dedicated Recipe Updated-At Trigger
-- =========================================================
-- inventory_recipes needs a mutation token that advances even when multiple
-- recipe edits happen inside one transaction. The shared public.set_updated_at()
-- uses now(), which is transaction-stable, so this table gets a dedicated
-- trigger helper that guarantees new.updated_at > old.updated_at.

create or replace function public.set_inventory_recipe_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := greatest(
    clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

revoke all on function public.set_inventory_recipe_updated_at() from public;
revoke execute on function public.set_inventory_recipe_updated_at() from anon;
revoke execute on function public.set_inventory_recipe_updated_at() from authenticated;

drop trigger if exists set_inventory_recipes_updated_at on public.inventory_recipes;
create trigger set_inventory_recipes_updated_at
before update on public.inventory_recipes
for each row
execute function public.set_inventory_recipe_updated_at();

-- =========================================================
-- inventory_replace_recipe
-- =========================================================
-- Expected-state semantics:
-- - p_expected_recipe_id null and p_expected_updated_at null means the caller
--   expects no recipe to exist for the product size.
-- - both expectation values present means the caller expects that exact recipe
--   id and updated_at token to still be current.
-- - exactly one expectation value present is invalid.
--
-- The product_size row remains locked first, so mutations for one sellable size
-- are serialized before current recipe state is checked.

create function public.inventory_replace_recipe(
  p_product_size_id uuid,
  p_lines jsonb,
  p_notes text default null,
  p_expected_recipe_id uuid default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product_size public.product_sizes%rowtype;
  v_current_recipe_id uuid;
  v_current_updated_at timestamptz;
  v_recipe_id uuid;
  v_recipe_updated_at timestamptz;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_line_count integer;
  v_line jsonb;
  v_line_number integer;
  v_item_id_text text;
  v_item_id uuid;
  v_item public.inventory_items%rowtype;
  v_quantity_text text;
  v_quantity_integer_text text;
  v_quantity_integer_normalized text;
  v_quantity numeric;
  v_sort_text text;
  v_sort_order_normalized text;
  v_sort_order integer;
begin
  if v_actor is null then
    raise exception 'Please sign in before changing recipes.'
      using errcode = 'P0001',
        detail = 'INV_AUTH_REQUIRED',
        hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can change recipes.'
      using errcode = 'P0001',
        detail = 'INV_ADMIN_REQUIRED',
        hint = 'Use an approved owner account.';
  end if;

  if p_product_size_id is null then
    raise exception 'Choose a product size for this recipe.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_PRODUCT_SIZE_REQUIRED',
        hint = 'Refresh Recipes and choose a sellable product size.';
  end if;

  select *
  into v_product_size
  from public.product_sizes
  where id = p_product_size_id
  for update;

  if not found then
    raise exception 'That product size was not found.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_PRODUCT_SIZE_NOT_FOUND',
        hint = 'Refresh Recipes and choose an existing product size.';
  end if;

  select id, updated_at
  into v_current_recipe_id, v_current_updated_at
  from public.inventory_recipes
  where product_size_id = p_product_size_id
  for update;

  if (
    (p_expected_recipe_id is null and p_expected_updated_at is not null)
    or (p_expected_recipe_id is not null and p_expected_updated_at is null)
  ) then
    raise exception 'The recipe edit token is incomplete.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_EXPECTATION_INVALID',
        hint = 'Reload Recipes and open the editor again.';
  end if;

  if p_expected_recipe_id is null and p_expected_updated_at is null then
    if v_current_recipe_id is not null then
      raise exception 'This recipe was created or changed in another session.'
        using errcode = 'P0001',
          detail = 'INV_RECIPE_CONFLICT',
          hint = 'Reload Recipes before saving again.';
    end if;
  elsif v_current_recipe_id is distinct from p_expected_recipe_id
    or v_current_updated_at is distinct from p_expected_updated_at then
    raise exception 'This recipe was changed or removed in another session.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_CONFLICT',
        hint = 'Reload the recipe before saving again.';
  end if;

  if v_notes is not null and length(v_notes) > 500 then
    raise exception 'Recipe notes must be 500 characters or fewer.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_NOTES_TOO_LONG',
        hint = 'Shorten the recipe notes and try again.';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Recipe lines must be an array.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_LINES_INVALID',
        hint = 'Send one recipe line per ingredient.';
  end if;

  v_line_count := jsonb_array_length(p_lines);

  if v_line_count = 0 then
    raise exception 'Add at least one ingredient to this recipe.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_LINES_REQUIRED',
        hint = 'Add an ingredient and quantity before saving.';
  end if;

  if v_line_count > 100 then
    raise exception 'Recipes can have at most 100 ingredients.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_TOO_MANY_LINES',
        hint = 'Reduce the recipe to 100 ingredient lines or fewer.';
  end if;

  drop table if exists pg_temp.inventory_recipe_line_input;
  create temp table inventory_recipe_line_input (
    inventory_item_id uuid not null,
    quantity_required numeric(14,3) not null,
    sort_order integer not null,
    constraint inventory_recipe_line_input_inventory_item_unique
      unique (inventory_item_id)
  ) on commit drop;

  for v_line, v_line_number in
    select value, ordinality::integer
    from jsonb_array_elements(p_lines) with ordinality
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Recipe line % is not valid.', v_line_number
        using errcode = 'P0001',
          detail = 'INV_RECIPE_LINE_INVALID',
          hint = 'Each recipe line must include an inventory item and quantity.';
    end if;

    v_item_id_text := nullif(btrim(coalesce(v_line ->> 'inventory_item_id', '')), '');

    if v_item_id_text is null
      or v_item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      raise exception 'Recipe line % has an invalid inventory item.', v_line_number
        using errcode = 'P0001',
          detail = 'INV_RECIPE_LINE_INVALID',
          hint = 'Choose an inventory item from the list.';
    end if;

    v_item_id := v_item_id_text::uuid;

    select *
    into v_item
    from public.inventory_items
    where id = v_item_id
    for share;

    if not found then
      raise exception 'Recipe line % uses an inventory item that was not found.', v_line_number
        using errcode = 'P0001',
          detail = 'INV_RECIPE_ITEM_NOT_FOUND',
          hint = 'Refresh Recipes and choose an existing inventory item.';
    end if;

    if not v_item.is_active then
      raise exception 'Recipe line % uses an archived inventory item.', v_line_number
        using errcode = 'P0001',
          detail = 'INV_RECIPE_ITEM_INACTIVE',
          hint = 'Remove the archived item or reactivate it before saving.';
    end if;

    v_quantity_text := nullif(btrim(coalesce(v_line ->> 'quantity_required', '')), '');

    if v_quantity_text is null
      or v_quantity_text !~ '^[0-9]+(\.[0-9]+)?$'
    then
      raise exception 'Recipe line % needs a quantity greater than zero.', v_line_number
        using errcode = 'P0001',
          detail = 'INV_RECIPE_INVALID_QUANTITY',
          hint = 'Enter a positive ingredient quantity.';
    end if;

    if v_quantity_text !~ '^[0-9]+(\.[0-9]{1,3})?$' then
      raise exception 'Recipe line % quantity can use up to three decimal places.', v_line_number
        using errcode = 'P0001',
          detail = 'INV_RECIPE_QUANTITY_SCALE',
          hint = 'Round the quantity to three decimal places or fewer.';
    end if;

    v_quantity_integer_text := split_part(v_quantity_text, '.', 1);
    v_quantity_integer_normalized := regexp_replace(v_quantity_integer_text, '^0+', '');
    if v_quantity_integer_normalized = '' then
      v_quantity_integer_normalized := '0';
    end if;

    if length(v_quantity_integer_normalized) > 11 then
      raise exception 'Recipe line % needs a quantity within the allowed range.', v_line_number
        using errcode = 'P0001',
          detail = 'INV_RECIPE_INVALID_QUANTITY',
          hint = 'Enter a smaller ingredient quantity.';
    end if;

    begin
      v_quantity := v_quantity_text::numeric;
    exception
      when numeric_value_out_of_range or invalid_text_representation then
        raise exception 'Recipe line % needs a quantity within the allowed range.', v_line_number
          using errcode = 'P0001',
            detail = 'INV_RECIPE_INVALID_QUANTITY',
            hint = 'Enter a smaller ingredient quantity.';
    end;

    if v_quantity <= 0 then
      raise exception 'Recipe line % needs a quantity greater than zero.', v_line_number
        using errcode = 'P0001',
          detail = 'INV_RECIPE_INVALID_QUANTITY',
          hint = 'Enter a positive ingredient quantity.';
    end if;

    v_sort_text := nullif(btrim(coalesce(v_line ->> 'sort_order', '')), '');
    if v_sort_text is null then
      v_sort_order := v_line_number - 1;
    elsif v_sort_text !~ '^[0-9]+$' then
      raise exception 'Recipe line % has an invalid sort order.', v_line_number
        using errcode = 'P0001',
          detail = 'INV_RECIPE_INVALID_SORT_ORDER',
          hint = 'Sort order must be zero or higher.';
    else
      v_sort_order_normalized := regexp_replace(v_sort_text, '^0+', '');
      if v_sort_order_normalized = '' then
        v_sort_order_normalized := '0';
      end if;

      if length(v_sort_order_normalized) > 10
        or (
          length(v_sort_order_normalized) = 10
          and v_sort_order_normalized > '2147483647'
        )
      then
        raise exception 'Recipe line % has an invalid sort order.', v_line_number
          using errcode = 'P0001',
            detail = 'INV_RECIPE_INVALID_SORT_ORDER',
            hint = 'Sort order must be zero or higher.';
      end if;

      begin
        v_sort_order := v_sort_text::integer;
      exception
        when numeric_value_out_of_range or invalid_text_representation then
          raise exception 'Recipe line % has an invalid sort order.', v_line_number
            using errcode = 'P0001',
              detail = 'INV_RECIPE_INVALID_SORT_ORDER',
              hint = 'Sort order must be zero or higher.';
      end;
    end if;

    begin
      insert into inventory_recipe_line_input (
        inventory_item_id,
        quantity_required,
        sort_order
      ) values (
        v_item_id,
        v_quantity::numeric(14,3),
        v_sort_order
      );
    exception
      when unique_violation then
        raise exception 'Each ingredient can appear only once in a recipe.'
          using errcode = 'P0001',
            detail = 'INV_RECIPE_DUPLICATE_ITEM',
            hint = 'Combine duplicate ingredient quantities into one line.';
      when numeric_value_out_of_range then
        raise exception 'Recipe line % needs a quantity within the allowed range.', v_line_number
          using errcode = 'P0001',
            detail = 'INV_RECIPE_INVALID_QUANTITY',
            hint = 'Enter a smaller ingredient quantity.';
    end;
  end loop;

  insert into public.inventory_recipes (
    product_size_id,
    notes,
    created_by,
    updated_by
  ) values (
    p_product_size_id,
    v_notes,
    v_actor,
    v_actor
  )
  on conflict (product_size_id) do update
  set
    notes = excluded.notes,
    updated_by = excluded.updated_by
  returning id, updated_at into v_recipe_id, v_recipe_updated_at;

  delete from public.inventory_recipe_lines
  where recipe_id = v_recipe_id;

  insert into public.inventory_recipe_lines (
    recipe_id,
    inventory_item_id,
    quantity_required,
    sort_order,
    created_by,
    updated_by
  )
  select
    v_recipe_id,
    inventory_item_id,
    quantity_required,
    sort_order,
    v_actor,
    v_actor
  from inventory_recipe_line_input
  order by sort_order, inventory_item_id;

  return jsonb_build_object(
    'ok', true,
    'operation', 'replace_recipe',
    'recipe_id', v_recipe_id,
    'product_size_id', p_product_size_id,
    'ingredient_count', v_line_count,
    'updated_at', v_recipe_updated_at
  );
end;
$$;

revoke all on function public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz) from public;
revoke execute on function public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz) from anon;
grant execute on function public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz) to authenticated;

comment on function public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz) is
  'Controlled owner/admin RPC that atomically creates or replaces one product-size recipe using optimistic concurrency tokens. Does not deduct inventory.';

-- =========================================================
-- inventory_delete_recipe
-- =========================================================
-- Deletes recipe configuration only. If no recipe exists, deletion is an
-- idempotent success with deleted=false. Existing recipes require the current
-- recipe id and updated_at token so stale drawers cannot delete newer edits or
-- recreated recipes.

create function public.inventory_delete_recipe(
  p_product_size_id uuid,
  p_expected_recipe_id uuid default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product_size public.product_sizes%rowtype;
  v_current_recipe_id uuid;
  v_current_updated_at timestamptz;
  v_recipe_id uuid;
  v_deleted boolean := false;
begin
  if v_actor is null then
    raise exception 'Please sign in before changing recipes.'
      using errcode = 'P0001',
        detail = 'INV_AUTH_REQUIRED',
        hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can change recipes.'
      using errcode = 'P0001',
        detail = 'INV_ADMIN_REQUIRED',
        hint = 'Use an approved owner account.';
  end if;

  if p_product_size_id is null then
    raise exception 'Choose a product size for this recipe.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_PRODUCT_SIZE_REQUIRED',
        hint = 'Refresh Recipes and choose a sellable product size.';
  end if;

  select *
  into v_product_size
  from public.product_sizes
  where id = p_product_size_id
  for update;

  if not found then
    raise exception 'That product size was not found.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_PRODUCT_SIZE_NOT_FOUND',
        hint = 'Refresh Recipes and choose an existing product size.';
  end if;

  select id, updated_at
  into v_current_recipe_id, v_current_updated_at
  from public.inventory_recipes
  where product_size_id = p_product_size_id
  for update;

  if v_current_recipe_id is null then
    return jsonb_build_object(
      'ok', true,
      'operation', 'delete_recipe',
      'product_size_id', p_product_size_id,
      'recipe_id', null,
      'deleted', false
    );
  end if;

  if p_expected_recipe_id is null or p_expected_updated_at is null then
    raise exception 'Reload the recipe before deleting it.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_EXPECTATION_REQUIRED',
        hint = 'Delete requires the current recipe edit token.';
  end if;

  if v_current_recipe_id is distinct from p_expected_recipe_id
    or v_current_updated_at is distinct from p_expected_updated_at then
    raise exception 'This recipe was changed in another session.'
      using errcode = 'P0001',
        detail = 'INV_RECIPE_CONFLICT',
        hint = 'Reload the recipe before deleting it.';
  end if;

  delete from public.inventory_recipes
  where product_size_id = p_product_size_id
    and id = v_current_recipe_id
  returning id into v_recipe_id;

  v_deleted := v_recipe_id is not null;

  return jsonb_build_object(
    'ok', true,
    'operation', 'delete_recipe',
    'product_size_id', p_product_size_id,
    'recipe_id', v_recipe_id,
    'deleted', v_deleted
  );
end;
$$;

revoke all on function public.inventory_delete_recipe(uuid, uuid, timestamptz) from public;
revoke execute on function public.inventory_delete_recipe(uuid, uuid, timestamptz) from anon;
grant execute on function public.inventory_delete_recipe(uuid, uuid, timestamptz) to authenticated;

comment on function public.inventory_delete_recipe(uuid, uuid, timestamptz) is
  'Controlled owner/admin RPC that deletes recipe configuration for one product size using optimistic concurrency tokens. Does not delete menu or inventory records.';

commit;
