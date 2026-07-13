-- CURV Control Inventory Management
-- Phase I10D.1 Recipe Mutation Optimistic-Concurrency Verification
--
-- Read-only verification draft.
-- Do not use this file to mutate recipe, inventory, menu, order, or POS data.

-- =========================================================
-- 1. Current RPC Signatures
-- =========================================================

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as is_security_definer,
  p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'inventory_replace_recipe',
    'inventory_delete_recipe'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Expected:
-- inventory_replace_recipe(
--   p_product_size_id uuid,
--   p_lines jsonb,
--   p_notes text,
--   p_expected_recipe_id uuid,
--   p_expected_updated_at timestamp with time zone
-- ) returns jsonb
--
-- inventory_delete_recipe(
--   p_product_size_id uuid,
--   p_expected_recipe_id uuid,
--   p_expected_updated_at timestamp with time zone
-- ) returns jsonb

-- =========================================================
-- 2. Old Overloads Must Be Absent
-- =========================================================

select
  'replace_old_3_arg_absent' as check_name,
  to_regprocedure('public.inventory_replace_recipe(uuid, jsonb, text)') is null as passes
union all
select
  'replace_new_5_arg_present' as check_name,
  to_regprocedure('public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz)') is not null as passes
union all
select
  'delete_old_1_arg_absent' as check_name,
  to_regprocedure('public.inventory_delete_recipe(uuid)') is null as passes
union all
select
  'delete_new_3_arg_present' as check_name,
  to_regprocedure('public.inventory_delete_recipe(uuid, uuid, timestamptz)') is not null as passes;

-- =========================================================
-- 3. Security Definer And Search Path
-- =========================================================

select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as is_security_definer,
  p.proconfig @> array['search_path=public, pg_temp'] as has_expected_search_path,
  p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.oid = to_regprocedure('public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz)')
    or p.oid = to_regprocedure('public.inventory_delete_recipe(uuid, uuid, timestamptz)')
  )
order by p.proname;

-- =========================================================
-- 4. Dedicated Recipe Updated-At Trigger
-- =========================================================

with target_function as (
  select to_regprocedure('public.set_inventory_recipe_updated_at()') as function_oid
),
trigger_function as (
  select
    p.oid,
    n.nspname as schema_name,
    p.proname as function_name,
    case
      when p.oid is null then null
      else pg_get_function_result(p.oid)
    end as result_type,
    case
      when p.oid is null then null
      else pg_get_functiondef(p.oid)
    end as source_sql
  from target_function tf
  left join pg_proc p on p.oid = tf.function_oid
  left join pg_namespace n on n.oid = p.pronamespace
)
select
  oid is not null as function_exists,
  schema_name,
  function_name,
  result_type = 'trigger' as is_trigger_function,
  coalesce(source_sql like '%clock_timestamp()%', false) as uses_clock_timestamp,
  coalesce(source_sql like '%old.updated_at%', false) as compares_old_updated_at,
  coalesce(source_sql like '%interval ''1 microsecond''%', false) as guarantees_microsecond_advance
from trigger_function;

select
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'inventory_recipes'
      and t.tgname = 'set_inventory_recipes_updated_at'
      and not t.tgisinternal
  ) as trigger_exists,
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'inventory_recipes'
      and t.tgname = 'set_inventory_recipes_updated_at'
      and t.tgenabled <> 'D'
      and not t.tgisinternal
  ) as trigger_enabled,
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'inventory_recipes'
      and t.tgname = 'set_inventory_recipes_updated_at'
      and t.tgfoid = to_regprocedure('public.set_inventory_recipe_updated_at()')
      and not t.tgisinternal
  ) as trigger_calls_dedicated_helper;

select
  t.tgname as trigger_name,
  c.relname as table_name,
  t.tgenabled as trigger_enabled_state,
  t.tgenabled <> 'D' as trigger_enabled,
  p.proname as trigger_function_name,
  pg_get_triggerdef(t.oid) as trigger_definition,
  p.oid = to_regprocedure('public.set_inventory_recipe_updated_at()') as calls_dedicated_helper
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname = 'inventory_recipes'
  and t.tgname = 'set_inventory_recipes_updated_at'
  and not t.tgisinternal;

select
  t.tgname as trigger_name,
  c.relname as table_name,
  t.tgenabled as trigger_enabled_state,
  t.tgenabled <> 'D' as trigger_enabled,
  p.proname as trigger_function_name,
  pg_get_triggerdef(t.oid) as trigger_definition,
  p.oid = to_regprocedure('public.set_inventory_recipe_updated_at()') as calls_dedicated_helper
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname = 'inventory_recipes'
  and not t.tgisinternal
order by t.tgname;

select
  count(*) = 0 as inventory_recipes_no_longer_uses_shared_set_updated_at
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'inventory_recipes'
  and not t.tgisinternal
  and t.tgfoid = to_regprocedure('public.set_updated_at()');

-- Expected:
-- - public.set_inventory_recipe_updated_at() exists and returns trigger.
-- - set_inventory_recipes_updated_at is enabled on public.inventory_recipes.
-- - It calls public.set_inventory_recipe_updated_at().
-- - public.inventory_recipes no longer uses public.set_updated_at().

-- =========================================================
-- 5. Execute Grants
-- =========================================================

with target_functions as (
  select
    p.oid,
    p.proname,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.proowner,
    p.proacl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.oid = to_regprocedure('public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz)')
      or p.oid = to_regprocedure('public.inventory_delete_recipe(uuid, uuid, timestamptz)')
    )
),
expanded_acl as (
  select
    tf.proname,
    tf.identity_arguments,
    (acl).grantee,
    (acl).privilege_type,
    (acl).is_grantable
  from target_functions tf
  cross join lateral aclexplode(coalesce(tf.proacl, acldefault('f', tf.proowner))) as acl
)
select
  proname as function_name,
  identity_arguments,
  case grantee
    when 0 then 'public'
    else grantee::regrole::text
  end as grantee,
  privilege_type,
  is_grantable
from expanded_acl
where privilege_type = 'EXECUTE'
order by function_name, grantee;

-- Expected:
-- authenticated has EXECUTE.
-- anon and PUBLIC do not have EXECUTE.

-- =========================================================
-- 6. Optimistic-Concurrency Source Checks
-- =========================================================

with function_source as (
  select
    p.proname,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_functiondef(p.oid) as source_sql
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.oid = to_regprocedure('public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz)')
      or p.oid = to_regprocedure('public.inventory_delete_recipe(uuid, uuid, timestamptz)')
    )
)
select
  proname as function_name,
  identity_arguments,
  source_sql like '%auth.uid()%' as checks_auth_uid,
  source_sql like '%public.is_admin()%' as checks_is_admin,
  source_sql like '%for update%' as uses_row_locking,
  source_sql like '%is distinct from%' as uses_exact_token_comparison,
  source_sql like '%INV_RECIPE_CONFLICT%' as maps_conflict_code,
  source_sql like '%p_expected_recipe_id%' as accepts_expected_recipe_id,
  source_sql like '%p_expected_updated_at%' as accepts_expected_updated_at
from function_source
order by function_name;

-- =========================================================
-- 7. Replace-Specific Validation Preservation Checks
-- =========================================================

with replace_source as (
  select pg_get_functiondef(to_regprocedure(
    'public.inventory_replace_recipe(uuid, jsonb, text, uuid, timestamptz)'
  )) as source_sql
)
select
  source_sql like '%INV_RECIPE_EXPECTATION_INVALID%' as has_incomplete_token_error,
  source_sql like '%This recipe was created or changed in another session.%' as has_create_conflict_message,
  source_sql like '%This recipe was changed or removed in another session.%' as has_edit_conflict_message,
  source_sql like '%inventory_recipe_line_input_inventory_item_unique%' as keeps_temp_duplicate_constraint,
  source_sql like '%INV_RECIPE_DUPLICATE_ITEM%' as keeps_duplicate_item_mapping,
  source_sql like '%numeric_value_out_of_range%' as keeps_numeric_overflow_guard,
  source_sql like '%INV_RECIPE_QUANTITY_SCALE%' as keeps_quantity_scale_error,
  source_sql like '%2147483647%' as keeps_sort_order_int_guard,
  source_sql not like '%updated_at = clock_timestamp()%' as does_not_assign_updated_at_directly,
  source_sql like '%operation'', ''replace_recipe%' as keeps_replace_return_shape
from replace_source;

-- =========================================================
-- 8. Delete-Specific Validation Preservation Checks
-- =========================================================

with delete_source as (
  select pg_get_functiondef(to_regprocedure(
    'public.inventory_delete_recipe(uuid, uuid, timestamptz)'
  )) as source_sql
)
select
  source_sql like '%INV_RECIPE_EXPECTATION_REQUIRED%' as has_delete_token_required_error,
  source_sql like '%This recipe was changed in another session.%' as has_delete_conflict_message,
  source_sql like '%deleted'', false%' as keeps_missing_recipe_success_shape,
  source_sql like '%deleted'', v_deleted%' as keeps_delete_success_shape,
  source_sql like '%operation'', ''delete_recipe%' as keeps_delete_return_shape
from delete_source;

-- =========================================================
-- 9. Recipe Tables And Views Direct Grants
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
    'inventory_recipe_summary',
    'inventory_recipe_line_details'
  )
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_name, grantee, privilege_type;

select
  count(*) = 0 as no_direct_recipe_table_mutation_grants
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'inventory_recipes',
    'inventory_recipe_lines'
  )
  and grantee in ('anon', 'authenticated', 'PUBLIC')
  and privilege_type in (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE'
  );

-- Expected:
-- Views may have read grants if approved by I10B.
-- Recipe tables should not expose direct INSERT, UPDATE, DELETE, or TRUNCATE
-- to anon/authenticated/public. Mutations should go through owner/admin RPCs.

-- =========================================================
-- 10. Expected Manual Smoke Coverage
-- =========================================================

select *
from (
  values
    (1, 'Create with null/null expectation succeeds when no recipe exists.'),
    (2, 'Create with null/null expectation conflicts when a recipe already exists.'),
    (3, 'Edit with matching recipe_id and updated_at succeeds.'),
    (4, 'Edit returns a changed updated_at token for stale-token testing.'),
    (5, 'Edit with stale updated_at returns INV_RECIPE_CONFLICT.'),
    (6, 'Edit with missing recipe after delete returns INV_RECIPE_CONFLICT.'),
    (7, 'Partial expected recipe_id token returns INV_RECIPE_EXPECTATION_INVALID.'),
    (8, 'Partial expected updated_at token returns INV_RECIPE_EXPECTATION_INVALID.'),
    (9, 'Delete with stale updated_at returns INV_RECIPE_CONFLICT.'),
    (9, 'Delete with only product_size_id fails with INV_RECIPE_EXPECTATION_REQUIRED while a recipe exists.'),
    (10, 'Delete with matching recipe_id and updated_at succeeds.'),
    (11, 'Deleting an already missing recipe returns deleted=false.'),
    (12, 'Create after delete succeeds with null/null expectation.'),
    (13, 'Old deleted edit token cannot update recreated recipe.'),
    (14, 'Old deleted delete token cannot remove recreated recipe.'),
    (15, 'I10B validation errors still map to their approved codes, including too many recipe lines.'),
    (16, 'Invalid replacement remains atomic and preserves existing lines.')
) as expected_smoke_cases(case_number, expected_case);
