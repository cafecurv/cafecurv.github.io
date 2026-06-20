-- CURV Control Menu Manager
-- Phase 2A Public Menu Read SQL Draft
--
-- Purpose:
-- Prepare customer-safe public read access for a future Supabase-powered menu.
-- This file does not connect the customer website to Supabase.
-- This file does not add public writes, POS, inventory, orders, checkout, or reports.
-- Do not run until reviewed and approved.
--
-- Security direction:
-- Public customer reads should use the public_menu_* views below, not raw admin tables.
-- Internal fields such as products.notes and product_sizes.cost are intentionally excluded.

-- =========================================================
-- Public-Safe Category View
-- =========================================================
-- Exposes only active customer-facing categories.
-- Intentionally excludes is_active and created_at.
create or replace view public.public_menu_categories
with (security_invoker = true)
as
select
  c.id,
  c.name,
  c.sort_order
from public.categories c
where c.is_active = true;

comment on view public.public_menu_categories is
  'Customer-safe menu category view. Excludes admin-only state and timestamps; includes only active categories.';

-- =========================================================
-- Public-Safe Product View
-- =========================================================
-- Exposes only products that are both published and available.
-- Intentionally excludes:
--   - products.notes
--   - is_published
--   - is_available
--   - created_at
--   - updated_at
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
  p.sort_order
from public.products p
where p.is_published = true
  and p.is_available = true;

comment on view public.public_menu_products is
  'Customer-safe menu product view. Excludes internal notes, raw publish/availability state, and timestamps.';

-- =========================================================
-- Public-Safe Product Variant / Size View
-- =========================================================
-- Exposes only variant rows for products that are published and available.
-- Intentionally excludes:
--   - product_sizes.cost
--   - timestamps
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
    and p.is_available = true
);

comment on view public.public_menu_product_sizes is
  'Customer-safe menu product size/variant view. Excludes internal cost and only returns rows for published available products.';

-- =========================================================
-- Public Read Grants
-- =========================================================
-- Anonymous users may read only the customer-safe views.
-- No anonymous write access is granted.
-- No anonymous access is granted to admin_profiles.
grant select on public.public_menu_categories to anon;
grant select on public.public_menu_products to anon;
grant select on public.public_menu_product_sizes to anon;

revoke all on public.admin_profiles from anon;

-- =========================================================
-- Narrow Base-Table Read Support For security_invoker Views
-- =========================================================
-- SECURITY NOTE:
-- security_invoker views obey the permissions and RLS policies of the calling user.
-- Supabase/Postgres may require anonymous users to have narrowly scoped SELECT access
-- on the underlying base tables for these views to work.
--
-- These grants intentionally expose only customer-safe columns plus predicate columns
-- needed by security_invoker views and RLS checks.
--
-- Predicate columns such as is_active, is_published, and is_available are granted
-- only so the views and RLS filters can evaluate safely for anonymous users.
-- They are intentionally NOT included in the public_menu_* view outputs.
--
-- They do NOT grant products.notes, product_sizes.cost, timestamps, or admin_profiles.
-- RLS policies below still restrict anonymous rows to active categories and
-- published available products, so direct raw-table reads cannot expose draft or
-- unavailable product rows.
--
-- Customer app code should still query only the public_menu_* views.
revoke all on public.categories from anon;
revoke all on public.products from anon;
revoke all on public.product_sizes from anon;

grant select (id, name, sort_order, is_active) on public.categories to anon;
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
  is_published,
  is_available
) on public.products to anon;
grant select (id, product_id, label, price, sort_order) on public.product_sizes to anon;

-- =========================================================
-- Public Read RLS Policies
-- =========================================================
-- Preserve owner-only admin policies from Phase 1S-B.
-- Add only the minimum anonymous read policies needed for future customer menu reads.
-- These policies do not allow anonymous writes.

-- Categories: anonymous users can read only active categories.
drop policy if exists "Public can read active menu categories" on public.categories;
create policy "Public can read active menu categories"
  on public.categories
  for select
  to anon
  using (is_active = true);

-- Products: anonymous users can read only published and available products.
-- Column grants above prevent anonymous reads of products.notes. Predicate columns are granted only so RLS/view filters can evaluate.
drop policy if exists "Public can read published available menu products" on public.products;
create policy "Public can read published available menu products"
  on public.products
  for select
  to anon
  using (is_published = true and is_available = true);

-- Product sizes: anonymous users can read sizes only for published and available products.
-- Column grants above prevent anonymous reads of product_sizes.cost.
drop policy if exists "Public can read published available menu product sizes" on public.product_sizes;
create policy "Public can read published available menu product sizes"
  on public.product_sizes
  for select
  to anon
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_sizes.product_id
        and p.is_published = true
        and p.is_available = true
    )
  );

-- =========================================================
-- Public Write Safety
-- =========================================================
-- No insert/update/delete grants or policies are added for anonymous users.
-- Anonymous users should not be able to create, edit, delete, publish, or manage menu data.
-- Owner-only admin access remains handled by the existing Phase 1S-B policies.

-- =========================================================
-- Future Customer Menu Integration Notes
-- =========================================================
-- Future customer menu JavaScript should query:
--   - public.public_menu_categories
--   - public.public_menu_products
--   - public.public_menu_product_sizes
--
-- It should not query:
--   - public.products directly
--   - public.product_sizes directly
--   - public.admin_profiles
--
-- Keep products.notes and product_sizes.cost admin-only.
-- Do not add public customer menu writes.