-- CURV Control Menu Manager
-- Phase 2A Manual Test Queries
--
-- Purpose:
-- Manual Supabase SQL Editor checks for Phase 2A public menu read access.
-- This file is for testing/review only.
-- Do not run against production until reviewed and approved.
--
-- Expected safety model:
--   - Customer app should query only public.public_menu_* views.
--   - Public views should work for anonymous reads.
--   - Private fields such as products.notes and product_sizes.cost should fail for anon.
--   - admin_profiles should fail for anon.
--   - No anonymous writes should exist.

-- =========================================================
-- 1. Normal Public View Checks
-- =========================================================
-- Expected:
-- These should return customer-safe rows only.
-- They should not expose admin-only fields such as notes, cost, timestamps,
-- or raw publish/availability state.
select *
from public.public_menu_categories
order by sort_order, name;

select *
from public.public_menu_products
order by sort_order, name;

select *
from public.public_menu_product_sizes
order by sort_order, label;

-- =========================================================
-- 2. Anon Role Checks
-- =========================================================
-- Expected:
-- These should work under anon role after Phase 2A is applied.
-- They should return only customer-safe view columns and rows.
begin;
set local role anon;

select *
from public.public_menu_categories
order by sort_order, name;

select *
from public.public_menu_products
order by sort_order, name;

select *
from public.public_menu_product_sizes
order by sort_order, label;

rollback;

-- =========================================================
-- 3. Private Field Blocking Checks
-- =========================================================
-- Expected:
-- Each query in this transaction SHOULD FAIL for anon.
-- If one fails, the transaction may become aborted; run each query separately
-- if Supabase SQL Editor stops after the first expected error.
--
-- Private fields must remain admin-only:
--   - products.notes
--   - product_sizes.cost
--   - admin_profiles
begin;
set local role anon;

-- SHOULD FAIL: products.notes is internal-only.
select notes
from public.products
limit 1;

-- SHOULD FAIL: product_sizes.cost is internal-only.
select cost
from public.product_sizes
limit 1;

-- SHOULD FAIL: admin_profiles must not be readable by anon.
select *
from public.admin_profiles
limit 1;

rollback;

-- =========================================================
-- 4. Raw-Table Limited Access Checks
-- =========================================================
-- Expected:
-- These raw-table reads may work only for the narrowly granted columns needed
-- by security_invoker views and RLS predicates.
--
-- Important:
-- Customer app code should still query only public_menu_* views.
-- Raw table reads are not the public API.
-- RLS should limit anon rows to active categories and published available products.
-- No draft or unavailable products should appear.
begin;
set local role anon;

-- Allowed category columns only.
-- Expected rows: active categories only.
select
  id,
  name,
  sort_order,
  is_active
from public.categories
order by sort_order, name;

-- Allowed product columns only.
-- Expected rows: published and available products only.
-- Should not expose products.notes, created_at, or updated_at.
select
  id,
  category_id,
  name,
  description,
  image_url,
  is_curv_pick,
  is_seasonal,
  variant_group_name,
  sort_order,
  is_published,
  is_available
from public.products
order by sort_order, name;

-- Allowed product size columns only.
-- Expected rows: sizes for published and available products only.
-- Should not expose product_sizes.cost.
select
  id,
  product_id,
  label,
  price,
  sort_order
from public.product_sizes
order by sort_order, label;

rollback;

-- =========================================================
-- 5. No Anonymous Write Safety Checks
-- =========================================================
-- Expected:
-- Anonymous insert/update/delete operations should NOT exist.
-- These are examples only. Do not run unless you are intentionally testing
-- failed writes in a safe review environment.
--
-- begin;
-- set local role anon;
--
-- -- SHOULD FAIL: anon must not create categories.
-- insert into public.categories (name, sort_order)
-- values ('Anon Test Category', 999);
--
-- -- SHOULD FAIL: anon must not update products.
-- update public.products
-- set name = name
-- limit 1;
--
-- -- SHOULD FAIL: anon must not delete product sizes.
-- delete from public.product_sizes
-- where false;
--
-- rollback;

-- =========================================================
-- Final Reminder
-- =========================================================
-- The future customer menu should query only:
--   - public.public_menu_categories
--   - public.public_menu_products
--   - public.public_menu_product_sizes
--
-- It should not query raw admin tables directly.