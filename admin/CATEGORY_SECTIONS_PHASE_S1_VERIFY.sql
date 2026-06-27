-- =========================================================
-- CURV Control Menu Manager
-- Phase S1: Category Sections Verification Queries
-- =========================================================
-- SELECT-only verification file.
-- Run manually in Supabase SQL Editor after running:
-- admin/CATEGORY_SECTIONS_PHASE_S1_SCHEMA.sql
--
-- This file returns ONE combined result table so Supabase SQL Editor shows
-- every verification check together.

with checks as (
  -- 1. Confirm public.category_sections table exists.
  select
    'category_sections table exists'::text as check_name,
    exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'category_sections'
    ) as passed,
    null::text as detail

  union all

  -- 2. Confirm public.products.category_section_id column exists.
  select
    'products.category_section_id column exists'::text as check_name,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'products'
        and column_name = 'category_section_id'
        and data_type = 'uuid'
    ) as passed,
    null::text as detail

  union all

  -- 3. Confirm FK from category_sections.category_id to categories(id) exists.
  select
    'category_sections.category_id FK exists'::text as check_name,
    exists (
      select 1
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_schema = kcu.constraint_schema
       and tc.constraint_name = kcu.constraint_name
      join information_schema.constraint_column_usage ccu
        on tc.constraint_schema = ccu.constraint_schema
       and tc.constraint_name = ccu.constraint_name
      where tc.table_schema = 'public'
        and tc.table_name = 'category_sections'
        and tc.constraint_type = 'FOREIGN KEY'
        and kcu.column_name = 'category_id'
        and ccu.table_schema = 'public'
        and ccu.table_name = 'categories'
        and ccu.column_name = 'id'
    ) as passed,
    'category_sections.category_id -> categories.id'::text as detail

  union all

  -- 4. Confirm FK from products.category_section_id to category_sections(id) exists.
  select
    'products.category_section_id FK exists'::text as check_name,
    exists (
      select 1
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_schema = kcu.constraint_schema
       and tc.constraint_name = kcu.constraint_name
      join information_schema.constraint_column_usage ccu
        on tc.constraint_schema = ccu.constraint_schema
       and tc.constraint_name = ccu.constraint_name
      where tc.table_schema = 'public'
        and tc.table_name = 'products'
        and tc.constraint_type = 'FOREIGN KEY'
        and kcu.column_name = 'category_section_id'
        and ccu.table_schema = 'public'
        and ccu.table_name = 'category_sections'
        and ccu.column_name = 'id'
    ) as passed,
    'products.category_section_id -> category_sections.id'::text as detail

  union all

  -- 5. Confirm unique(category_id, name) constraint exists.
  select
    'category_sections unique(category_id, name) exists'::text as check_name,
    exists (
      select 1
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_schema = kcu.constraint_schema
       and tc.constraint_name = kcu.constraint_name
      where tc.table_schema = 'public'
        and tc.table_name = 'category_sections'
        and tc.constraint_type = 'UNIQUE'
        and tc.constraint_name = 'category_sections_category_name_unique'
      group by tc.constraint_name
      having array_agg(kcu.column_name::text order by kcu.ordinal_position) = array['category_id', 'name']::text[]
    ) as passed,
    'unique category section names within each category'::text as detail

  union all

  -- 6. Confirm category_sections_category_order_idx exists.
  select
    'category_sections_category_order_idx exists'::text as check_name,
    exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'category_sections'
        and indexname = 'category_sections_category_order_idx'
    ) as passed,
    'category_sections(category_id, sort_order, name)'::text as detail

  union all

  -- 7. Confirm products_category_section_id_idx exists.
  select
    'products_category_section_id_idx exists'::text as check_name,
    exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'products'
        and indexname = 'products_category_section_id_idx'
    ) as passed,
    'products(category_section_id)'::text as detail

  union all

  -- 8. Confirm RLS is enabled on category_sections.
  select
    'category_sections RLS enabled'::text as check_name,
    coalesce((
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n
        on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'category_sections'
    ), false) as passed,
    null::text as detail

  union all

  -- 9. Confirm owner/admin policy exists.
  select
    'owner/admin category sections policy exists'::text as check_name,
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'category_sections'
        and policyname = 'Owners can manage category sections'
    ) as passed,
    'Owners can manage category sections'::text as detail
),
counts as (
  -- 10. Count category_sections rows.
  select
    'category_sections row count'::text as check_name,
    'INFO'::text as status,
    count(*)::text as detail
  from public.category_sections

  union all

  -- 11. Count products with a non-null category_section_id.
  select
    'products with non-null category_section_id count'::text as check_name,
    'INFO'::text as status,
    count(*)::text as detail
  from public.products
  where category_section_id is not null
)
select
  check_name,
  case when passed then 'PASS' else 'FAIL' end as status,
  coalesce(detail, '') as detail
from checks

union all

select
  check_name,
  status,
  detail
from counts;
