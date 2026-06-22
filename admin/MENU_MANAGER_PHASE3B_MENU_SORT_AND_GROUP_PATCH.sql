-- CURV Control Menu Manager
-- Phase 3B Menu Sort and Group Patch
--
-- Run manually in Supabase SQL Editor after review.
-- This patch adds a public-safe display grouping field for menu products.
-- It does not connect the customer menu by itself.
-- It does not create categories or products.
-- It does not add POS, inventory, orders, checkout, or private admin data.
--
-- Why this exists:
-- Some customer-facing menu categories have internal display groups.
-- Example: Espresso contains an Espresso group and a Non-Espresso group.
-- The public customer menu needs a safe label to keep Supabase-rendered
-- products in the same visual structure as the hardcoded menu.

alter table public.products
  add column if not exists menu_group text;

comment on column public.products.menu_group is
  'Customer-safe optional display grouping label, such as Espresso or Non-Espresso. Do not use for private admin notes.';

-- Refresh the customer-safe product view so it exposes menu_group.
-- Private fields remain excluded:
--   - products.notes
--   - products.is_published
--   - products.is_available
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
  p.menu_group
from public.products p
where p.is_published = true
  and p.is_available = true;

comment on view public.public_menu_products is
  'Customer-safe menu product view. Excludes internal notes, raw publish/availability state, and timestamps; includes optional public display grouping.';

-- security_invoker views may require narrowly scoped base-table column grants.
-- menu_group is public-safe display metadata. It is not an internal note.
-- Customer app code should still query public.public_menu_products,
-- not the raw public.products table.
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
  menu_group
) on public.products to anon;
