-- Incoming Orders Phase A Schema Draft
--
-- Purpose:
-- Create the database foundation for guest online order submissions and the
-- CURV Control Incoming Orders dashboard.
--
-- This phase is schema only:
-- - No customer menu wiring.
-- - No admin UI wiring.
-- - No customer accounts, rewards, loyalty, saved addresses, or order history.
-- - No inventory/POS deduction.
--
-- Public guest order creation is intentionally postponed to a later phase and
-- should happen through a controlled RPC such as public.submit_public_order(...).
-- Do not grant broad anonymous raw-table access to orders or order_items.

-- =========================================================
-- Extensions
-- =========================================================
-- gen_random_uuid() is commonly available in Supabase/Postgres.
create extension if not exists pgcrypto;

-- =========================================================
-- Updated-at Helper
-- =========================================================
-- Reuse the Menu Manager helper when it already exists. Creating or replacing
-- it here keeps this draft safe to run independently in a reviewed project.
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
-- Orders
-- =========================================================
-- orders stores the guest/customer snapshot for the submitted order.
-- Customer account tables are intentionally postponed; guest contact details
-- live directly on orders for the first Incoming Orders phase.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  status text not null default 'submitted',
  customer_name text not null,
  customer_phone text not null,
  customer_email text null,
  fulfillment_type text not null default 'pickup',
  pickup_time text null,
  customer_notes text null,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  currency text not null default 'PHP',
  payment_method text null,
  payment_status text not null default 'unpaid',
  source text not null default 'website',
  admin_notes text null,
  cancel_reason text null,
  accepted_at timestamptz null,
  preparing_at timestamptz null,
  ready_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_status_check check (
    status in (
      'submitted',
      'accepted',
      'preparing',
      'ready',
      'completed',
      'cancelled'
    )
  ),
  constraint orders_payment_status_check check (
    payment_status in (
      'unpaid',
      'pending',
      'paid',
      'refunded'
    )
  ),
  constraint orders_fulfillment_type_check check (
    fulfillment_type in ('pickup')
  ),
  constraint orders_subtotal_nonnegative_check check (subtotal >= 0),
  constraint orders_total_nonnegative_check check (total >= 0)
);

-- Helpful indexes for the owner/admin Incoming Orders dashboard.
create index if not exists orders_status_idx
  on public.orders (status);

create index if not exists orders_created_at_desc_idx
  on public.orders (created_at desc);

create index if not exists orders_order_number_idx
  on public.orders (order_number);

-- Keep orders.updated_at fresh on owner/admin edits.
drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

-- =========================================================
-- Order Items
-- =========================================================
-- order_items stores a product snapshot at the time of ordering. Product names,
-- variant labels, prices, and options should remain readable even if the menu
-- changes later.
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid null,
  product_size_id uuid null,
  product_name text not null,
  category_name text null,
  variant_label text null,
  quantity integer not null,
  unit_price numeric(10,2) not null,
  line_total numeric(10,2) not null,
  options jsonb not null default '{}'::jsonb,
  item_note text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint order_items_quantity_positive_check check (quantity > 0),
  constraint order_items_unit_price_nonnegative_check check (unit_price >= 0),
  constraint order_items_line_total_nonnegative_check check (line_total >= 0)
);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

-- =========================================================
-- Row Level Security
-- =========================================================
-- RLS is enabled immediately. Guest customers should not read raw order data,
-- update order status, or insert directly into these tables in Phase A.
-- Public submission should be added later through a controlled RPC, for example:
-- public.submit_public_order(order_payload jsonb).
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- =========================================================
-- Owner/Admin Policies
-- =========================================================
-- These policies use the existing public.is_admin() helper from the owner
-- access phase. They allow CURV Control owners to manage incoming orders.

drop policy if exists "Owners can select orders" on public.orders;
create policy "Owners can select orders"
  on public.orders
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can insert orders" on public.orders;
create policy "Owners can insert orders"
  on public.orders
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Owners can update orders" on public.orders;
create policy "Owners can update orders"
  on public.orders
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Owners can delete orders" on public.orders;
create policy "Owners can delete orders"
  on public.orders
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can select order items" on public.order_items;
create policy "Owners can select order items"
  on public.order_items
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can insert order items" on public.order_items;
create policy "Owners can insert order items"
  on public.order_items
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Owners can update order items" on public.order_items;
create policy "Owners can update order items"
  on public.order_items
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Owners can delete order items" on public.order_items;
create policy "Owners can delete order items"
  on public.order_items
  for delete
  to authenticated
  using (public.is_admin());

-- =========================================================
-- Grants
-- =========================================================
-- Authenticated users still need table privileges; RLS policies above restrict
-- actual access to owner/admin users only.
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;

-- No anon grants are added in Phase A.
-- Do not grant raw select/insert/update/delete on orders or order_items to anon.
