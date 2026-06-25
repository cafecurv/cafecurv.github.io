-- CURV Control Menu Manager
-- Option / Add-on Groups
-- Phase A Verification Queries
--
-- Purpose:
-- Verify that the Phase A option/add-on schema exists after manual Supabase execution.
--
-- Safe usage:
-- These are SELECT-only checks.
-- This file does not insert, update, delete, drop, alter, or create anything.

-- =========================================================
-- 1. Table Existence Check
-- =========================================================
-- Expected result:
-- Four rows, one for each Phase A table.
select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'option_groups',
    'option_choices',
    'product_option_groups',
    'product_option_defaults'
  )
order by table_name;

-- =========================================================
-- 2. Public View Existence Check
-- =========================================================
-- Expected result:
-- Three rows, one for each customer-safe option view.
select
  table_schema,
  table_name as view_name
from information_schema.views
where table_schema = 'public'
  and table_name in (
    'public_menu_option_groups',
    'public_menu_option_choices',
    'public_menu_option_defaults'
  )
order by table_name;

-- =========================================================
-- 3. New Table Row Counts
-- =========================================================
-- Expected result immediately after Phase A:
-- All four counts should be 0 because Phase A includes no seed data.
select
  'option_groups' as table_name,
  count(*) as row_count
from public.option_groups
union all
select
  'option_choices' as table_name,
  count(*) as row_count
from public.option_choices
union all
select
  'product_option_groups' as table_name,
  count(*) as row_count
from public.product_option_groups
union all
select
  'product_option_defaults' as table_name,
  count(*) as row_count
from public.product_option_defaults
order by table_name;

-- =========================================================
-- 4. Public View Row Counts
-- =========================================================
-- Expected result immediately after Phase A:
-- These should also be 0 until option groups, choices, assignments,
-- and defaults are created later.
select
  'public_menu_option_groups' as view_name,
  count(*) as row_count
from public.public_menu_option_groups
union all
select
  'public_menu_option_choices' as view_name,
  count(*) as row_count
from public.public_menu_option_choices
union all
select
  'public_menu_option_defaults' as view_name,
  count(*) as row_count
from public.public_menu_option_defaults
order by view_name;

-- =========================================================
-- 5. RLS Status Check
-- =========================================================
-- Expected result:
-- relrowsecurity should be true for all four Phase A tables.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'option_groups',
    'option_choices',
    'product_option_groups',
    'product_option_defaults'
  )
order by c.relname;

-- =========================================================
-- 6. Policy Presence Check
-- =========================================================
-- Expected result:
-- Owner/admin policies and public read policies should appear for the
-- Phase A option tables.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'option_groups',
    'option_choices',
    'product_option_groups',
    'product_option_defaults'
  )
order by tablename, policyname;
