-- CURV Control Inventory Management
-- Phase I5B Create Item RPC
--
-- Scope:
-- - Replace active-only item-name uniqueness with global normalized-name
--   uniqueness across active and archived inventory items.
-- - Add public.inventory_create_item(...) for creating inventory master records.
-- - No stock batches, movements, opening balances, update/archive/reactivate
--   flows, RLS policy changes, or UI changes are included in this phase.

begin;

-- =========================================================
-- Global Inventory Item Name Uniqueness
-- =========================================================
-- Existing Phase I2 protection was active-only:
-- inventory_items_active_name_ci_unique_idx on lower(btrim(name))
-- where is_active = true.
--
-- Phase I5B requires names to remain unique across active and archived rows.
-- Detect duplicates first so the active-only index is not dropped when a
-- migration conflict needs owner review.

do $$
declare
  v_duplicate_count integer;
  v_duplicate_examples text;
begin
  select count(*)
  into v_duplicate_count
  from (
    select lower(btrim(name)) as normalized_name
    from public.inventory_items
    group by lower(btrim(name))
    having count(*) > 1
  ) duplicates;

  if v_duplicate_count > 0 then
    select string_agg(normalized_name, ', ' order by normalized_name)
    into v_duplicate_examples
    from (
      select lower(btrim(name)) as normalized_name
      from public.inventory_items
      group by lower(btrim(name))
      having count(*) > 1
      order by lower(btrim(name))
      limit 10
    ) examples;

    raise exception 'Cannot replace inventory item name index because duplicate normalized names already exist.'
      using errcode = 'P0001',
        detail = 'INV_ITEM_NAME_DUPLICATES_EXIST',
        hint = 'Resolve duplicate inventory item names first. Examples: ' || coalesce(v_duplicate_examples, 'none');
  end if;
end;
$$;

drop index if exists public.inventory_items_active_name_ci_unique_idx;
drop index if exists public.inventory_items_name_ci_unique_idx;

create unique index inventory_items_name_ci_unique_idx
  on public.inventory_items (lower(btrim(name)));

-- =========================================================
-- inventory_create_item
-- =========================================================

drop function if exists public.inventory_create_item(
  text,
  uuid,
  uuid,
  numeric,
  boolean,
  text
);

create function public.inventory_create_item(
  p_name text,
  p_category_id uuid,
  p_unit_id uuid,
  p_low_stock_threshold numeric default 0,
  p_track_expiry boolean default false,
  p_storage_location text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_category public.inventory_categories%rowtype;
  v_unit public.inventory_units%rowtype;
  v_threshold numeric := coalesce(p_low_stock_threshold, 0);
  v_threshold_143 numeric(14,3);
  v_track_expiry boolean := coalesce(p_track_expiry, false);
  v_storage_location text := nullif(btrim(coalesce(p_storage_location, '')), '');
  v_item_id uuid;
  v_constraint_name text;
begin
  if v_actor is null then
    raise exception 'Please sign in before adding inventory items.'
      using errcode = 'P0001',
        detail = 'INV_AUTH_REQUIRED',
        hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can add inventory items.'
      using errcode = 'P0001',
        detail = 'INV_ADMIN_REQUIRED',
        hint = 'Use an approved owner account.';
  end if;

  if v_name = '' then
    raise exception 'Item name is required.'
      using errcode = 'P0001',
        detail = 'INV_NAME_REQUIRED',
        hint = 'Enter an item name.';
  end if;

  if length(v_name) > 100 then
    raise exception 'Item name must be 100 characters or fewer.'
      using errcode = 'P0001',
        detail = 'INV_NAME_TOO_LONG',
        hint = 'Shorten the item name and try again.';
  end if;

  if p_category_id is null then
    raise exception 'Choose a category for this item.'
      using errcode = 'P0001',
        detail = 'INV_CATEGORY_REQUIRED',
        hint = 'Select a category from the list.';
  end if;

  select *
  into v_category
  from public.inventory_categories
  where id = p_category_id
  for share;

  if not found then
    raise exception 'That category doesn''t exist.'
      using errcode = 'P0001',
        detail = 'INV_CATEGORY_NOT_FOUND',
        hint = 'Refresh the page and try again.';
  end if;

  if not v_category.is_active then
    raise exception 'That category is no longer active.'
      using errcode = 'P0001',
        detail = 'INV_CATEGORY_INACTIVE',
        hint = 'Choose a different category.';
  end if;

  if p_unit_id is null then
    raise exception 'Choose a unit for this item.'
      using errcode = 'P0001',
        detail = 'INV_UNIT_REQUIRED',
        hint = 'Select a unit from the list.';
  end if;

  select *
  into v_unit
  from public.inventory_units
  where id = p_unit_id
  for share;

  if not found then
    raise exception 'That unit doesn''t exist.'
      using errcode = 'P0001',
        detail = 'INV_UNIT_NOT_FOUND',
        hint = 'Refresh the page and try again.';
  end if;

  if not v_unit.is_active then
    raise exception 'That unit is no longer active.'
      using errcode = 'P0001',
        detail = 'INV_UNIT_INACTIVE',
        hint = 'Choose a different unit.';
  end if;

  if v_threshold < 0 then
    raise exception 'Low stock threshold cannot be negative.'
      using errcode = 'P0001',
        detail = 'INV_INVALID_THRESHOLD',
        hint = 'Enter zero or a positive number.';
  end if;

  if v_threshold <> trunc(v_threshold, 3) then
    raise exception 'Low stock threshold can use up to three decimal places.'
      using errcode = 'P0001',
        detail = 'INV_THRESHOLD_SCALE',
        hint = 'Round the quantity to three decimal places or fewer.';
  end if;

  v_threshold_143 := v_threshold::numeric(14,3);

  if v_storage_location is not null and length(v_storage_location) > 100 then
    raise exception 'Storage location must be 100 characters or fewer.'
      using errcode = 'P0001',
        detail = 'INV_STORAGE_TOO_LONG',
        hint = 'Shorten the location and try again.';
  end if;

  if exists (
    select 1
    from public.inventory_items i
    where lower(btrim(i.name)) = lower(v_name)
  ) then
    raise exception 'An inventory item with that name already exists.'
      using errcode = 'P0001',
        detail = 'INV_DUPLICATE_ITEM_NAME',
        hint = 'Use a different item name.';
  end if;

  begin
    insert into public.inventory_items (
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
    ) values (
      v_name,
      p_category_id,
      p_unit_id,
      v_threshold_143,
      v_track_expiry,
      v_storage_location,
      null,
      true,
      v_actor,
      v_actor
    )
    returning id into v_item_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = CONSTRAINT_NAME;
      if v_constraint_name = 'inventory_items_name_ci_unique_idx' then
        raise exception 'An inventory item with that name already exists.'
          using errcode = 'P0001',
            detail = 'INV_DUPLICATE_ITEM_NAME',
            hint = 'Use a different item name.';
      end if;
      raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'operation', 'create_item',
    'item_id', v_item_id,
    'item_name', v_name,
    'category_id', v_category.id,
    'category_name', v_category.name,
    'unit_id', v_unit.id,
    'unit_name', v_unit.name,
    'unit_abbreviation', v_unit.abbreviation,
    'track_expiry', v_track_expiry,
    'low_stock_threshold', v_threshold_143,
    'storage_location', v_storage_location,
    'is_active', true
  );
end;
$$;

revoke all on function public.inventory_create_item(text, uuid, uuid, numeric, boolean, text) from public;
revoke execute on function public.inventory_create_item(text, uuid, uuid, numeric, boolean, text) from anon;
grant execute on function public.inventory_create_item(text, uuid, uuid, numeric, boolean, text) to authenticated;

comment on function public.inventory_create_item(text, uuid, uuid, numeric, boolean, text) is
  'Controlled owner/admin RPC for creating active inventory item master records only. Does not create stock batches or movements.';

commit;
