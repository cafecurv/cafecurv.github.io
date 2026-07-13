-- CURV Control Inventory Management
-- Phase I10B Recipes Backend Verification Draft
--
-- Read-only verification SQL plus commented rollback smoke-test templates.
-- Review before running manually in Supabase SQL Editor.
--
-- Do not run mutation examples against production data unless the owner has
-- reviewed the chosen IDs and the transaction remains rolled back.

-- =========================================================
-- 1. Object Existence Checks
-- =========================================================

select
  n.nspname as schema_name,
  c.relname as object_name,
  c.relkind as object_kind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'inventory_recipes',
    'inventory_recipe_lines',
    'inventory_recipe_line_details',
    'inventory_recipe_summary'
  )
order by c.relname;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'inventory_replace_recipe',
    'inventory_delete_recipe'
  )
order by p.proname;

-- =========================================================
-- 2. Column and Constraint Checks
-- =========================================================

select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  numeric_precision,
  numeric_scale,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'inventory_recipes',
    'inventory_recipe_lines'
  )
order by table_name, ordinal_position;

select
  conrelid::regclass::text as table_name,
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where conrelid in (
    'public.inventory_recipes'::regclass,
    'public.inventory_recipe_lines'::regclass
  )
order by conrelid::regclass::text, conname;

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'inventory_recipes',
    'inventory_recipe_lines'
  )
order by tablename, indexname;

-- Expected highlights:
-- - inventory_recipes.product_size_id is unique.
-- - inventory_recipes.product_size_id references product_sizes(id) on delete cascade.
-- - inventory_recipe_lines.recipe_id references inventory_recipes(id) on delete cascade.
-- - inventory_recipe_lines.inventory_item_id references inventory_items(id) on delete restrict.
-- - inventory_recipe_lines.quantity_required is numeric(14,3) and CHECK > 0.
-- - inventory_recipe_lines has UNIQUE(recipe_id, inventory_item_id).
-- - inventory_recipe_lines.sort_order CHECK >= 0.
-- - No unit column exists on inventory_recipe_lines.

-- =========================================================
-- 3. Foreign-Key Behavior Checks
-- =========================================================

select
  conrelid::regclass::text as table_name,
  conname as constraint_name,
  confrelid::regclass::text as references_table,
  confdeltype as delete_action_code,
  case confdeltype
    when 'a' then 'no action'
    when 'r' then 'restrict'
    when 'c' then 'cascade'
    when 'n' then 'set null'
    when 'd' then 'set default'
    else confdeltype::text
  end as delete_action,
  pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where contype = 'f'
  and conrelid in (
    'public.inventory_recipes'::regclass,
    'public.inventory_recipe_lines'::regclass
  )
order by conrelid::regclass::text, conname;

-- Expected:
-- - product_size deletion cascades to inventory_recipes.
-- - recipe deletion cascades to inventory_recipe_lines.
-- - inventory item deletion is restricted while recipe lines reference it.

-- =========================================================
-- 4. RLS and Policy Inspection
-- =========================================================

select
  n.nspname as schemaname,
  c.relname as tablename,
  c.relrowsecurity as rowsecurity,
  c.relforcerowsecurity as forcerowsecurity
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relname in (
    'inventory_recipes',
    'inventory_recipe_lines'
  )
order by c.relname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'inventory_recipes',
    'inventory_recipe_lines'
  )
order by tablename, policyname;

-- Expected:
-- - RLS enabled on both recipe tables.
-- - SELECT policies only.
-- - Policies are to authenticated and use public.is_admin().
-- - No INSERT/UPDATE/DELETE policies are present.

-- =========================================================
-- 5. Grants and Function-Execution Inspection
-- =========================================================

select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'inventory_recipes',
    'inventory_recipe_lines',
    'inventory_recipe_line_details',
    'inventory_recipe_summary'
  )
order by table_name, grantee, privilege_type;

select
  n.nspname as schema_name,
  p.proname as function_name,
  coalesce(r.rolname, 'PUBLIC') as grantee,
  a.privilege_type,
  a.is_grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a on true
left join pg_roles r on r.oid = a.grantee
where n.nspname = 'public'
  and p.proname in (
    'inventory_replace_recipe',
    'inventory_delete_recipe'
  )
  and a.privilege_type = 'EXECUTE'
order by p.proname, grantee;

-- Expected:
-- - anon has no table/view recipe privileges.
-- - authenticated has SELECT on recipe tables/views only.
-- - authenticated can execute recipe RPCs.
-- - anon cannot execute recipe RPCs.
-- - public cannot execute recipe RPCs.

-- =========================================================
-- 6. Product-Size Coverage Diagnostic
-- =========================================================

with product_size_counts as (
  select
    p.id as product_id,
    p.name as product_name,
    p.is_published,
    p.is_available,
    count(ps.id) as product_size_count
  from public.products p
  left join public.product_sizes ps on ps.product_id = p.id
  group by p.id, p.name, p.is_published, p.is_available
),
duplicate_size_labels as (
  select
    ps.product_id,
    lower(btrim(ps.label)) as normalized_label,
    count(*) as duplicate_count
  from public.product_sizes ps
  group by ps.product_id, lower(btrim(ps.label))
  having count(*) > 1
)
select
  'product_without_sizes' as issue_type,
  product_id,
  product_name,
  null::text as detail
from product_size_counts
where product_size_count = 0
union all
select
  'active_product_recipe_attachment_impossible' as issue_type,
  product_id,
  product_name,
  'published or available product has no product_sizes row' as detail
from product_size_counts
where product_size_count = 0
  and (is_published = true or is_available = true)
union all
select
  'duplicate_product_size_label' as issue_type,
  p.id as product_id,
  p.name as product_name,
  d.normalized_label || ' (' || d.duplicate_count::text || ' rows)' as detail
from duplicate_size_labels d
join public.products p on p.id = d.product_id
union all
select
  'blank_product_size_label' as issue_type,
  p.id as product_id,
  p.name as product_name,
  ps.id::text as detail
from public.product_sizes ps
join public.products p on p.id = ps.product_id
where length(btrim(coalesce(ps.label, ''))) = 0
order by issue_type, product_name, detail;

-- Expected:
-- - Ideally zero rows.
-- - Do not auto-create missing product_sizes rows from this verification file.

-- =========================================================
-- 7. Read-Only Recipe Summary Checks
-- =========================================================
-- These views include public.is_admin(), so establish an authenticated owner
-- context before reading them in Supabase SQL Editor. This section mutates no
-- recipe or inventory data and ends with ROLLBACK.

begin;

create temp table i10b_section7_owner as
select ap.id as owner_id
from public.admin_profiles ap
where ap.role = 'owner'
order by ap.created_at, ap.id
limit 1;

do $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id
  from i10b_section7_owner;

  if v_owner_id is null then
    raise exception 'I10B Section 7 setup failed: no owner found in public.admin_profiles.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', owner_id::text, true)
from i10b_section7_owner;

select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', owner_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from i10b_section7_owner;

do $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id
  from i10b_section7_owner;

  if auth.uid() is distinct from v_owner_id then
    raise exception 'I10B Section 7 setup failed: auth.uid() does not match selected owner.';
  end if;

  if not public.is_admin() then
    raise exception 'I10B Section 7 setup failed: public.is_admin() returned false.';
  end if;
end;
$$;

select
  auth.uid() as section7_auth_uid,
  owner_id as expected_owner_id,
  auth.uid() = owner_id as auth_uid_matches_owner,
  public.is_admin() as section7_is_admin
from i10b_section7_owner;

select
  product_id,
  product_name,
  category_id,
  category_name,
  product_size_id,
  product_size_label,
  recipe_id,
  recipe_exists,
  ingredient_line_count,
  inactive_ingredient_count,
  recipe_status,
  approximate_can_make,
  recipe_notes,
  recipe_updated_at
from public.inventory_recipe_summary
order by product_name, product_size_sort_order, product_size_label
limit 100;

select
  recipe_id,
  product_name,
  product_size_label,
  recipe_line_id,
  inventory_item_name,
  inventory_item_is_active,
  quantity_required,
  unit_abbreviation,
  usable_stock,
  sort_order
from public.inventory_recipe_line_details
order by product_name, product_size_label, sort_order, inventory_item_name
limit 100;

select
  product_name,
  product_size_label,
  recipe_id,
  ingredient_line_count,
  inactive_ingredient_count,
  recipe_status,
  approximate_can_make
from public.inventory_recipe_summary
where recipe_exists = true
  and ingredient_line_count > 0
  and inactive_ingredient_count = 0
  and approximate_can_make = 0
order by product_name, product_size_label
limit 50;

-- Expected:
-- - inventory_recipe_summary returns one row per product_size for admins.
-- - recipe_status is one of not_configured, ready, needs_attention.
-- - approximate_can_make is null for missing/empty recipes and inactive ingredients.
-- - approximate_can_make uses usable_stock, excluding expired stock.
-- - ready recipes with zero usable ingredient stock report approximate_can_make = 0.
-- - inactive ingredients remain visible in details.

rollback;

-- =========================================================
-- 8. Commented Manual RPC Smoke-Test Templates
-- =========================================================
-- These templates are intentionally commented. They establish an authenticated
-- owner context before invoking RPCs, run inside one rollback-safe transaction,
-- and use pg_temp.i10b_expect_error() so expected failures do not abort the
-- outer transaction.
--
-- Uncomment and run the entire Section 8 smoke block together. Never run only
-- selected mutation snippets, because the setup/auth context and rollback are
-- part of the safety harness. The final ROLLBACK must remain present. All
-- smoke mutations are temporary and must not be committed.
--
-- begin;
--
-- create temp table i10b_smoke_context as
-- select
--   (
--     select ap.id
--     from public.admin_profiles ap
--     where ap.role = 'owner'
--     order by ap.created_at, ap.id
--     limit 1
--   ) as owner_id,
--   (
--     select ps.id
--     from public.product_sizes ps
--     join public.products p on p.id = ps.product_id
--     order by p.name, ps.sort_order, ps.label
--     limit 1
--   ) as product_size_id,
--   (
--     select ic.id
--     from public.inventory_categories ic
--     where ic.is_active = true
--     order by ic.sort_order, ic.name, ic.id
--     limit 1
--   ) as category_id,
--   (
--     select iu.id
--     from public.inventory_units iu
--     where iu.is_active = true
--     order by iu.sort_order, iu.name, iu.id
--     limit 1
--   ) as unit_id,
--   to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || left(gen_random_uuid()::text, 8) as smoke_suffix,
--   gen_random_uuid() as item_id_a,
--   gen_random_uuid() as item_id_b,
--   gen_random_uuid() as inactive_item_id;
--
-- do $$
-- declare
--   v_context record;
-- begin
--   select * into v_context from i10b_smoke_context;
--
--   if v_context.owner_id is null then
--     raise exception 'I10B smoke setup failed: no owner found in public.admin_profiles.';
--   end if;
--   if v_context.product_size_id is null then
--     raise exception 'I10B smoke setup failed: no product_size row found.';
--   end if;
--   if v_context.category_id is null then
--     raise exception 'I10B smoke setup failed: no active inventory category found.';
--   end if;
--   if v_context.unit_id is null then
--     raise exception 'I10B smoke setup failed: no active inventory unit found.';
--   end if;
--   if v_context.item_id_a is null
--     or v_context.item_id_b is null
--     or v_context.inactive_item_id is null
--   then
--     raise exception 'I10B smoke setup failed: fixture IDs were not generated.';
--   end if;
-- end;
-- $$;
--
-- select set_config('request.jwt.claim.sub', owner_id::text, true)
-- from i10b_smoke_context;
--
-- select set_config('request.jwt.claim.role', 'authenticated', true);
--
-- select set_config(
--   'request.jwt.claims',
--   json_build_object(
--     'sub', owner_id::text,
--     'role', 'authenticated'
--   )::text,
--   true
-- )
-- from i10b_smoke_context;
--
-- select
--   auth.uid() as smoke_auth_uid,
--   owner_id as expected_owner_id,
--   auth.uid() = owner_id as auth_uid_matches_owner,
--   public.is_admin() as smoke_is_admin
-- from i10b_smoke_context;
--
-- do $$
-- declare
--   v_owner_id uuid;
-- begin
--   select owner_id into v_owner_id
--   from i10b_smoke_context;
--
--   if auth.uid() is distinct from v_owner_id then
--     raise exception 'I10B smoke setup failed: auth.uid() does not match selected owner.';
--   end if;
--
--   if not public.is_admin() then
--     raise exception 'I10B smoke setup failed: public.is_admin() returned false.';
--   end if;
-- end;
-- $$;
--
-- -- Temporary inventory fixtures for this smoke test only. They are inserted
-- -- inside the rollback transaction, create no stock batches or movements, and
-- -- must never be committed.
-- insert into public.inventory_items (
--   id,
--   name,
--   category_id,
--   unit_id,
--   low_stock_threshold,
--   track_expiry,
--   storage_location,
--   notes,
--   is_active,
--   created_by,
--   updated_by
-- )
-- select
--   item_id_a,
--   'CURV I10B Smoke Ingredient A ' || smoke_suffix,
--   category_id,
--   unit_id,
--   0,
--   false,
--   'Smoke Test Only',
--   'Temporary I10B smoke-test fixture. Rolled back at end of file.',
--   true,
--   owner_id,
--   owner_id
-- from i10b_smoke_context
-- union all
-- select
--   item_id_b,
--   'CURV I10B Smoke Ingredient B ' || smoke_suffix,
--   category_id,
--   unit_id,
--   0,
--   false,
--   'Smoke Test Only',
--   'Temporary I10B smoke-test fixture. Rolled back at end of file.',
--   true,
--   owner_id,
--   owner_id
-- from i10b_smoke_context
-- union all
-- select
--   inactive_item_id,
--   'CURV I10B Smoke Inactive Ingredient ' || smoke_suffix,
--   category_id,
--   unit_id,
--   0,
--   false,
--   'Smoke Test Only',
--   'Temporary I10B smoke-test fixture. Rolled back at end of file.',
--   false,
--   owner_id,
--   owner_id
-- from i10b_smoke_context;
--
-- create or replace function pg_temp.i10b_expect_error(
--   p_test_name text,
--   p_expected_detail text,
--   p_sql text
-- ) returns void
-- language plpgsql
-- as $$
-- declare
--   v_detail text;
-- begin
--   begin
--     execute p_sql;
--   exception
--     when others then
--       get stacked diagnostics v_detail = PG_EXCEPTION_DETAIL;
--       if v_detail = p_expected_detail then
--         raise notice 'PASS % -> %', p_test_name, v_detail;
--         return;
--       end if;
--
--       raise exception 'FAIL % expected detail %, got %',
--         p_test_name,
--         p_expected_detail,
--         coalesce(v_detail, '<null>');
--   end;
--
--   raise exception 'FAIL % expected detail %, but SQL succeeded',
--     p_test_name,
--     p_expected_detail;
-- end;
-- $$;

-- ---------------------------------------------------------
-- Valid recipe with multiple ingredients
-- ---------------------------------------------------------
-- select public.inventory_replace_recipe(
--   product_size_id,
--   jsonb_build_array(
--     jsonb_build_object('inventory_item_id', item_id_a, 'quantity_required', '1.250', 'sort_order', 0),
--     jsonb_build_object('inventory_item_id', item_id_b, 'quantity_required', '0.500', 'sort_order', 1)
--   ),
--   'Rollback smoke test recipe.'
-- )
-- from i10b_smoke_context;
--
-- select * from public.inventory_recipe_summary
-- where recipe_id is not null
-- order by recipe_updated_at desc
-- limit 5;

-- ---------------------------------------------------------
-- Expected failure cases that keep the outer transaction usable
-- ---------------------------------------------------------
-- select pg_temp.i10b_expect_error(
--   'duplicate ingredient',
--   'INV_RECIPE_DUPLICATE_ITEM',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', 0),
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '2', 'sort_order', 1)
--     ), null)$sql$,
--     product_size_id,
--     item_id_a::text,
--     item_id_a::text
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'inactive ingredient',
--   'INV_RECIPE_ITEM_INACTIVE',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', 0)
--     ), null)$sql$,
--     product_size_id,
--     inactive_item_id::text
--   )
-- )
-- from i10b_smoke_context
-- where inactive_item_id is not null;
--
-- select pg_temp.i10b_expect_error(
--   'nonexistent ingredient',
--   'INV_RECIPE_ITEM_NOT_FOUND',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', '00000000-0000-0000-0000-000000000000', 'quantity_required', '1')
--     ), null)$sql$,
--     product_size_id
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'zero quantity',
--   'INV_RECIPE_INVALID_QUANTITY',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '0')
--     ), null)$sql$,
--     product_size_id,
--     item_id_a::text
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'negative quantity',
--   'INV_RECIPE_INVALID_QUANTITY',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '-1')
--     ), null)$sql$,
--     product_size_id,
--     item_id_a::text
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'four decimal quantity',
--   'INV_RECIPE_QUANTITY_SCALE',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1.2345')
--     ), null)$sql$,
--     product_size_id,
--     item_id_a::text
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'scientific notation quantity',
--   'INV_RECIPE_INVALID_QUANTITY',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1e-4')
--     ), null)$sql$,
--     product_size_id,
--     item_id_a::text
--   )
-- )
-- from i10b_smoke_context;
--
-- select public.inventory_replace_recipe(
--   product_size_id,
--   jsonb_build_array(
--     jsonb_build_object('inventory_item_id', item_id_a, 'quantity_required', '99999999999.999')
--   ),
--   'Rollback maximum quantity smoke test.'
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'quantity overflow',
--   'INV_RECIPE_INVALID_QUANTITY',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '100000000000.000')
--     ), null)$sql$,
--     product_size_id,
--     item_id_a::text
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'extremely long quantity',
--   'INV_RECIPE_INVALID_QUANTITY',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', %L)
--     ), null)$sql$,
--     product_size_id,
--     item_id_a::text,
--     repeat('9', 200)
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'invalid decimal sort order',
--   'INV_RECIPE_INVALID_SORT_ORDER',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', '1.5')
--     ), null)$sql$,
--     product_size_id,
--     item_id_a::text
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'sort order overflow',
--   'INV_RECIPE_INVALID_SORT_ORDER',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1', 'sort_order', '2147483648')
--     ), null)$sql$,
--     product_size_id,
--     item_id_a::text
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'empty lines',
--   'INV_RECIPE_LINES_REQUIRED',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, '[]'::jsonb, null)$sql$,
--     product_size_id
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'more than 100 lines',
--   'INV_RECIPE_TOO_MANY_LINES',
--   format(
--     $sql$select public.inventory_replace_recipe(
--       %L::uuid,
--       (
--         select jsonb_agg(jsonb_build_object(
--           'inventory_item_id', gen_random_uuid(),
--           'quantity_required', '1',
--           'sort_order', n
--         ))
--         from generate_series(1, 101) as n
--       ),
--       null
--     )$sql$,
--     product_size_id
--   )
-- )
-- from i10b_smoke_context;
--
-- select pg_temp.i10b_expect_error(
--   'notes over 500 characters',
--   'INV_RECIPE_NOTES_TOO_LONG',
--   format(
--     $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--       jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1')
--     ), %L)$sql$,
--     product_size_id,
--     item_id_a::text,
--     repeat('x', 501)
--   )
-- )
-- from i10b_smoke_context;

-- ---------------------------------------------------------
-- Atomic replacement behavior
-- ---------------------------------------------------------
-- do $$
-- declare
--   v_context record;
--   v_recipe_id uuid;
--   v_notes text;
--   v_line_count integer;
--   v_item_a_quantity numeric;
--   v_item_b_quantity numeric;
-- begin
--   select * into v_context from i10b_smoke_context;
--
--   perform public.inventory_replace_recipe(
--     v_context.product_size_id,
--     jsonb_build_array(
--       jsonb_build_object('inventory_item_id', v_context.item_id_a, 'quantity_required', '1.000', 'sort_order', 0),
--       jsonb_build_object('inventory_item_id', v_context.item_id_b, 'quantity_required', '2.000', 'sort_order', 1)
--     ),
--     'Atomic test original.'
--   );
--
--   perform pg_temp.i10b_expect_error(
--     'atomic invalid replacement',
--     'INV_RECIPE_QUANTITY_SCALE',
--     format(
--       $sql$select public.inventory_replace_recipe(%L::uuid, jsonb_build_array(
--         jsonb_build_object('inventory_item_id', %L, 'quantity_required', '1.2345')
--       ), 'Atomic test invalid replacement.')$sql$,
--       v_context.product_size_id,
--       v_context.item_id_a::text
--     )
--   );
--
--   select
--     r.id,
--     r.notes,
--     count(rl.id)::integer,
--     max(rl.quantity_required) filter (where rl.inventory_item_id = v_context.item_id_a),
--     max(rl.quantity_required) filter (where rl.inventory_item_id = v_context.item_id_b)
--   into
--     v_recipe_id,
--     v_notes,
--     v_line_count,
--     v_item_a_quantity,
--     v_item_b_quantity
--   from public.inventory_recipes r
--   join public.inventory_recipe_lines rl on rl.recipe_id = r.id
--   where r.product_size_id = v_context.product_size_id
--   group by r.id, r.notes;
--
--   if v_recipe_id is null
--     or v_notes <> 'Atomic test original.'
--     or v_line_count <> 2
--     or v_item_a_quantity <> 1.000
--     or v_item_b_quantity <> 2.000
--   then
--     raise exception 'FAIL atomic replacement did not preserve the prior valid recipe.';
--   end if;
--
--   raise notice 'PASS atomic replacement preserved prior recipe %', v_recipe_id;
-- end;
-- $$;

-- ---------------------------------------------------------
-- Recipe deletion
-- ---------------------------------------------------------
-- do $$
-- declare
--   v_context record;
--   v_recipe_id uuid;
--   v_product_still_exists boolean;
--   v_item_still_exists boolean;
--   v_recipe_still_exists boolean;
--   v_lines_still_exist boolean;
-- begin
--   select * into v_context from i10b_smoke_context;
--
--   select r.id into v_recipe_id
--   from public.inventory_recipes r
--   where r.product_size_id = v_context.product_size_id;
--
--   perform public.inventory_delete_recipe(v_context.product_size_id);
--
--   select exists (
--     select 1 from public.product_sizes where id = v_context.product_size_id
--   ) into v_product_still_exists;
--
--   select exists (
--     select 1 from public.inventory_items where id = v_context.item_id_a
--   ) into v_item_still_exists;
--
--   select exists (
--     select 1 from public.inventory_recipes where product_size_id = v_context.product_size_id
--   ) into v_recipe_still_exists;
--
--   select exists (
--     select 1 from public.inventory_recipe_lines where recipe_id = v_recipe_id
--   ) into v_lines_still_exist;
--
--   if not v_product_still_exists
--     or not v_item_still_exists
--     or v_recipe_still_exists
--     or v_lines_still_exist
--   then
--     raise exception 'FAIL delete recipe affected the wrong records.';
--   end if;
--
--   raise notice 'PASS delete recipe removed only recipe configuration.';
-- end;
-- $$;

-- ---------------------------------------------------------
-- Non-admin access expectations
-- ---------------------------------------------------------
-- -- Optional: use a reviewed non-admin authenticated UUID in local/test only.
-- -- The UUID must not exist in public.admin_profiles.
-- -- select set_config('request.jwt.claim.sub', '<non_admin_user_id>', true);
-- -- select set_config('request.jwt.claim.role', 'authenticated', true);
-- -- select set_config(
-- --   'request.jwt.claims',
-- --   json_build_object('sub', '<non_admin_user_id>', 'role', 'authenticated')::text,
-- --   true
-- -- );
-- -- select auth.uid(), public.is_admin();
-- -- select pg_temp.i10b_expect_error(
-- --   'non-admin replace recipe',
-- --   'INV_ADMIN_REQUIRED',
-- --   format(
-- --     $sql$select public.inventory_replace_recipe(%L::uuid, '[]'::jsonb, null)$sql$,
-- --     (select product_size_id from i10b_smoke_context)
-- --   )
-- -- );
--
-- rollback;

-- =========================================================
-- 9. Expected Success and Failure Cases
-- =========================================================

select *
from (
  values
    ('valid_multiple_ingredients', 'PASS when RPC returns ok=true with ingredient_count > 1'),
    ('duplicate_ingredient', 'FAILS with INV_RECIPE_DUPLICATE_ITEM'),
    ('inactive_ingredient', 'FAILS with INV_RECIPE_ITEM_INACTIVE'),
    ('nonexistent_inventory_item', 'FAILS with INV_RECIPE_ITEM_NOT_FOUND'),
    ('zero_quantity', 'FAILS with INV_RECIPE_INVALID_QUANTITY'),
    ('negative_quantity', 'FAILS with INV_RECIPE_INVALID_QUANTITY'),
    ('scientific_notation_quantity', 'FAILS with INV_RECIPE_INVALID_QUANTITY'),
    ('maximum_quantity', '99999999999.999 is accepted'),
    ('quantity_overflow', 'FAILS with INV_RECIPE_INVALID_QUANTITY'),
    ('extremely_long_quantity', 'FAILS with INV_RECIPE_INVALID_QUANTITY'),
    ('four_decimal_quantity', 'FAILS with INV_RECIPE_QUANTITY_SCALE'),
    ('invalid_sort_order', 'FAILS with INV_RECIPE_INVALID_SORT_ORDER'),
    ('sort_order_overflow', 'FAILS with INV_RECIPE_INVALID_SORT_ORDER'),
    ('empty_line_array', 'FAILS with INV_RECIPE_LINES_REQUIRED'),
    ('excessive_line_count', 'FAILS with INV_RECIPE_TOO_MANY_LINES'),
    ('notes_over_500', 'FAILS with INV_RECIPE_NOTES_TOO_LONG'),
    ('approximate_can_make_zero_stock', 'Ready recipe with zero usable ingredient stock reports 0'),
    ('approximate_can_make_integer_cap', 'Floor result is capped at 2147483647 before integer cast'),
    ('atomic_replacement', 'Invalid replacement leaves prior recipe unchanged'),
    ('recipe_deletion', 'Deletes recipe header and cascades lines only'),
    ('smoke_test_rollback', 'Manual smoke-test transaction ends with ROLLBACK'),
    ('non_admin_access', 'Non-admin cannot read recipe data or mutate recipes')
) as expected(test_case, expected_result)
order by test_case;

-- =========================================================
-- 10. Static Definition Checks
-- =========================================================

select
  'no_anon_recipe_table_grants' as check_name,
  count(*) = 0 as passed,
  count(*) as matching_rows
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'inventory_recipes',
    'inventory_recipe_lines',
    'inventory_recipe_line_details',
    'inventory_recipe_summary'
  )
  and grantee = 'anon';

select
  'no_direct_recipe_mutation_grants' as check_name,
  count(*) = 0 as passed,
  count(*) as matching_rows
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'inventory_recipes',
    'inventory_recipe_lines'
  )
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

select
  'quantity_required_numeric_14_3' as check_name,
  count(*) = 1 as passed,
  count(*) as matching_rows
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_recipe_lines'
  and column_name = 'quantity_required'
  and data_type = 'numeric'
  and numeric_precision = 14
  and numeric_scale = 3;

select
  'no_recipe_line_unit_column' as check_name,
  count(*) = 0 as passed,
  count(*) as matching_rows
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_recipe_lines'
  and column_name in ('unit_id', 'unit_name', 'unit_abbreviation');

select
  'summary_caps_approximate_can_make' as check_name,
  position('least(' in lower(pg_get_viewdef('public.inventory_recipe_summary'::regclass, true))) > 0
    and position('2147483647' in pg_get_viewdef('public.inventory_recipe_summary'::regclass, true)) > 0 as passed;

select
  'replace_recipe_staging_unique_item' as check_name,
  position('inventory_recipe_line_input_inventory_item_unique' in pg_get_functiondef('public.inventory_replace_recipe(uuid,jsonb,text)'::regprocedure)) > 0 as passed;

select
  'replace_recipe_duplicate_maps_to_curv_code' as check_name,
  position('unique_violation' in pg_get_functiondef('public.inventory_replace_recipe(uuid,jsonb,text)'::regprocedure)) > 0
    and position('INV_RECIPE_DUPLICATE_ITEM' in pg_get_functiondef('public.inventory_replace_recipe(uuid,jsonb,text)'::regprocedure)) > 0 as passed;

select
  'replace_recipe_quantity_range_guard' as check_name,
  position('v_quantity_integer_normalized' in pg_get_functiondef('public.inventory_replace_recipe(uuid,jsonb,text)'::regprocedure)) > 0
    and position('length(v_quantity_integer_normalized) > 11' in pg_get_functiondef('public.inventory_replace_recipe(uuid,jsonb,text)'::regprocedure)) > 0 as passed;

select
  'replace_recipe_sort_order_range_guard' as check_name,
  position('v_sort_order_normalized' in pg_get_functiondef('public.inventory_replace_recipe(uuid,jsonb,text)'::regprocedure)) > 0
    and position('2147483647' in pg_get_functiondef('public.inventory_replace_recipe(uuid,jsonb,text)'::regprocedure)) > 0 as passed;
