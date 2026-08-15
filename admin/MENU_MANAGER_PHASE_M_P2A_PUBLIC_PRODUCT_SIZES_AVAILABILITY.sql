-- CURV Menu Phase M-P2A
-- Public product size availability fix
--
-- Purpose:
-- - Keep unpublished products hidden from public menu size reads.
-- - Allow product_sizes rows for published products even when products.is_available = false.
-- - Preserve customer-safe columns only; do not expose product_sizes.cost.
-- - Keep the existing security_invoker public-view model.
--
-- Do not run until reviewed and approved.

-- =========================================================
-- Public-Safe Product Variant / Size View
-- =========================================================
-- Exposes variant rows for published products. Availability and sold-out state
-- belong to the parent product row in public.public_menu_products; size rows are
-- still needed so unavailable/sold-out products can render accurately and with
-- disabled ordering controls.

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
);

comment on view public.public_menu_product_sizes is
  'Customer-safe menu product size/variant view. Excludes internal cost and returns rows only for published products, including unavailable or sold-out products so the customer UI can render disabled items correctly.';

grant select on public.public_menu_product_sizes to anon;

-- =========================================================
-- Narrow Base-Table Read Support For security_invoker View
-- =========================================================
-- Keep the existing customer-safe column grant. This does not expose cost,
-- timestamps, draft product state, or admin-only product fields.

grant select (id, product_id, label, price, sort_order) on public.product_sizes to anon;

-- Product sizes: anonymous users can read sizes only for published products.
-- Product availability must not remove the size rows needed to render a
-- published unavailable/sold-out item as disabled.

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
    )
  );
