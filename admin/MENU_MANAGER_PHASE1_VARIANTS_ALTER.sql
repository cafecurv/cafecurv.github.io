-- CURV Control Menu Manager
-- Phase 1 Variants Alter SQL Draft
--
-- Purpose:
-- Add the smallest schema adjustment for Loyverse-style product variants.
-- This draft does not connect the customer menu.
-- This draft does not create POS, inventory, order, or public menu logic.
-- Do not run until reviewed and approved.

-- =========================================================
-- Product Variant Group Label
-- =========================================================
-- variant_group_name is the label for a product's variant group.
-- Examples: Each, Size, Pieces, Weight / Volume, Pack / Box, Custom.
--
-- product_sizes is still acting as the variant rows table for now.
-- Each row in product_sizes can represent one variant label and price.
alter table public.products
  add column if not exists variant_group_name text;

-- =========================================================
-- Optional Variant Cost
-- =========================================================
-- cost is optional and owner-only.
-- It is intended for future margin, POS, recipe, or inventory planning.
-- It must not be exposed to the public customer menu.
alter table public.product_sizes
  add column if not exists cost numeric;

-- =========================================================
-- Cost Safety Constraint
-- =========================================================
-- cost may be null.
-- If cost is filled, it must be 0 or greater.
-- PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS directly,
-- so this block checks for the constraint before adding it.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_sizes_cost_nonnegative'
      and conrelid = 'public.product_sizes'::regclass
  ) then
    alter table public.product_sizes
      add constraint product_sizes_cost_nonnegative
      check (cost is null or cost >= 0);
  end if;
end;
$$;