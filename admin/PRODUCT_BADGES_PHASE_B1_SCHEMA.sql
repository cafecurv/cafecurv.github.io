-- =========================================================
-- CURV Control Menu Manager
-- Phase B1: Product Badges Storage Schema Draft
-- =========================================================
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- - Add simple storage for customer-facing menu badge pills.
-- - Examples: LIMITED, CLOUD SERIES, BEST SELLER, NEW.
--
-- Important:
-- - These are customer-facing menu badges, not admin/internal tags.
-- - This file does not update public menu views.
-- - This file does not add anonymous/public grants.
-- - This file does not create badge library/tag tables.
-- - This file does not seed badge labels.
-- - Existing products remain valid with an empty badge array.
-- - Customer-facing menu behavior is unchanged until a later approved phase.

-- =========================================================
-- Products: Customer-Facing Badge Labels
-- =========================================================
-- badge_labels stores the visible badge text that may later render beside a
-- product name on the customer menu. The default empty array means existing
-- products have no badges until the admin UI adds them.

alter table public.products
  add column if not exists badge_labels text[] not null default '{}'::text[];

comment on column public.products.badge_labels is
  'Customer-facing menu badge labels such as LIMITED, CLOUD SERIES, or BEST SELLER. Not for admin/internal tags.';

-- =========================================================
-- Optional SELECT-Only Verification
-- =========================================================
-- Run these manually after the schema change if you want a quick check.

select
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'products'
  and column_name = 'badge_labels';

select
  count(*) as products_with_badge_labels
from public.products
where cardinality(badge_labels) > 0;
