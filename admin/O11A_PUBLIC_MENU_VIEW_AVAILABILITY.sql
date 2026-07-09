-- =========================================================
-- CURV Control Menu Manager
-- O11A: Public Menu View Availability Behavior
-- =========================================================
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- - Align the public menu read model with the current Menu Manager behavior.
-- - Published controls public visibility.
-- - Available controls customer orderability / sold-out state.
--
-- Final product state model:
-- - is_published = false
--   -> hidden from the public customer menu.
-- - is_published = true and is_available = true
--   -> visible and orderable.
-- - is_published = true and is_available = false
--   -> visible, but customer UI should show sold out / unavailable and block add-to-cart.
--
-- This file does not expose internal notes, costs, timestamps, supplier data,
-- admin-only fields, or public writes.

-- =========================================================
-- Refresh Public-Safe Product View
-- =========================================================
-- IMPORTANT:
-- - p.is_published controls whether a product appears on the public menu.
-- - p.is_available is exposed so menu.html can decide whether the visible
--   product is orderable or should be shown as sold out / currently unavailable.
-- - Do not filter p.is_available here.

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
where p.is_published = true;

comment on view public.public_menu_products is
  'Customer-safe menu product view. Published controls public visibility; availability is exposed only so the customer UI can show visible products as orderable or sold out/unavailable. Excludes internal notes, costs, timestamps, and admin-only fields.';

grant select on public.public_menu_products to anon;

-- =========================================================
-- Narrow Base-Table Read Support For security_invoker View
-- =========================================================
-- Existing CURV public menu views use security_invoker = true. Supabase/Postgres
-- may require anonymous users to have narrowly scoped SELECT access and a
-- matching RLS policy on the underlying table.
--
-- Customer app code should still query public.public_menu_products, not the raw
-- public.products table.
--
-- These grants intentionally expose only customer-safe display columns and the
-- predicate columns needed by the public view/RLS policy.
-- They do not grant:
--   - products.notes
--   - costs
--   - timestamps
--   - supplier/internal fields
--   - admin_profiles

grant select (
  id,
  category_id,
  name,
  description,
  image_url,
  is_curv_pick,
  is_seasonal,
  variant_group_name,
  sort_order,
  menu_group,
  category_section_id,
  badge_labels,
  is_available,
  is_sold_out,
  is_published
) on public.products to anon;

-- Replace the old anonymous product-read policy if it still requires
-- is_available = true. Published products may now be visible even when
-- unavailable; the UI handles unavailable products as sold out/unorderable.
drop policy if exists "Public can read published available menu products" on public.products;
drop policy if exists "Public can read published menu products" on public.products;

create policy "Public can read published menu products"
  on public.products
  for select
  to anon
  using (is_published = true);

-- =========================================================
-- Optional SELECT-Only Verification
-- =========================================================
-- Run manually after applying this draft.

-- 1. Confirm the view exposes availability but still does not expose private
--    admin fields such as notes or timestamps.
select
  column_name,
  ordinal_position
from information_schema.columns
where table_schema = 'public'
  and table_name = 'public_menu_products'
order by ordinal_position;

-- 2. Confirm published unavailable products can appear in the customer-safe
--    product view.
select
  id,
  name,
  is_available,
  is_sold_out
from public.public_menu_products
where is_available = false
order by sort_order, name
limit 20;

-- 3. Confirm unpublished products are still hidden from the view.
select
  count(*) as unpublished_products_visible_in_public_view
from public.public_menu_products v
join public.products p on p.id = v.id
where p.is_published = false;

-- =========================================================
-- Rollback SQL
-- =========================================================
-- Use only if this availability behavior needs to be rolled back.
-- This returns public_menu_products to the previous model where only published
-- and available products are visible.
-- Note: if the live view already has the appended is_available column,
-- CREATE OR REPLACE VIEW cannot remove it. Use drop/recreate only after
-- confirming no dependent objects would be broken.

/*
drop view if exists public.public_menu_products;

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
  p.is_sold_out
from public.products p
where p.is_published = true
  and p.is_available = true;

comment on view public.public_menu_products is
  'Customer-safe menu product view. Excludes internal notes, raw publish/availability state, and timestamps; includes customer-facing badge labels and sold-out display state.';

grant select on public.public_menu_products to anon;

drop policy if exists "Public can read published menu products" on public.products;
drop policy if exists "Public can read published available menu products" on public.products;

create policy "Public can read published available menu products"
  on public.products
  for select
  to anon
  using (is_published = true and is_available = true);
*/
