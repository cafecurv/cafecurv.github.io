-- CURV Control Inventory Management
-- Phase I2 Foundation SQL Draft
--
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- Create the isolated owner/admin-only foundation for manual inventory
-- reporting: item master data, canonical units, batches, append-only movement
-- history, FIFO-ready batch fields, and admin reporting views.
--
-- This phase intentionally does not add recipes, automatic deduction, Loyverse
-- integration, POS integration, public inventory access, supplier master data,
-- inventory snapshots, or stock mutation RPCs.
--
-- Authority model:
-- - Reuses the existing public.is_admin() helper from the CURV Control owner
--   access phase.
-- - Browser roles receive read access only when RLS confirms owner/admin access.
-- - Direct browser INSERT/UPDATE/DELETE for batches and movements is not opened.
-- - Phase I3 should add reviewed SECURITY DEFINER RPCs for controlled stock
--   mutations.
--
-- Dependency:
-- public.admin_profiles and public.is_admin() must already exist
-- from the existing CURV admin-access schema.

-- =========================================================
-- Extensions
-- =========================================================

create extension if not exists pgcrypto;

-- =========================================================
-- Shared Updated-at Helper
-- =========================================================
-- The existing menu/order drafts already use public.set_updated_at().
-- Recreate the same simple helper so this draft remains runnable after review
-- in environments where the helper has not been applied yet.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- Inventory Categories
-- =========================================================
-- Soft archive model: inactive categories remain for history and reporting.

create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_categories
  drop constraint if exists inventory_categories_name_not_blank;

alter table public.inventory_categories
  add constraint inventory_categories_name_not_blank
  check (length(btrim(name)) > 0);

create unique index if not exists inventory_categories_name_ci_unique_idx
  on public.inventory_categories (lower(btrim(name)));

create index if not exists inventory_categories_active_sort_idx
  on public.inventory_categories (is_active, sort_order, name);

drop trigger if exists set_inventory_categories_updated_at on public.inventory_categories;
create trigger set_inventory_categories_updated_at
before update on public.inventory_categories
for each row
execute function public.set_updated_at();

-- =========================================================
-- Inventory Units
-- =========================================================
-- One canonical unit is selected per item. This phase stores labels only and
-- intentionally does not create unit conversions.

create table if not exists public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  abbreviation text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_units
  drop constraint if exists inventory_units_name_not_blank;

alter table public.inventory_units
  add constraint inventory_units_name_not_blank
  check (length(btrim(name)) > 0);

alter table public.inventory_units
  drop constraint if exists inventory_units_abbreviation_not_blank;

alter table public.inventory_units
  add constraint inventory_units_abbreviation_not_blank
  check (length(btrim(abbreviation)) > 0);

create unique index if not exists inventory_units_name_ci_unique_idx
  on public.inventory_units (lower(btrim(name)));

create unique index if not exists inventory_units_abbreviation_ci_unique_idx
  on public.inventory_units (lower(btrim(abbreviation)));

create index if not exists inventory_units_active_sort_idx
  on public.inventory_units (is_active, sort_order, name);

drop trigger if exists set_inventory_units_updated_at on public.inventory_units;
create trigger set_inventory_units_updated_at
before update on public.inventory_units
for each row
execute function public.set_updated_at();

-- =========================================================
-- Inventory Items
-- =========================================================
-- Items with history should be archived by setting is_active = false rather
-- than deleted. Each item has exactly one canonical unit in this foundation.

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid not null references public.inventory_categories(id) on delete restrict,
  unit_id uuid not null references public.inventory_units(id) on delete restrict,
  low_stock_threshold numeric(14,3) not null default 0,
  track_expiry boolean not null default false,
  storage_location text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.inventory_items
  drop constraint if exists inventory_items_name_not_blank;

alter table public.inventory_items
  add constraint inventory_items_name_not_blank
  check (length(btrim(name)) > 0);

alter table public.inventory_items
  drop constraint if exists inventory_items_low_stock_threshold_nonnegative;

alter table public.inventory_items
  add constraint inventory_items_low_stock_threshold_nonnegative
  check (low_stock_threshold >= 0);

create unique index if not exists inventory_items_active_name_ci_unique_idx
  on public.inventory_items (lower(btrim(name)))
  where is_active = true;

create index if not exists inventory_items_category_active_idx
  on public.inventory_items (category_id, is_active, name);

create index if not exists inventory_items_unit_idx
  on public.inventory_items (unit_id);

drop trigger if exists set_inventory_items_updated_at on public.inventory_items;
create trigger set_inventory_items_updated_at
before update on public.inventory_items
for each row
execute function public.set_updated_at();

-- =========================================================
-- Inventory Batches
-- =========================================================
-- Batches are FIFO-ready. Depleted state is derived from
-- quantity_remaining = 0; there is intentionally no is_depleted column.
-- Expiry requirements for track_expiry items will be enforced by controlled
-- Phase I3 RPCs because cross-table CHECK constraints are unsuitable.

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  batch_ref text not null,
  batch_origin text not null,
  received_date date not null,
  expiry_date date,
  quantity_received numeric(14,3) not null,
  quantity_remaining numeric(14,3) not null,
  cost_per_unit numeric(14,4),
  reference_text text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.inventory_batches
  drop constraint if exists inventory_batches_batch_origin_check;

alter table public.inventory_batches
  add constraint inventory_batches_batch_origin_check
  check (batch_origin in ('opening_balance', 'stock_in', 'adjustment'));

alter table public.inventory_batches
  drop constraint if exists inventory_batches_batch_ref_not_blank;

alter table public.inventory_batches
  add constraint inventory_batches_batch_ref_not_blank
  check (length(btrim(batch_ref)) > 0);

alter table public.inventory_batches
  drop constraint if exists inventory_batches_quantity_received_positive;

alter table public.inventory_batches
  add constraint inventory_batches_quantity_received_positive
  check (quantity_received > 0);

alter table public.inventory_batches
  drop constraint if exists inventory_batches_quantity_remaining_nonnegative;

alter table public.inventory_batches
  add constraint inventory_batches_quantity_remaining_nonnegative
  check (quantity_remaining >= 0);

alter table public.inventory_batches
  drop constraint if exists inventory_batches_cost_per_unit_nonnegative;

alter table public.inventory_batches
  add constraint inventory_batches_cost_per_unit_nonnegative
  check (cost_per_unit is null or cost_per_unit >= 0);

drop index if exists public.inventory_batches_item_idx;

create index if not exists inventory_batches_item_received_date_idx
  on public.inventory_batches (item_id, received_date, id);

create index if not exists inventory_batches_expiry_date_idx
  on public.inventory_batches (expiry_date)
  where expiry_date is not null;

create index if not exists inventory_batches_remaining_fifo_idx
  on public.inventory_batches (item_id, expiry_date, received_date, id)
  where quantity_remaining > 0;

-- =========================================================
-- Inventory Movements
-- =========================================================
-- Movement quantity is stored as a positive magnitude. The movement_type
-- determines inventory direction. Applications should append new rows only.
-- Updates/deletes are rejected by trigger to protect movement history even for
-- privileged browser roles.

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_group_id uuid,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  batch_id uuid references public.inventory_batches(id) on delete restrict,
  movement_type text not null,
  quantity numeric(14,3) not null,
  reason_code text,
  reference_id uuid,
  reference_text text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint inventory_movements_reference_fk
    foreign key (reference_id)
    references public.inventory_movements(id)
    deferrable initially deferred
);

alter table public.inventory_movements
  drop constraint if exists inventory_movements_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_type_check
  check (
    movement_type in (
      'opening_balance',
      'stock_in',
      'stock_out',
      'waste',
      'adjustment_in',
      'adjustment_out',
      'reversal'
    )
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_quantity_positive;

alter table public.inventory_movements
  add constraint inventory_movements_quantity_positive
  check (quantity > 0);

alter table public.inventory_movements
  drop constraint if exists inventory_movements_waste_reason_check;

alter table public.inventory_movements
  add constraint inventory_movements_waste_reason_check
  check (
    (
      movement_type <> 'waste'
      and reason_code is null
    )
    or (
      movement_type = 'waste'
      and reason_code in (
        'expired',
        'spoiled',
        'spilled',
        'damaged',
        'preparation_error',
        'overproduction',
        'quality_rejection',
        'staff_use',
        'other'
      )
      and (
        reason_code <> 'other'
        or length(btrim(coalesce(notes, ''))) > 0
      )
    )
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_adjustment_notes_check;

alter table public.inventory_movements
  add constraint inventory_movements_adjustment_notes_check
  check (
    movement_type not in ('adjustment_in', 'adjustment_out')
    or length(btrim(coalesce(notes, ''))) > 0
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_reversal_reference_check;

alter table public.inventory_movements
  add constraint inventory_movements_reversal_reference_check
  check (
    movement_type <> 'reversal'
    or (
      reference_id is not null
      and length(btrim(coalesce(notes, ''))) > 0
    )
  );

create index if not exists inventory_movements_item_created_idx
  on public.inventory_movements (item_id, created_at desc);

create index if not exists inventory_movements_batch_idx
  on public.inventory_movements (batch_id);

drop index if exists public.inventory_movements_group_idx;
create index inventory_movements_group_idx
  on public.inventory_movements (movement_group_id)
  where movement_group_id is not null;

create index if not exists inventory_movements_type_created_idx
  on public.inventory_movements (movement_type, created_at desc);

create index if not exists inventory_movements_created_at_idx
  on public.inventory_movements (created_at desc);

create index if not exists inventory_movements_reference_id_idx
  on public.inventory_movements (reference_id)
  where reference_id is not null;

create or replace function public.reject_inventory_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'inventory_movements is append-only; create a reversal movement instead of updating or deleting history';
end;
$$;

drop trigger if exists reject_inventory_movement_update on public.inventory_movements;
create trigger reject_inventory_movement_update
before update on public.inventory_movements
for each row
execute function public.reject_inventory_movement_mutation();

drop trigger if exists reject_inventory_movement_delete on public.inventory_movements;
create trigger reject_inventory_movement_delete
before delete on public.inventory_movements
for each row
execute function public.reject_inventory_movement_mutation();

-- =========================================================
-- Row Level Security
-- =========================================================
-- No anonymous policies or grants are added. Authenticated users receive only
-- SELECT privileges, and RLS limits those reads to public.is_admin().
-- Direct browser writes are intentionally closed in this foundation phase.

alter table public.inventory_categories enable row level security;
alter table public.inventory_units enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists "Owners can read inventory categories" on public.inventory_categories;
create policy "Owners can read inventory categories"
  on public.inventory_categories
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can read inventory units" on public.inventory_units;
create policy "Owners can read inventory units"
  on public.inventory_units
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can read inventory items" on public.inventory_items;
create policy "Owners can read inventory items"
  on public.inventory_items
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can read inventory batches" on public.inventory_batches;
create policy "Owners can read inventory batches"
  on public.inventory_batches
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can read inventory movements" on public.inventory_movements;
create policy "Owners can read inventory movements"
  on public.inventory_movements
  for select
  to authenticated
  using (public.is_admin());

revoke all on public.inventory_categories from anon, authenticated;
revoke all on public.inventory_units from anon, authenticated;
revoke all on public.inventory_items from anon, authenticated;
revoke all on public.inventory_batches from anon, authenticated;
revoke all on public.inventory_movements from anon, authenticated;

grant select on public.inventory_categories to authenticated;
grant select on public.inventory_units to authenticated;
grant select on public.inventory_items to authenticated;
grant select on public.inventory_batches to authenticated;
grant select on public.inventory_movements to authenticated;

-- =========================================================
-- Reporting Views
-- =========================================================
-- These are owner/admin reporting views. They are not public menu views and are
-- not granted to anon.

create or replace view public.inventory_stock_summary
with (security_invoker = true)
as
select
  i.id as item_id,
  i.name as item_name,
  c.id as category_id,
  c.name as category_name,
  u.id as unit_id,
  u.name as unit_name,
  u.abbreviation as unit_abbreviation,
  i.low_stock_threshold,
  coalesce(sum(b.quantity_remaining), 0)::numeric(14,3) as current_stock,
  (coalesce(sum(b.quantity_remaining), 0) <= i.low_stock_threshold) as is_low_stock,
  min(b.expiry_date) filter (
    where b.quantity_remaining > 0
      and b.expiry_date is not null
      and b.expiry_date >= current_date
  ) as nearest_non_expired_expiry_date,
  i.track_expiry,
  i.storage_location,
  i.is_active
from public.inventory_items i
join public.inventory_categories c on c.id = i.category_id
join public.inventory_units u on u.id = i.unit_id
left join public.inventory_batches b on b.item_id = i.id
where i.is_active = true
group by
  i.id,
  i.name,
  c.id,
  c.name,
  u.id,
  u.name,
  u.abbreviation,
  i.low_stock_threshold,
  i.track_expiry,
  i.storage_location,
  i.is_active;

create or replace view public.inventory_low_stock
with (security_invoker = true)
as
select *
from public.inventory_stock_summary
where is_active = true
  and current_stock <= low_stock_threshold;

create or replace view public.inventory_expiry_watch
with (security_invoker = true)
as
select
  b.id as batch_id,
  b.item_id,
  i.name as item_name,
  c.id as category_id,
  c.name as category_name,
  u.id as unit_id,
  u.name as unit_name,
  u.abbreviation as unit_abbreviation,
  b.batch_ref,
  b.received_date,
  b.expiry_date,
  b.quantity_remaining,
  (b.expiry_date - current_date) as days_until_expiry,
  case
    when b.expiry_date < current_date then 'expired'
    when b.expiry_date <= current_date + interval '7 days' then 'urgent'
    when b.expiry_date <= current_date + interval '30 days' then 'soon'
    else 'upcoming'
  end as expiry_status
from public.inventory_batches b
join public.inventory_items i on i.id = b.item_id
join public.inventory_categories c on c.id = i.category_id
join public.inventory_units u on u.id = i.unit_id
where b.quantity_remaining > 0
  and b.expiry_date is not null
  and i.is_active = true;

comment on view public.inventory_expiry_watch is
  'Owner/admin expiry report. Status bands: expired before today, urgent within 7 days, soon within 30 days, upcoming beyond 30 days.';

create or replace view public.inventory_movement_log
with (security_invoker = true)
as
select
  m.id as movement_id,
  m.movement_group_id,
  m.item_id,
  i.name as item_name,
  m.batch_id,
  b.batch_ref,
  b.batch_origin,
  m.movement_type,
  m.quantity,
  u.id as unit_id,
  u.name as unit_name,
  u.abbreviation as unit_abbreviation,
  m.reason_code,
  m.reference_id,
  m.reference_text,
  m.notes,
  m.created_by,
  ap.full_name as actor_name,
  m.created_at
from public.inventory_movements m
join public.inventory_items i on i.id = m.item_id
join public.inventory_units u on u.id = i.unit_id
left join public.inventory_batches b on b.id = m.batch_id
left join public.admin_profiles ap on ap.id = m.created_by;

revoke all on public.inventory_stock_summary from anon, authenticated;
revoke all on public.inventory_low_stock from anon, authenticated;
revoke all on public.inventory_expiry_watch from anon, authenticated;
revoke all on public.inventory_movement_log from anon, authenticated;

grant select on public.inventory_stock_summary to authenticated;
grant select on public.inventory_low_stock to authenticated;
grant select on public.inventory_expiry_watch to authenticated;
grant select on public.inventory_movement_log to authenticated;

-- =========================================================
-- Idempotent Seed Data
-- =========================================================
-- Seeds use normalized names/abbreviations so reruns update existing rows
-- instead of creating duplicates. These are labels only; no conversion exists.
-- The liter abbreviation intentionally stays uppercase as "L".

insert into public.inventory_units (name, abbreviation, sort_order)
values
  ('gram', 'g', 10),
  ('kilogram', 'kg', 20),
  ('milliliter', 'ml', 30),
  ('liter', 'L', 40),
  ('piece', 'pcs', 50),
  ('pack', 'pack', 60),
  ('bottle', 'bottle', 70),
  ('carton', 'carton', 80)
on conflict (lower(btrim(name))) do update
set
  abbreviation = excluded.abbreviation,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

insert into public.inventory_categories (name, sort_order)
values
  ('Matcha and Hojicha', 10),
  ('Coffee Beans', 20),
  ('Milk and Dairy', 30),
  ('Alternative Milk', 40),
  ('Syrups and Sauces', 50),
  ('Fruit and Purees', 60),
  ('Tea and Refreshers', 70),
  ('Baking Ingredients', 80),
  ('Frozen Goods', 90),
  ('Chilled Goods', 100),
  ('Dry Ingredients', 110),
  ('Garnishes', 120),
  ('Food Ingredients', 130),
  ('Cups and Lids', 140),
  ('Packaging', 150),
  ('Cleaning Supplies', 160),
  ('Miscellaneous', 170)
on conflict (lower(btrim(name))) do update
set
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- =========================================================
-- Phase I3 Notes
-- =========================================================
-- Controlled RPCs should be responsible for:
-- - stock in
-- - stock out
-- - waste
-- - adjustments
-- - reversal creation
-- - FIFO batch consumption
-- - keeping inventory_batches.quantity_remaining aligned with movement rows
-- - enforcing expiry_date requirements when inventory_items.track_expiry = true
