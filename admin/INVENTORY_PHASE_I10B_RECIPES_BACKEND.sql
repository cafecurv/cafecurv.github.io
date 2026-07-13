-- CURV Control Inventory Management
-- Phase I10B Recipes Backend SQL Draft
--
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- Add owner/admin-only recipe configuration for sellable product-size rows.
-- Recipes connect menu variants to inventory ingredients but do not perform
-- POS deduction, order deduction, costing, sold-out automation, or public
-- menu availability changes in this phase.
--
-- Dependencies:
-- public.products, public.product_sizes, public.categories
-- public.inventory_items, public.inventory_units, public.inventory_stock_summary
-- public.admin_profiles and public.is_admin()
-- public.set_updated_at()

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- Recipe Headers
-- =========================================================
-- One recipe belongs to one sellable product-size row. Product-size deletion
-- cascades to its recipe because recipes are configuration, not historical
-- sales records. Publish, unpublish, sold-out, and availability changes do not
-- delete products or product sizes, so they preserve recipes.

create table if not exists public.inventory_recipes (
  id uuid primary key default gen_random_uuid(),
  product_size_id uuid not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.inventory_recipes
  drop constraint if exists inventory_recipes_product_size_fk;

alter table public.inventory_recipes
  add constraint inventory_recipes_product_size_fk
  foreign key (product_size_id)
  references public.product_sizes(id)
  on delete cascade;

alter table public.inventory_recipes
  drop constraint if exists inventory_recipes_product_size_id_unique;

alter table public.inventory_recipes
  add constraint inventory_recipes_product_size_id_unique
  unique (product_size_id);

alter table public.inventory_recipes
  drop constraint if exists inventory_recipes_notes_length_check;

alter table public.inventory_recipes
  add constraint inventory_recipes_notes_length_check
  check (notes is null or length(notes) <= 500);

create index if not exists inventory_recipes_updated_at_idx
  on public.inventory_recipes (updated_at desc);

drop trigger if exists set_inventory_recipes_updated_at on public.inventory_recipes;
create trigger set_inventory_recipes_updated_at
before update on public.inventory_recipes
for each row
execute function public.set_updated_at();

comment on table public.inventory_recipes is
  'Owner/admin recipe headers. One recipe per product_sizes row. Product-size deletion cascades to this configuration record.';

comment on column public.inventory_recipes.product_size_id is
  'Sellable menu variant that this recipe produces. Normal product availability and publishing changes preserve this row.';

comment on column public.inventory_recipes.notes is
  'Optional owner/admin recipe notes, limited to 500 characters.';

-- =========================================================
-- Recipe Lines
-- =========================================================
-- Do not store a second unit. quantity_required is always expressed in the
-- referenced inventory item base unit.

create table if not exists public.inventory_recipe_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null,
  inventory_item_id uuid not null,
  quantity_required numeric(14,3) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.inventory_recipe_lines
  drop constraint if exists inventory_recipe_lines_recipe_fk;

alter table public.inventory_recipe_lines
  add constraint inventory_recipe_lines_recipe_fk
  foreign key (recipe_id)
  references public.inventory_recipes(id)
  on delete cascade;

alter table public.inventory_recipe_lines
  drop constraint if exists inventory_recipe_lines_inventory_item_fk;

alter table public.inventory_recipe_lines
  add constraint inventory_recipe_lines_inventory_item_fk
  foreign key (inventory_item_id)
  references public.inventory_items(id)
  on delete restrict;

alter table public.inventory_recipe_lines
  drop constraint if exists inventory_recipe_lines_quantity_required_positive;

alter table public.inventory_recipe_lines
  add constraint inventory_recipe_lines_quantity_required_positive
  check (quantity_required > 0);

alter table public.inventory_recipe_lines
  drop constraint if exists inventory_recipe_lines_sort_order_nonnegative;

alter table public.inventory_recipe_lines
  add constraint inventory_recipe_lines_sort_order_nonnegative
  check (sort_order >= 0);

alter table public.inventory_recipe_lines
  drop constraint if exists inventory_recipe_lines_recipe_item_unique;

alter table public.inventory_recipe_lines
  add constraint inventory_recipe_lines_recipe_item_unique
  unique (recipe_id, inventory_item_id);

create index if not exists inventory_recipe_lines_recipe_sort_idx
  on public.inventory_recipe_lines (recipe_id, sort_order, id);

create index if not exists inventory_recipe_lines_inventory_item_idx
  on public.inventory_recipe_lines (inventory_item_id);

drop trigger if exists set_inventory_recipe_lines_updated_at on public.inventory_recipe_lines;
create trigger set_inventory_recipe_lines_updated_at
before update on public.inventory_recipe_lines
for each row
execute function public.set_updated_at();

comment on table public.inventory_recipe_lines is
  'Owner/admin recipe ingredient lines. Quantities are stored in each inventory item base unit.';

comment on column public.inventory_recipe_lines.quantity_required is
  'Ingredient amount required for one product-size serving, expressed in the referenced inventory item base unit.';

-- =========================================================
-- Row Level Security and Table Grants
-- =========================================================
-- Authenticated browser clients receive SELECT only, and RLS limits that read
-- to CURV owners/admins. Direct browser INSERT/UPDATE/DELETE is not granted.
-- Mutations are handled by SECURITY DEFINER RPCs below.

alter table public.inventory_recipes enable row level security;
alter table public.inventory_recipe_lines enable row level security;

drop policy if exists "Owners can read inventory recipes" on public.inventory_recipes;
create policy "Owners can read inventory recipes"
  on public.inventory_recipes
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can read inventory recipe lines" on public.inventory_recipe_lines;
create policy "Owners can read inventory recipe lines"
  on public.inventory_recipe_lines
  for select
  to authenticated
  using (public.is_admin());

revoke all on public.inventory_recipes from anon, authenticated;
revoke all on public.inventory_recipe_lines from anon, authenticated;

grant select on public.inventory_recipes to authenticated;
grant select on public.inventory_recipe_lines to authenticated;

-- =========================================================
-- Admin Read Views
-- =========================================================
-- These views are for the future authenticated owner/admin Recipes UI. They are
-- security-invoker views and also include public.is_admin() so non-admin
-- authenticated users cannot retrieve recipe data through broader product
-- public-read policies.

create or replace view public.inventory_recipe_line_details
with (security_invoker = true)
as
select
  r.id as recipe_id,
  p.id as product_id,
  p.name as product_name,
  ps.id as product_size_id,
  ps.label as product_size_label,
  rl.id as recipe_line_id,
  ii.id as inventory_item_id,
  ii.name as inventory_item_name,
  ii.is_active as inventory_item_is_active,
  rl.quantity_required,
  iu.id as unit_id,
  iu.name as unit_name,
  iu.abbreviation as unit_abbreviation,
  coalesce(s.usable_stock, 0)::numeric(14,3) as usable_stock,
  rl.sort_order,
  r.notes as recipe_notes,
  rl.created_at as recipe_line_created_at,
  rl.updated_at as recipe_line_updated_at
from public.inventory_recipe_lines rl
join public.inventory_recipes r on r.id = rl.recipe_id
join public.product_sizes ps on ps.id = r.product_size_id
join public.products p on p.id = ps.product_id
join public.inventory_items ii on ii.id = rl.inventory_item_id
join public.inventory_units iu on iu.id = ii.unit_id
left join public.inventory_stock_summary s on s.item_id = ii.id
where public.is_admin();

comment on view public.inventory_recipe_line_details is
  'Owner/admin recipe line view for future Recipes UI. Not granted to anon.';

create or replace view public.inventory_recipe_summary
with (security_invoker = true)
as
with line_rollup as (
  select
    r.id as recipe_id,
    count(rl.id)::integer as ingredient_line_count,
    count(rl.id) filter (where ii.is_active = false)::integer as inactive_ingredient_count,
    min(
      case
        when ii.is_active = true then
          least(
            floor(coalesce(s.usable_stock, 0) / rl.quantity_required),
            2147483647
          )
        else null
      end
    ) filter (where ii.is_active = true) as approximate_can_make
  from public.inventory_recipes r
  left join public.inventory_recipe_lines rl on rl.recipe_id = r.id
  left join public.inventory_items ii on ii.id = rl.inventory_item_id
  left join public.inventory_stock_summary s on s.item_id = ii.id
  group by r.id
)
select
  p.id as product_id,
  p.name as product_name,
  c.id as category_id,
  c.name as category_name,
  ps.id as product_size_id,
  ps.label as product_size_label,
  ps.sort_order as product_size_sort_order,
  r.id as recipe_id,
  (r.id is not null) as recipe_exists,
  coalesce(lr.ingredient_line_count, 0) as ingredient_line_count,
  coalesce(lr.inactive_ingredient_count, 0) as inactive_ingredient_count,
  case
    when r.id is null then 'not_configured'
    when coalesce(lr.ingredient_line_count, 0) = 0 then 'needs_attention'
    when coalesce(lr.inactive_ingredient_count, 0) > 0 then 'needs_attention'
    else 'ready'
  end as recipe_status,
  case
    when r.id is null then null
    when coalesce(lr.ingredient_line_count, 0) = 0 then null
    when coalesce(lr.inactive_ingredient_count, 0) > 0 then null
    else coalesce(lr.approximate_can_make, 0)::integer
  end as approximate_can_make,
  r.notes as recipe_notes,
  r.updated_at as recipe_updated_at
from public.product_sizes ps
join public.products p on p.id = ps.product_id
join public.categories c on c.id = p.category_id
left join public.inventory_recipes r on r.product_size_id = ps.id
left join line_rollup lr on lr.recipe_id = r.id
where public.is_admin();

comment on view public.inventory_recipe_summary is
  'Owner/admin recipe summary. One row per product size, including product sizes with no recipe.';

revoke all on public.inventory_recipe_line_details from anon, authenticated;
revoke all on public.inventory_recipe_summary from anon, authenticated;

grant select on public.inventory_recipe_line_details to authenticated;
grant select on public.inventory_recipe_summary to authenticated;

-- =========================================================
-- inventory_replace_recipe
-- =========================================================
-- Replaces one product-size recipe atomically after validating all input lines.
-- Existing recipes that contain later-archived inventory items remain readable,
-- but saving a recipe requires staff to remove or reactivate inactive items.

drop function if exists public.inventory_replace_recipe(uuid, jsonb, text);

create function public.inventory_replace_recipe(
  p_product_size_id uuid,
  p_lines jsonb,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product_size public.product_sizes%rowtype;
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
    updated_at = now(),
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

revoke all on function public.inventory_replace_recipe(uuid, jsonb, text) from public;
revoke execute on function public.inventory_replace_recipe(uuid, jsonb, text) from anon;
grant execute on function public.inventory_replace_recipe(uuid, jsonb, text) to authenticated;

comment on function public.inventory_replace_recipe(uuid, jsonb, text) is
  'Controlled owner/admin RPC that atomically creates or replaces one product-size recipe. Does not deduct inventory.';

-- =========================================================
-- inventory_delete_recipe
-- =========================================================
-- Deletes recipe configuration only. It does not delete products, product
-- sizes, inventory items, stock batches, or inventory movements.

drop function if exists public.inventory_delete_recipe(uuid);

create function public.inventory_delete_recipe(
  p_product_size_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product_size public.product_sizes%rowtype;
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

  delete from public.inventory_recipes
  where product_size_id = p_product_size_id
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

revoke all on function public.inventory_delete_recipe(uuid) from public;
revoke execute on function public.inventory_delete_recipe(uuid) from anon;
grant execute on function public.inventory_delete_recipe(uuid) to authenticated;

comment on function public.inventory_delete_recipe(uuid) is
  'Controlled owner/admin RPC that deletes recipe configuration for one product size. Does not delete menu or inventory records.';

-- =========================================================
-- Product-Size Coverage Diagnostic
-- =========================================================
-- Read-only diagnostic for reviewer use. Do not automatically create missing
-- product-size rows; review and repair menu data in a separate approved phase.
--
-- with product_size_counts as (
--   select
--     p.id as product_id,
--     p.name as product_name,
--     p.is_published,
--     p.is_available,
--     count(ps.id) as product_size_count
--   from public.products p
--   left join public.product_sizes ps on ps.product_id = p.id
--   group by p.id, p.name, p.is_published, p.is_available
-- ),
-- duplicate_size_labels as (
--   select
--     ps.product_id,
--     lower(btrim(ps.label)) as normalized_label,
--     count(*) as duplicate_count
--   from public.product_sizes ps
--   group by ps.product_id, lower(btrim(ps.label))
--   having count(*) > 1
-- )
-- select
--   'product_without_sizes' as issue_type,
--   product_id,
--   product_name,
--   null::text as detail
-- from product_size_counts
-- where product_size_count = 0
-- union all
-- select
--   'active_product_recipe_attachment_impossible' as issue_type,
--   product_id,
--   product_name,
--   'published or available product has no product_sizes row' as detail
-- from product_size_counts
-- where product_size_count = 0
--   and (is_published = true or is_available = true)
-- union all
-- select
--   'duplicate_product_size_label' as issue_type,
--   p.id as product_id,
--   p.name as product_name,
--   d.normalized_label || ' (' || d.duplicate_count::text || ' rows)' as detail
-- from duplicate_size_labels d
-- join public.products p on p.id = d.product_id
-- union all
-- select
--   'blank_product_size_label' as issue_type,
--   p.id as product_id,
--   p.name as product_name,
--   ps.id::text as detail
-- from public.product_sizes ps
-- join public.products p on p.id = ps.product_id
-- where length(btrim(coalesce(ps.label, ''))) = 0;

-- =========================================================
-- Deferred Scope
-- =========================================================
-- Deferred to later phases:
-- - automatic POS inventory deduction
-- - order finalization deduction
-- - inventory movement creation from sales
-- - recipe costing
-- - option-choice or add-on recipe deltas
-- - milk substitution adjustments
-- - public menu stock availability
-- - automatic product sold-out state
-- - recipe version history

commit;
