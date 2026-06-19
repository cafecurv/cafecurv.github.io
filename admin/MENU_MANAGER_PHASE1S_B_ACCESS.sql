-- CURV Control Menu Manager
-- Phase 1S-B Owner Access SQL Draft
--
-- Purpose:
-- Add the smallest owner-only admin access layer for CURV Control.
-- This file is a draft migration only.
-- Do not run until reviewed and approved.
--
-- This file assumes these Phase 1 tables already exist:
--   - public.categories
--   - public.products
--   - public.product_sizes
--
-- Out of scope for this phase:
--   - public customer menu reads
--   - staff roles
--   - POS
--   - inventory
--   - recipes
--   - orders
--   - options/add-ons

-- =========================================================
-- Admin Profiles
-- =========================================================
-- This table is a tiny allowlist for CURV Control admin access.
-- Each row links directly to one Supabase Auth user.
-- For now, the only allowed role is 'owner'.
create table if not exists public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner',
  full_name text,
  created_at timestamptz not null default now(),
  constraint admin_profiles_role_owner_only check (role in ('owner'))
);

-- Protect the admin allowlist with RLS.
alter table public.admin_profiles enable row level security;

-- =========================================================
-- Admin Helper Function
-- =========================================================
-- public.is_admin() returns true only when the current logged-in user
-- has a matching owner row in public.admin_profiles.
--
-- SECURITY DEFINER is used intentionally because RLS policies call this
-- helper, and the helper must be able to check admin_profiles without
-- getting blocked by admin_profiles RLS itself.
--
-- The search_path is pinned to public to keep function lookup predictable.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles ap
    where ap.id = auth.uid()
      and ap.role = 'owner'
  );
$$;

-- Keep the helper callable by logged-in users only.
-- Anonymous users do not need this helper because this phase adds no public access.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- =========================================================
-- Admin Profiles RLS Policies
-- =========================================================
-- Owners may read only their own admin profile row.
-- No insert/update/delete policies are added here.
-- The first owner row should be inserted manually through Supabase SQL Editor
-- after the owner Auth user exists.
drop policy if exists "Owners can read own admin profile" on public.admin_profiles;
create policy "Owners can read own admin profile"
  on public.admin_profiles
  for select
  to authenticated
  using (id = auth.uid() and public.is_admin());

-- =========================================================
-- Owner-Only Menu Manager Policies
-- =========================================================
-- These policies give the owner account full read/write access to the
-- Phase 1 Menu Manager tables.
--
-- Important:
-- These are NOT public customer menu policies.
-- Anonymous users still have zero access.
-- These policies do not expose products.notes publicly.

-- Categories: owner-only select/insert/update/delete.
drop policy if exists "Owners can manage categories" on public.categories;
create policy "Owners can manage categories"
  on public.categories
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Products: owner-only select/insert/update/delete.
-- products.notes remains admin/internal only because no public policies exist.
drop policy if exists "Owners can manage products" on public.products;
create policy "Owners can manage products"
  on public.products
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Product sizes: owner-only select/insert/update/delete.
drop policy if exists "Owners can manage product sizes" on public.product_sizes;
create policy "Owners can manage product sizes"
  on public.product_sizes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- Manual Bootstrap Instructions
-- =========================================================
-- 1. Create the CURV owner account in Supabase Auth first.
-- 2. In Supabase Dashboard, open Authentication > Users.
-- 3. Copy the owner user's UUID.
-- 4. In Supabase SQL Editor, manually insert one owner row:
--
--    insert into public.admin_profiles (id, role, full_name)
--    values ('PASTE_OWNER_AUTH_USER_UUID_HERE', 'owner', 'CURV Owner');
--
-- 5. Do not share passwords, service role keys, secret keys, or API secrets.
-- 6. Keep anonymous public access closed until a future public-safe menu view
--    is designed and approved.