-- DRAFT: Run manually in Supabase SQL Editor only after review. Do not run before final approval.

-- CURV Control Menu Manager
-- Option / Add-on Groups
-- Phase A Schema Draft
--
-- Purpose:
-- Create the first database shape for reusable product option groups,
-- option choices, product-specific option assignments, and product defaults.
--
-- This file does not connect the customer menu to option rendering.
-- This file does not seed any option groups or choices.
-- This file does not change product variants/prices.
-- This file does not add POS, inventory, recipes, orders, checkout, or reports.
--
-- Important modeling notes:
--   - Product notes are intentionally not modeled here.
--   - Size/variant pricing remains in public.product_sizes.
--   - Relative milk pricing/default-choice-as-free is a future frontend
--     rendering rule, not schema in Phase A.
--   - Savory sauce defaults are the first safe future rendering test,
--     but no seed data is included in this file.

-- =========================================================
-- Extensions
-- =========================================================
-- gen_random_uuid() is commonly available in Supabase/Postgres.
-- Keeping this explicit makes the draft easier to run in a fresh project.
create extension if not exists pgcrypto;

-- =========================================================
-- Option Groups
-- =========================================================
-- Reusable option group identity, such as Milk, Syrup, Sauce,
-- Extra Shot, Add-ons, or Temperature.
--
-- group_key is a stable admin/developer-safe key that can stay consistent
-- even if the display name changes later.
--
-- selection_type supports selectable option groups only:
--   - single: customer chooses one option
--   - multi: customer may choose multiple options
--
-- Notes/item notes are intentionally not modeled as option groups in Phase A.
create table if not exists public.option_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  group_key text not null unique,
  selection_type text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint option_groups_selection_type_check check (selection_type in ('single', 'multi'))
);

create index if not exists option_groups_active_sort_order_idx
  on public.option_groups (is_active, sort_order, name);

-- =========================================================
-- Option Choices
-- =========================================================
-- Choices inside each group, such as Full Cream, Oat, Vanilla,
-- Tempura Sauce, Sweet Chili Sauce, or Garlic Aioli.
--
-- price_delta is the additional customer-facing price for the choice.
-- Keep default/free choices at 0. Future frontend rendering may decide
-- how to display default/free choices relative to paid alternatives.
create table if not exists public.option_choices (
  id uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references public.option_groups(id) on delete cascade,
  label text not null,
  value text,
  price_delta numeric not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint option_choices_id_group_unique unique (id, option_group_id),
  constraint option_choices_price_delta_nonnegative check (price_delta >= 0)
);

create index if not exists option_choices_group_sort_order_idx
  on public.option_choices (option_group_id, sort_order, label);

create index if not exists option_choices_active_group_idx
  on public.option_choices (is_active, option_group_id);

-- =========================================================
-- Product Option Group Assignments
-- =========================================================
-- Attach reusable option groups to products and define product-specific
-- required/min/max behavior.
--
-- Required/min/max rules live here, not on option_groups, because the same
-- reusable group can behave differently for different products.
create table if not exists public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  option_group_id uuid not null references public.option_groups(id) on delete cascade,
  is_required boolean not null default false,
  min_selections integer not null default 0,
  max_selections integer,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_option_groups_unique_product_group unique (product_id, option_group_id),
  constraint product_option_groups_min_nonnegative check (min_selections >= 0),
  constraint product_option_groups_max_valid check (
    max_selections is null
    or max_selections >= min_selections
  )
);

create index if not exists product_option_groups_product_sort_order_idx
  on public.product_option_groups (product_id, sort_order);

create index if not exists product_option_groups_active_product_idx
  on public.product_option_groups (is_active, product_id);

-- =========================================================
-- Product Option Defaults
-- =========================================================
-- Stores product-specific default choices, such as Savory sauce defaults:
--   - Shrimp Tempura -> Tempura Sauce
--   - Chicken Karaage -> Sweet Chili Sauce
--   - Cream Dory Fillet -> Garlic Aioli
--
-- This table intentionally stores defaults per product/group/choice because
-- group-level defaults are not enough for CURV's product-specific behavior.
create table if not exists public.product_option_defaults (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  option_group_id uuid not null references public.option_groups(id) on delete cascade,
  option_choice_id uuid not null references public.option_choices(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint product_option_defaults_unique_choice unique (product_id, option_group_id, option_choice_id),
  constraint product_option_defaults_choice_group_fk
    foreign key (option_choice_id, option_group_id)
    references public.option_choices(id, option_group_id)
    on delete cascade,
  constraint product_option_defaults_assignment_fk
    foreign key (product_id, option_group_id)
    references public.product_option_groups(product_id, option_group_id)
    on delete cascade
);

create index if not exists product_option_defaults_product_group_idx
  on public.product_option_defaults (product_id, option_group_id);

-- =========================================================
-- Row Level Security
-- =========================================================
-- RLS is enabled now so these tables are protected by default.
-- Owner/admin access uses the existing public.is_admin() helper from
-- Phase 1S-B.
--
-- This file adds no anonymous writes.
alter table public.option_groups enable row level security;
alter table public.option_choices enable row level security;
alter table public.product_option_groups enable row level security;
alter table public.product_option_defaults enable row level security;

-- =========================================================
-- Owner/Admin Policies
-- =========================================================
-- Owners can fully manage option groups, choices, assignments, and defaults.
-- These policies are for CURV Control only. They are not public customer menu
-- policies.

drop policy if exists "Owners can manage option groups" on public.option_groups;
create policy "Owners can manage option groups"
  on public.option_groups
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Owners can manage option choices" on public.option_choices;
create policy "Owners can manage option choices"
  on public.option_choices
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Owners can manage product option groups" on public.product_option_groups;
create policy "Owners can manage product option groups"
  on public.product_option_groups
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Owners can manage product option defaults" on public.product_option_defaults;
create policy "Owners can manage product option defaults"
  on public.product_option_defaults
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- Public-Safe Option Group View
-- =========================================================
-- Exposes only active option group assignments for products that are both
-- published and available.
--
-- Intentionally excludes:
--   - option_groups.is_active
--   - product_option_groups.is_active
--   - created_at timestamps
--
-- Customer menu code should query public_menu_* views, not raw option tables.
create or replace view public.public_menu_option_groups
with (security_invoker = true)
as
select
  pog.product_id,
  og.id as option_group_id,
  og.group_key,
  og.name,
  og.selection_type,
  pog.is_required,
  pog.min_selections,
  pog.max_selections,
  pog.sort_order
from public.product_option_groups pog
join public.option_groups og
  on og.id = pog.option_group_id
join public.products p
  on p.id = pog.product_id
where p.is_published = true
  and p.is_available = true
  and og.is_active = true
  and pog.is_active = true;

comment on view public.public_menu_option_groups is
  'Customer-safe option group assignment view. Returns active option groups for published available products only.';

-- =========================================================
-- Public-Safe Option Choice View
-- =========================================================
-- Exposes only active choices belonging to active option group assignments
-- for products that are both published and available.
--
-- Intentionally excludes:
--   - option_choices.is_active
--   - created_at timestamps
create or replace view public.public_menu_option_choices
with (security_invoker = true)
as
select
  pog.product_id,
  og.id as option_group_id,
  oc.id as option_choice_id,
  oc.label,
  oc.value,
  oc.price_delta,
  oc.sort_order
from public.product_option_groups pog
join public.option_groups og
  on og.id = pog.option_group_id
join public.option_choices oc
  on oc.option_group_id = og.id
join public.products p
  on p.id = pog.product_id
where p.is_published = true
  and p.is_available = true
  and og.is_active = true
  and pog.is_active = true
  and oc.is_active = true;

comment on view public.public_menu_option_choices is
  'Customer-safe option choice view. Returns active choices for active option groups on published available products only.';

-- =========================================================
-- Public-Safe Option Default View
-- =========================================================
-- Exposes product-specific default choices only when the product, assignment,
-- option group, and choice are all customer-safe.
create or replace view public.public_menu_option_defaults
with (security_invoker = true)
as
select
  pod.product_id,
  pod.option_group_id,
  pod.option_choice_id
from public.product_option_defaults pod
join public.product_option_groups pog
  on pog.product_id = pod.product_id
  and pog.option_group_id = pod.option_group_id
join public.option_groups og
  on og.id = pod.option_group_id
join public.option_choices oc
  on oc.id = pod.option_choice_id
  and oc.option_group_id = pod.option_group_id
join public.products p
  on p.id = pod.product_id
where p.is_published = true
  and p.is_available = true
  and og.is_active = true
  and pog.is_active = true
  and oc.is_active = true;

comment on view public.public_menu_option_defaults is
  'Customer-safe option default view. Returns product-specific defaults only for published available products with active option assignments and choices.';

-- =========================================================
-- Public View Grants
-- =========================================================
-- Anonymous users may read only the customer-safe option views.
-- No anonymous write access is granted.
grant select on public.public_menu_option_groups to anon;
grant select on public.public_menu_option_choices to anon;
grant select on public.public_menu_option_defaults to anon;

-- =========================================================
-- Narrow Base-Table Read Support For security_invoker Views
-- =========================================================
-- SECURITY NOTE:
-- security_invoker views obey the permissions and RLS policies of the
-- calling user. Supabase/Postgres may require anonymous users to have
-- narrowly scoped SELECT access on the underlying base tables for these
-- views to work.
--
-- These grants intentionally expose only customer-safe columns plus predicate
-- columns needed by security_invoker views and RLS checks.
--
-- They do not grant admin-only data, timestamps, product notes, product size
-- cost, or admin profile data.
--
-- Customer app code should still query only the public_menu_* views.
revoke all on public.option_groups from anon;
revoke all on public.option_choices from anon;
revoke all on public.product_option_groups from anon;
revoke all on public.product_option_defaults from anon;

grant select (
  id,
  name,
  group_key,
  selection_type,
  is_active,
  sort_order
) on public.option_groups to anon;

grant select (
  id,
  option_group_id,
  label,
  value,
  price_delta,
  sort_order,
  is_active
) on public.option_choices to anon;

grant select (
  product_id,
  option_group_id,
  is_required,
  min_selections,
  max_selections,
  sort_order,
  is_active
) on public.product_option_groups to anon;

grant select (
  product_id,
  option_group_id,
  option_choice_id
) on public.product_option_defaults to anon;

-- =========================================================
-- Public Read RLS Policies
-- =========================================================
-- Preserve existing owner-only admin policies.
-- Add only the minimum anonymous read policies needed for future customer
-- option reads through public-safe views.
--
-- These policies do not allow anonymous writes.

drop policy if exists "Public can read active option groups" on public.option_groups;
create policy "Public can read active option groups"
  on public.option_groups
  for select
  to anon
  using (is_active = true);

drop policy if exists "Public can read active option choices" on public.option_choices;
create policy "Public can read active option choices"
  on public.option_choices
  for select
  to anon
  using (
    is_active = true
    and exists (
      select 1
      from public.option_groups og
      where og.id = option_choices.option_group_id
        and og.is_active = true
    )
  );

drop policy if exists "Public can read active product option groups" on public.product_option_groups;
create policy "Public can read active product option groups"
  on public.product_option_groups
  for select
  to anon
  using (
    is_active = true
    and exists (
      select 1
      from public.products p
      where p.id = product_option_groups.product_id
        and p.is_published = true
        and p.is_available = true
    )
    and exists (
      select 1
      from public.option_groups og
      where og.id = product_option_groups.option_group_id
        and og.is_active = true
    )
  );

drop policy if exists "Public can read active product option defaults" on public.product_option_defaults;
create policy "Public can read active product option defaults"
  on public.product_option_defaults
  for select
  to anon
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_option_defaults.product_id
        and p.is_published = true
        and p.is_available = true
    )
    and exists (
      select 1
      from public.product_option_groups pog
      where pog.product_id = product_option_defaults.product_id
        and pog.option_group_id = product_option_defaults.option_group_id
        and pog.is_active = true
    )
    and exists (
      select 1
      from public.option_groups og
      where og.id = product_option_defaults.option_group_id
        and og.is_active = true
    )
    and exists (
      select 1
      from public.option_choices oc
      where oc.id = product_option_defaults.option_choice_id
        and oc.option_group_id = product_option_defaults.option_group_id
        and oc.is_active = true
    )
  );

-- =========================================================
-- Public Write Safety
-- =========================================================
-- No insert/update/delete grants or policies are added for anonymous users.
-- Anonymous users should not be able to create, edit, delete, publish, or
-- manage option data.
--
-- Future customer menu JavaScript should query:
--   - public.public_menu_option_groups
--   - public.public_menu_option_choices
--   - public.public_menu_option_defaults
--
-- It should not query raw option tables directly.

-- =========================================================
-- Phase A Seed Safety
-- =========================================================
-- No seed data is included in Phase A.
-- Option groups, choices, product assignments, and defaults should be created
-- later through reviewed admin UI or a separately reviewed seed draft.
