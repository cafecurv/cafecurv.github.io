-- CURV Menu Phase M-P2A Verification
--
-- Purpose:
-- Confirm public menu views expose enough data for published unavailable
-- products to render as visible but disabled, without exposing unpublished
-- products or product_sizes.cost.
--
-- Run manually in Supabase SQL Editor after applying the M-P2A migration.

-- 1. Published unavailable products should be visible in public_menu_products.
select
  id,
  category_id,
  name,
  is_available,
  is_sold_out
from public.public_menu_products
where is_available = false
order by name;

-- 2. Published unavailable products should have public size rows.
select
  p.name,
  p.is_available,
  p.is_sold_out,
  count(ps.id) as public_size_count
from public.public_menu_products p
left join public.public_menu_product_sizes ps
  on ps.product_id = p.id
where p.is_available = false
group by p.id, p.name, p.is_available, p.is_sold_out
order by p.name;

-- Expected: every published unavailable product that has product_sizes in the
-- admin table should show public_size_count > 0.

-- 3. Unpublished products must stay hidden from public_menu_products.
select
  count(*) as unpublished_products_visible_in_public_products
from public.public_menu_products v
join public.products p
  on p.id = v.id
where p.is_published = false;

-- Expected: 0.

-- 4. Unpublished product sizes must stay hidden from public_menu_product_sizes.
select
  count(*) as unpublished_product_sizes_visible_in_public_sizes
from public.public_menu_product_sizes ps
join public.products p
  on p.id = ps.product_id
where p.is_published = false;

-- Expected: 0.

-- 5. Customer-safe size view must not expose internal cost.
select
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'public_menu_product_sizes'
order by ordinal_position;

-- Expected columns only:
-- id, product_id, label, price, sort_order.
