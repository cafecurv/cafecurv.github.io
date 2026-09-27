-- C1B: private, unverified website contact records. Draft; no historical backfill.
begin;
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  normalized_phone text unique not null check (normalized_phone ~ '^\+639[0-9]{9}$'),
  latest_name text,
  latest_delivery_address text,
  first_order_at timestamptz not null,
  last_order_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (first_order_at <= last_order_at)
);
alter table public.customers enable row level security;
revoke all on public.customers from public, anon, authenticated;
-- No customer policies: access is reserved to controlled owner-side backend logic.
comment on table public.customers is 'Private unverified contacts derived from website orders; phone matching is not proof of identity.';
alter table public.orders add column if not exists customer_id uuid
  references public.customers(id) on delete set null;
create index if not exists orders_customer_history_idx
  on public.orders(customer_id, created_at desc) where source = 'website' and customer_id is not null;
create schema if not exists customer_private;
revoke all on schema customer_private from public, anon, authenticated;
commit;
