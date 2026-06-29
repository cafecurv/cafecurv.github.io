-- =========================================================
-- CURV Control Menu Manager
-- Phase B3: Product Badges Public Product View SQL Draft
-- =========================================================
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- - Expose customer-facing product badge labels through the existing
--   customer-safe public_menu_products view.
--
-- Important:
-- - Badges are customer-facing menu pills, not admin/internal tags.
-- - This file does not render badges in menu.html.
-- - This file does not seed badge labels.
-- - This file does not create badge/tag library tables.
-- - This file does not expose internal notes, costs, timestamps, or admin data.

-- =========================================================
-- Refresh Public-Safe Product View
-- =========================================================
-- Preserve the current public_menu_products columns from Phase S5A and append
-- badge_labels at the end to avoid changing existing view column order.
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
  p.badge_labels
from public.products p
where p.is_published = true
  and p.is_available = true;

comment on view public.public_menu_products is
  'Customer-safe menu product view. Excludes internal notes, raw publish/availability state, and timestamps; includes optional public display grouping, category section id, and customer-facing badge labels.';

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
-- These grants intentionally expose only customer-safe display columns.
-- They do not grant:
--   - products.notes
--   - products.is_published
--   - products.is_available
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
  badge_labels
) on public.products to anon;

-- =========================================================
-- Optional SELECT-Only Verification
-- =========================================================
-- Run these manually after the view change if you want a quick check.
-- Expected:
-- - public_menu_products includes badge_labels for published available products.
-- - Private fields such as notes, cost, is_published, is_available, timestamps,
--   and admin_profiles are not exposed by this view.

select
  column_name,
  ordinal_position
from information_schema.columns
where table_schema = 'public'
  and table_name = 'public_menu_products'
  and column_name = 'badge_labels';

select
  id,
  name,
  badge_labels
from public.public_menu_products
order by sort_order, name
limit 20;

select
  count(*) as public_products_with_badge_labels
from public.public_menu_products
where cardinality(badge_labels) > 0;
