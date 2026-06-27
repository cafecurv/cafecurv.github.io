-- =========================================================
-- CURV Control Menu Manager
-- Phase S5A: Category Sections Public Views SQL Draft
-- =========================================================
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- - Prepare customer-safe public read support for active category sections.
-- - Add products.category_section_id to the customer-safe product view.
--
-- Important:
-- - This file does not connect menu.html to category sections.
-- - This file does not change customer rendering, cart, or order behavior.
-- - This file does not seed category sections or products.
-- - This file does not expose internal notes, costs, timestamps, or admin data.

-- =========================================================
-- Public-Safe Category Section View
-- =========================================================
-- Exposes only active customer-facing category sections.
-- Intentionally excludes:
--   - category_sections.is_active
--   - category_sections.created_at

create or replace view public.public_menu_category_sections
with (security_invoker = true)
as
select
  cs.id,
  cs.category_id,
  cs.name,
  cs.sort_order
from public.category_sections cs
where cs.is_active = true;

comment on view public.public_menu_category_sections is
  'Customer-safe menu category section view. Excludes admin-only state and timestamps; includes only active sections.';

-- =========================================================
-- Refresh Public-Safe Product View
-- =========================================================
-- Preserve the existing public_menu_products columns from Phase 3B and append
-- category_section_id at the end to avoid changing existing view column order.
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
  p.category_section_id
from public.products p
where p.is_published = true
  and p.is_available = true;

comment on view public.public_menu_products is
  'Customer-safe menu product view. Excludes internal notes, raw publish/availability state, and timestamps; includes optional public display grouping and category section id.';

-- =========================================================
-- Public View Grants
-- =========================================================
-- Anonymous users may read only the customer-safe public menu views.
-- No anonymous write access is granted.

grant select on public.public_menu_category_sections to anon;
grant select on public.public_menu_products to anon;

-- =========================================================
-- Narrow Base-Table Read Support For security_invoker Views
-- =========================================================
-- SECURITY NOTE:
-- Existing CURV public menu views use security_invoker = true. Supabase/Postgres
-- may require anonymous users to have narrowly scoped SELECT access on the
-- underlying base tables for these views to work.
--
-- Customer app code should still query public.public_menu_category_sections
-- and public.public_menu_products, not raw tables.
--
-- These grants intentionally expose only customer-safe display columns.
-- They do not grant:
--   - category_sections.is_active
--   - category_sections.created_at
--   - products.notes
--   - products.is_published
--   - products.is_available
--   - timestamps
--   - admin_profiles

grant select (
  id,
  category_id,
  name,
  sort_order
) on public.category_sections to anon;

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
  category_section_id
) on public.products to anon;

-- =========================================================
-- Public Read RLS Policy For Category Sections
-- =========================================================
-- Allows anonymous users to read only active category sections.
-- Does not allow anonymous writes.

drop policy if exists "Public can read active menu category sections" on public.category_sections;
create policy "Public can read active menu category sections"
  on public.category_sections
  for select
  to anon
  using (is_active = true);

-- =========================================================
-- Verification Queries
-- =========================================================
-- Optional SELECT-only checks to run after this draft is manually executed.
-- Expected:
-- - public_menu_category_sections returns active sections only.
-- - public_menu_products includes category_section_id for published available products.
-- - Private fields such as notes, cost, is_active, is_published, is_available,
--   timestamps, and admin_profiles are not exposed by these views.

select *
from public.public_menu_category_sections
order by category_id, sort_order, name;

select
  id,
  category_id,
  category_section_id,
  name,
  sort_order,
  menu_group
from public.public_menu_products
order by category_id, category_section_id, sort_order, name;
