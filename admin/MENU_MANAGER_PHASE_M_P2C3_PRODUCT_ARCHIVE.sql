-- CURV Menu Manager Phase M-P2C.3
-- Product archive and restore lifecycle
--
-- Draft SQL only. Review before running manually in Supabase SQL Editor.

begin;

alter table public.products
  add column if not exists archived_at timestamptz;

comment on column public.products.archived_at is
  'Server-managed product lifecycle timestamp. NULL means active; non-NULL means archived and excluded from every public menu read.';

-- Reapplication also repairs any legacy/stale archived row before enforcing
-- the lifecycle invariant at the table boundary.
update public.products p
set
  is_published = false,
  is_available = false,
  is_sold_out = false,
  is_curv_pick = false
where p.archived_at is not null
  and (p.is_published or p.is_available or p.is_sold_out or p.is_curv_pick);

alter table public.products
  drop constraint if exists products_archived_state_safe;

alter table public.products
  add constraint products_archived_state_safe check (
    archived_at is null
    or (
      is_published = false
      and is_available = false
      and is_sold_out = false
      and is_curv_pick = false
    )
  );

create index if not exists products_archived_at_idx
  on public.products (archived_at, category_id, sort_order, name);

-- A stale editor must not reconcile, recreate, or remove size rows after the
-- same product has been archived in another tab. Restore first, then edit.
create or replace function public.menu_manager_guard_archived_product_sizes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_id uuid;
begin
  v_product_id := case when tg_op = 'DELETE' then old.product_id else new.product_id end;

  if exists (
    select 1
    from public.products p
    where p.id = v_product_id
      and p.archived_at is not null
  ) then
    raise exception 'Archived product sizes are read-only. Restore the product before editing its sizes.'
      using errcode = 'P0001',
        detail = 'MM_ARCHIVED_PRODUCT_READ_ONLY';
  end if;

  if tg_op = 'UPDATE'
    and old.product_id is distinct from new.product_id
    and exists (
      select 1
      from public.products p
      where p.id = old.product_id
        and p.archived_at is not null
    )
  then
    raise exception 'Archived product sizes are read-only. Restore the product before editing its sizes.'
      using errcode = 'P0001',
        detail = 'MM_ARCHIVED_PRODUCT_READ_ONLY';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.menu_manager_guard_archived_product_sizes() from public;
revoke execute on function public.menu_manager_guard_archived_product_sizes() from anon;
revoke execute on function public.menu_manager_guard_archived_product_sizes() from authenticated;

drop trigger if exists guard_archived_product_sizes on public.product_sizes;
create trigger guard_archived_product_sizes
before insert or update or delete on public.product_sizes
for each row
execute function public.menu_manager_guard_archived_product_sizes();

-- =========================================================
-- Owner-only archive lifecycle RPCs
-- =========================================================

drop function if exists public.menu_manager_archive_product(uuid);

create function public.menu_manager_archive_product(
  p_product_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
  v_operation text;
begin
  if v_actor is null then
    raise exception 'Please sign in before archiving a product.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_ARCHIVE_AUTH_REQUIRED',
        hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can archive products.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_ARCHIVE_ADMIN_REQUIRED',
        hint = 'Use an approved owner account.';
  end if;

  if p_product_id is null then
    raise exception 'Choose a product before archiving it.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_ARCHIVE_PRODUCT_REQUIRED';
  end if;

  select p.*
  into v_product
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'That product was not found.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_ARCHIVE_NOT_FOUND',
        hint = 'Refresh Menu Manager and choose an existing product.';
  end if;

  if v_product.archived_at is null then
    update public.products p
    set
      archived_at = clock_timestamp(),
      is_published = false,
      is_available = false,
      is_sold_out = false,
      is_curv_pick = false
    where p.id = p_product_id
    returning p.* into v_product;
    v_operation := 'archived';
  elsif v_product.is_published
    or v_product.is_available
    or v_product.is_sold_out
    or v_product.is_curv_pick
  then
    -- Repair any legacy/stale archived row without changing its first archive
    -- timestamp or any descriptive/configuration field.
    update public.products p
    set
      is_published = false,
      is_available = false,
      is_sold_out = false,
      is_curv_pick = false
    where p.id = p_product_id
    returning p.* into v_product;
    v_operation := 'already_archived';
  else
    v_operation := 'already_archived';
  end if;

  return jsonb_build_object(
    'ok', true,
    'operation', v_operation,
    'product', jsonb_build_object(
      'id', v_product.id,
      'category_id', v_product.category_id,
      'category_section_id', v_product.category_section_id,
      'archived_at', v_product.archived_at,
      'is_published', v_product.is_published,
      'is_available', v_product.is_available,
      'is_sold_out', v_product.is_sold_out,
      'is_curv_pick', v_product.is_curv_pick,
      'is_seasonal', v_product.is_seasonal
    )
  );
end;
$$;

drop function if exists public.menu_manager_restore_product(uuid);

create function public.menu_manager_restore_product(
  p_product_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
  v_operation text;
begin
  if v_actor is null then
    raise exception 'Please sign in before restoring a product.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_RESTORE_AUTH_REQUIRED',
        hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can restore products.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_RESTORE_ADMIN_REQUIRED',
        hint = 'Use an approved owner account.';
  end if;

  if p_product_id is null then
    raise exception 'Choose a product before restoring it.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_RESTORE_PRODUCT_REQUIRED';
  end if;

  select p.*
  into v_product
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'That product was not found.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_RESTORE_NOT_FOUND',
        hint = 'Refresh Menu Manager and choose an existing product.';
  end if;

  if v_product.archived_at is not null then
    update public.products p
    set
      archived_at = null,
      is_published = false,
      is_available = false,
      is_sold_out = false,
      is_curv_pick = false
    where p.id = p_product_id
    returning p.* into v_product;
    v_operation := 'restored';
  else
    v_operation := 'not_archived';
  end if;

  return jsonb_build_object(
    'ok', true,
    'operation', v_operation,
    'product', jsonb_build_object(
      'id', v_product.id,
      'category_id', v_product.category_id,
      'category_section_id', v_product.category_section_id,
      'archived_at', v_product.archived_at,
      'is_published', v_product.is_published,
      'is_available', v_product.is_available,
      'is_sold_out', v_product.is_sold_out,
      'is_curv_pick', v_product.is_curv_pick,
      'is_seasonal', v_product.is_seasonal
    )
  );
end;
$$;

revoke all on function public.menu_manager_archive_product(uuid) from public;
revoke execute on function public.menu_manager_archive_product(uuid) from anon;
grant execute on function public.menu_manager_archive_product(uuid) to authenticated;

revoke all on function public.menu_manager_restore_product(uuid) from public;
revoke execute on function public.menu_manager_restore_product(uuid) from anon;
grant execute on function public.menu_manager_restore_product(uuid) to authenticated;

comment on function public.menu_manager_archive_product(uuid) is
  'Owner-only idempotent product archive. Retires public/orderable state while preserving product configuration and history.';

comment on function public.menu_manager_restore_product(uuid) is
  'Owner-only product restore. Returns an archived product as unpublished, unavailable, not sold out, and not a CURV Pick.';

-- =========================================================
-- Public menu products and sizes
-- =========================================================

create or replace view public.public_menu_products
with (security_invoker = true)
as
select
  p.id,
  p.category_id,
  p.name,
  p.description,
  p.image_url,
  p.is_curv_pick,
  p.is_seasonal,
  p.variant_group_name,
  p.sort_order,
  p.menu_group,
  p.category_section_id,
  p.badge_labels,
  p.is_sold_out,
  p.is_available
from public.products p
where p.is_published = true
  and p.archived_at is null;

comment on view public.public_menu_products is
  'Customer-safe menu product view. Returns non-archived published products, including unavailable or sold-out products for disabled public rendering.';

grant select on public.public_menu_products to anon;

create or replace view public.public_menu_product_sizes
with (security_invoker = true)
as
select
  ps.id,
  ps.product_id,
  ps.label,
  ps.price,
  ps.sort_order
from public.product_sizes ps
where exists (
  select 1
  from public.products p
  where p.id = ps.product_id
    and p.is_published = true
    and p.archived_at is null
);

comment on view public.public_menu_product_sizes is
  'Customer-safe menu size/variant view. Returns sizes for non-archived published products, including unavailable or sold-out products.';

grant select on public.public_menu_product_sizes to anon;

-- =========================================================
-- Public menu option safeguards
-- =========================================================

create or replace view public.public_menu_option_groups
with (security_invoker = true)
as
select
  pog.product_id,
  og.id as option_group_id,
  og.group_key,
  og.name,
  og.selection_type,
  pog.is_required,
  pog.min_selections,
  pog.max_selections,
  pog.sort_order
from public.product_option_groups pog
join public.option_groups og
  on og.id = pog.option_group_id
join public.products p
  on p.id = pog.product_id
where p.is_published = true
  and p.is_available = true
  and p.archived_at is null
  and og.is_active = true
  and pog.is_active = true;

create or replace view public.public_menu_option_choices
with (security_invoker = true)
as
select
  pog.product_id,
  og.id as option_group_id,
  oc.id as option_choice_id,
  oc.label,
  oc.value,
  oc.price_delta,
  oc.sort_order
from public.product_option_groups pog
join public.option_groups og
  on og.id = pog.option_group_id
join public.option_choices oc
  on oc.option_group_id = og.id
join public.products p
  on p.id = pog.product_id
where p.is_published = true
  and p.is_available = true
  and p.archived_at is null
  and og.is_active = true
  and pog.is_active = true
  and oc.is_active = true;

create or replace view public.public_menu_option_defaults
with (security_invoker = true)
as
select
  pod.product_id,
  pod.option_group_id,
  pod.option_choice_id
from public.product_option_defaults pod
join public.product_option_groups pog
  on pog.product_id = pod.product_id
  and pog.option_group_id = pod.option_group_id
join public.option_groups og
  on og.id = pod.option_group_id
join public.option_choices oc
  on oc.id = pod.option_choice_id
  and oc.option_group_id = pod.option_group_id
join public.products p
  on p.id = pod.product_id
where p.is_published = true
  and p.is_available = true
  and p.archived_at is null
  and og.is_active = true
  and pog.is_active = true
  and oc.is_active = true;

grant select on public.public_menu_option_groups to anon;
grant select on public.public_menu_option_choices to anon;
grant select on public.public_menu_option_defaults to anon;

-- security_invoker views and their RLS predicates need this one lifecycle
-- column. No anonymous writes or private product fields are granted.
grant select (archived_at) on public.products to anon;

drop policy if exists "Public can read published available menu products" on public.products;
drop policy if exists "Public can read published menu products" on public.products;
create policy "Public can read published menu products"
  on public.products
  for select
  to anon
  using (is_published = true and archived_at is null);

drop policy if exists "Public can read published available menu product sizes" on public.product_sizes;
drop policy if exists "Public can read published menu product sizes" on public.product_sizes;
create policy "Public can read published menu product sizes"
  on public.product_sizes
  for select
  to anon
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_sizes.product_id
        and p.is_published = true
        and p.archived_at is null
    )
  );

drop policy if exists "Public can read active product option groups" on public.product_option_groups;
create policy "Public can read active product option groups"
  on public.product_option_groups
  for select
  to anon
  using (
    is_active = true
    and exists (
      select 1
      from public.products p
      where p.id = product_option_groups.product_id
        and p.is_published = true
        and p.is_available = true
        and p.archived_at is null
    )
    and exists (
      select 1
      from public.option_groups og
      where og.id = product_option_groups.option_group_id
        and og.is_active = true
    )
  );

drop policy if exists "Public can read active product option defaults" on public.product_option_defaults;
create policy "Public can read active product option defaults"
  on public.product_option_defaults
  for select
  to anon
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_option_defaults.product_id
        and p.is_published = true
        and p.is_available = true
        and p.archived_at is null
    )
    and exists (
      select 1
      from public.product_option_groups pog
      where pog.product_id = product_option_defaults.product_id
        and pog.option_group_id = product_option_defaults.option_group_id
        and pog.is_active = true
    )
    and exists (
      select 1
      from public.option_groups og
      where og.id = product_option_defaults.option_group_id
        and og.is_active = true
    )
    and exists (
      select 1
      from public.option_choices oc
      where oc.id = product_option_defaults.option_choice_id
        and oc.option_group_id = product_option_defaults.option_group_id
        and oc.is_active = true
    )
  );

commit;
