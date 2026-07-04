-- CURV Control Menu Manager
-- Phase O6A: Visible Sold Out Product State SQL Draft
-- =========================================================
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- - Add products.is_sold_out for customer-visible, unorderable products.
-- - Keep products.is_available as the hidden/unhidden control.
-- - Expose only the customer-safe is_sold_out display flag through
--   public.public_menu_products.
--
-- Product state model:
-- - is_available = false
--   -> hidden from the customer menu.
-- - is_available = true and is_sold_out = false
--   -> visible and orderable.
-- - is_available = true and is_sold_out = true
--   -> visible, muted, and unorderable.
--
-- This file does not grant public writes.
-- This file does not touch order submission RPC grants.
-- This file does not expose internal notes, costs, timestamps, or admin data.

-- =========================================================
-- Product Column
-- =========================================================

alter table public.products
  add column if not exists is_sold_out boolean not null default false;

comment on column public.products.is_sold_out is
  'When true, the product remains visible on the public menu but cannot be ordered. is_available=false still hides the product.';

-- =========================================================
-- Refresh Public-Safe Product View
-- =========================================================
-- Preserve existing customer-safe public_menu_products columns and append
-- is_sold_out at the end to avoid changing existing column order.
--
-- Exposes only products that are both published and available.
-- Intentionally excludes:
--   - products.notes
--   - products.is_published
--   - products.is_available
--   - product_sizes.cost
--   - timestamps

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

-- =========================================================
-- Public View Grant
-- =========================================================
-- Anonymous users may read only the customer-safe public menu product view.
-- No anonymous write access is granted.

grant select on public.public_menu_products to anon;

-- =========================================================
-- Narrow Base-Table Read Support For security_invoker View
-- =========================================================
-- SECURITY NOTE:
-- Existing CURV public menu views use security_invoker = true. Supabase/Postgres
-- may require anonymous users to have narrowly scoped SELECT access on the
-- underlying base table for this view to work.
--
-- Customer app code should still query public.public_menu_products,
-- not the raw public.products table.
--
-- These grants intentionally expose only customer-safe display columns and the
-- predicate columns needed by the existing public read policy.
-- They do not grant:
--   - products.notes
--   - product_sizes.cost
--   - timestamps
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
  is_sold_out,
  is_published,
  is_available
) on public.products to anon;

-- =========================================================
-- Optional SELECT-Only Verification
-- =========================================================
-- Expected:
-- - public_menu_products includes is_sold_out for published available products.
-- - Unavailable products remain hidden because the view still filters
--   p.is_available = true.
-- - Private fields such as notes, cost, timestamps, and admin_profiles are not
--   exposed by this view.

select
  column_name,
  ordinal_position
from information_schema.columns
where table_schema = 'public'
  and table_name = 'public_menu_products'
  and column_name = 'is_sold_out';

select
  id,
  name,
  is_sold_out
from public.public_menu_products
order by sort_order, name
limit 20;

-- =========================================================
-- Rollback SQL
-- =========================================================
-- Use only if this phase needs to be rolled back. Run after reverting website
-- and admin code that reads products.is_sold_out.

/*
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
  p.badge_labels
from public.products p
where p.is_published = true
  and p.is_available = true;

revoke select (is_sold_out) on public.products from anon;

alter table public.products
  drop column if exists is_sold_out;
*/
