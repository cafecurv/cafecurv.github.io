-- CURV Control Menu Manager
-- Phase 1 Schema Draft
--
-- Purpose:
-- Create the first database shape for menu categories, products, and product sizes.
-- This draft is not connected to the live customer menu yet.
-- Do not run in production until reviewed and approved.

-- =========================================================
-- Extensions
-- =========================================================
-- gen_random_uuid() is commonly available in Supabase/Postgres.
-- Keeping this explicit makes the draft easier to run in a fresh project.
create extension if not exists pgcrypto;

-- =========================================================
-- Updated-at helper
-- =========================================================
-- Keeps products.updated_at current whenever a product row changes.
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
-- Categories
-- =========================================================
-- Categories group products for the Menu Manager.
-- Categories should not be deleted while products still reference them.
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Helpful ordering index for admin and future public-safe menu reads.
create index if not exists categories_sort_order_idx
  on public.categories (sort_order, name);

-- =========================================================
-- Products
-- =========================================================
-- Products are draft by default.
-- Internal notes must never be exposed to public customer menu queries.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  description text,
  image_url text,
  is_available boolean not null default true,
  is_published boolean not null default false,
  is_curv_pick boolean not null default false,
  is_seasonal boolean not null default false,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_category_sort_order_idx
  on public.products (category_id, sort_order, name);

create index if not exists products_public_menu_idx
  on public.products (is_published, is_available, sort_order);

-- Keep products.updated_at fresh on edits.
drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

-- =========================================================
-- Product Sizes
-- =========================================================
-- All products use product_sizes.
-- Single-price products use one row, for example: label = 'Standard'.
-- Regular/Large products use two rows.
-- Piece-based products use rows such as '4 pcs', '8 pcs', and '12 pcs'.
-- If a product is deleted, its size rows are deleted automatically.
create table if not exists public.product_sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null,
  price numeric not null,
  sort_order integer not null default 0,
  constraint product_sizes_price_nonnegative check (price >= 0)
);

create index if not exists product_sizes_product_sort_order_idx
  on public.product_sizes (product_id, sort_order, label);

-- =========================================================
-- Row Level Security Draft
-- =========================================================
-- RLS is enabled now so tables are protected by default.
-- No active public read or write policies are added in Phase 1.
-- Without policies, anonymous users cannot read or write these tables.
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_sizes enable row level security;

-- Owner/admin draft policy notes:
-- Phase 2 should add a real admin access model before enabling write policies.
-- That may use Supabase Auth plus an admin profile table, role claims, or another
-- reviewed owner/admin check. Avoid broad policies such as "authenticated can write"
-- because they are too open for a real store admin.
--
-- Example only. Do not enable until an admin role check exists:
-- create policy "Admins can manage categories"
--   on public.categories
--   for all
--   using (public.current_user_is_admin())
--   with check (public.current_user_is_admin());
--
-- create policy "Admins can manage products"
--   on public.products
--   for all
--   using (public.current_user_is_admin())
--   with check (public.current_user_is_admin());
--
-- create policy "Admins can manage product sizes"
--   on public.product_sizes
--   for all
--   using (public.current_user_is_admin())
--   with check (public.current_user_is_admin());

-- Anonymous public draft policy notes:
-- Public users must never write to these tables.
-- Future public reads should only show:
--   - active categories
--   - published products
--   - available products
--   - product sizes belonging to those safe products
--
-- Important: RLS is row-level, not column-level.
-- Because products.notes is internal-only, do not expose the products table directly
-- to the public customer menu. Create a future public-safe view that excludes notes.
--
-- Future Phase 2 direction:
-- create view public.public_menu_products as
-- select
--   id,
--   category_id,
--   name,
--   description,
--   image_url,
--   is_curv_pick,
--   is_seasonal,
--   sort_order
-- from public.products
-- where is_published = true
--   and is_available = true;
--
-- Public read policies should be reviewed together with that view and should not
-- expose products.notes.

-- =========================================================
-- Seed Categories
-- =========================================================
-- Seed only the current Phase 1 categories.
-- Products and product sizes are intentionally not seeded yet.
insert into public.categories (name, sort_order)
values
  ('Espresso', 0),
  ('Matcha & Hojicha', 1),
  ('Curvccino', 2),
  ('Refreshers', 3),
  ('Bites', 4),
  ('Savory', 5),
  ('Salad Bar', 6),
  ('Pastries & Desserts', 7)
on conflict do nothing;