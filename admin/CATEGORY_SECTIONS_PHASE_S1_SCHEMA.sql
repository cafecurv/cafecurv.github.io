-- =========================================================
-- CURV Control Menu Manager
-- Phase S1: Category Sections / Menu Sub-Sections Schema Draft
-- =========================================================
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- - Add admin-managed menu sub-sections under existing main categories.
-- - Allow products to optionally belong to a category section.
--
-- Important:
-- - This file does not create public menu views.
-- - This file does not update public_menu_products.
-- - This file does not seed category sections.
-- - Existing products remain valid because products.category_section_id is nullable.
-- - Customer-facing menu behavior is unchanged until a later approved phase.

-- =========================================================
-- Category Sections Table
-- =========================================================
-- A category section is a named sub-section inside one main category.
-- Example future usage:
-- - Espresso category -> Espresso-Based, Non-Espresso
-- - Matcha & Hojicha category -> Matcha, Hojicha, Cream Series

create table if not exists public.category_sections (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint category_sections_category_name_unique unique (category_id, name)
);

-- Keep category section lists stable and easy to order inside each category.
create index if not exists category_sections_category_order_idx
  on public.category_sections (category_id, sort_order, name);

-- =========================================================
-- Products: Optional Category Section Link
-- =========================================================
-- Existing products are not forced into a section. They can remain null until
-- the admin UI supports section assignment.

alter table public.products
  add column if not exists category_section_id uuid;

-- Add the foreign key in an idempotent block so rerunning this draft does not
-- fail if the constraint already exists.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_category_section_id_fkey'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_category_section_id_fkey
      foreign key (category_section_id)
      references public.category_sections(id)
      on delete set null;
  end if;
end $$;

create index if not exists products_category_section_id_idx
  on public.products (category_section_id);

-- =========================================================
-- Row Level Security
-- =========================================================
-- Category sections are admin-managed only in this phase.
-- No anonymous/public read policies are added here.

alter table public.category_sections enable row level security;

-- =========================================================
-- Owner/Admin Policy
-- =========================================================
-- Uses the existing public.is_admin() helper from the owner access phase.
-- Owners can fully manage category sections from CURV Control.

drop policy if exists "Owners can manage category sections" on public.category_sections;
create policy "Owners can manage category sections"
  on public.category_sections
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- Out of Scope for Phase S1
-- =========================================================
-- Do not add public views yet.
-- Do not update public_menu_products yet.
-- Do not create public_menu_category_sections yet.
-- Do not seed category sections yet.
-- Do not connect customer menu rendering yet.
