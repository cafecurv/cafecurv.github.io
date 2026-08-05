-- Incoming Orders Phase O12A Verification SQL
--
-- Purpose:
-- Verify the Website Ordering status backend after reviewing and applying:
-- admin/INCOMING_ORDERS_PHASE_O12A_WEBSITE_ORDERING_STATUS.sql
--
-- This script intentionally wraps mutation tests in a transaction and ends
-- with rollback so verification orders, order_items, and settings changes do
-- not remain.

begin;

-- 1. store_settings structure, seed, singleton constraint, and RLS.
do $$
declare
  v_constraint_def text;
  v_seed_count integer;
  v_enabled boolean;
begin
  if to_regclass('public.store_settings') is null then
    raise exception 'public.store_settings does not exist.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_settings'
      and column_name = 'id'
      and data_type = 'boolean'
      and is_nullable = 'NO'
      and column_default ilike '%true%'
  ) then
    raise exception 'store_settings.id is missing or has the wrong type/nullability/default.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_settings'
      and column_name = 'website_ordering_enabled'
      and data_type = 'boolean'
      and is_nullable = 'NO'
      and column_default ilike '%true%'
  ) then
    raise exception 'store_settings.website_ordering_enabled is missing or has the wrong type/nullability/default.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_settings'
      and column_name = 'updated_at'
      and udt_name = 'timestamptz'
      and is_nullable = 'NO'
      and column_default ilike '%now%'
  ) then
    raise exception 'store_settings.updated_at is missing or has the wrong type/nullability/default.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_settings'
      and column_name = 'updated_by'
      and udt_name = 'uuid'
      and is_nullable = 'YES'
      and column_default is null
  ) then
    raise exception 'store_settings.updated_by is missing or has the wrong type/nullability/default.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_settings'::regclass
      and contype = 'p'
      and conkey = array[
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.store_settings'::regclass
            and attname = 'id'
        )
      ]::smallint[]
  ) then
    raise exception 'store_settings.id primary key is missing.';
  end if;

  select pg_get_constraintdef(c.oid)
  into v_constraint_def
  from pg_constraint c
  where c.conrelid = 'public.store_settings'::regclass
    and c.conname = 'store_settings_singleton_check';

  if v_constraint_def is null or v_constraint_def not ilike '%id is true%' then
    raise exception 'store_settings singleton check is missing or unexpected: %', v_constraint_def;
  end if;

  select count(*), bool_or(website_ordering_enabled)
  into v_seed_count, v_enabled
  from public.store_settings
  where id is true;

  if v_seed_count <> 1 or v_enabled is not true then
    raise exception 'store_settings seed row is missing or not enabled. rows=%, enabled=%', v_seed_count, v_enabled;
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'store_settings'
      and c.relrowsecurity is true
  ) then
    raise exception 'store_settings RLS is not enabled.';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'store_settings'
      and p.cmd = 'SELECT'
  ) then
    raise exception 'store_settings has no SELECT RLS policy.';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'store_settings'
      and p.cmd = 'SELECT'
      and 'authenticated' = any(p.roles)
  ) then
    raise exception 'store_settings SELECT RLS policy does not apply to authenticated users.';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'store_settings'
      and p.cmd = 'SELECT'
      and 'authenticated' = any(p.roles)
      and lower(coalesce(p.qual, '')) like '%is_admin%'
  ) then
    raise exception 'store_settings SELECT RLS policy for authenticated users does not reference public.is_admin().';
  end if;

  raise notice 'O12A store_settings admin SELECT policy verification passed. Authenticated direct SELECT remains subject to RLS; manual non-admin end-to-end SELECT testing may still be required if auth context cannot be safely simulated here.';
  raise notice 'O12A store_settings structure verification passed.';
end;
$$;

-- 2. Table and function privileges.
do $$
declare
  v_privilege text;
begin
  foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  loop
    if has_table_privilege('anon', 'public.store_settings', v_privilege) then
      raise exception 'anon unexpectedly has % on store_settings.', v_privilege;
    end if;

    if exists (
      select 1
      from information_schema.table_privileges
      where table_schema = 'public'
        and table_name = 'store_settings'
        and lower(grantee) = 'public'
        and privilege_type = v_privilege
    ) then
      raise exception 'public unexpectedly has % on store_settings.', v_privilege;
    end if;

    if v_privilege <> 'SELECT'
      and has_table_privilege('authenticated', 'public.store_settings', v_privilege) then
      raise exception 'authenticated unexpectedly has direct % on store_settings.', v_privilege;
    end if;
  end loop;

  if not has_function_privilege('anon', 'public.get_public_store_status()', 'EXECUTE') then
    raise exception 'anon EXECUTE grant missing for get_public_store_status().';
  end if;

  if not has_function_privilege('authenticated', 'public.get_public_store_status()', 'EXECUTE') then
    raise exception 'authenticated EXECUTE grant missing for get_public_store_status().';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'get_public_store_status'
      and lower(grantee) = 'public'
      and privilege_type = 'EXECUTE'
  ) then
    raise exception 'public retains EXECUTE on get_public_store_status().';
  end if;

  if has_function_privilege('anon', 'public.set_website_ordering_enabled(boolean)', 'EXECUTE') then
    raise exception 'anon unexpectedly has EXECUTE on set_website_ordering_enabled(boolean).';
  end if;

  if not has_function_privilege('authenticated', 'public.set_website_ordering_enabled(boolean)', 'EXECUTE') then
    raise exception 'authenticated EXECUTE grant missing for set_website_ordering_enabled(boolean).';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'set_website_ordering_enabled'
      and lower(grantee) = 'public'
      and privilege_type = 'EXECUTE'
  ) then
    raise exception 'public retains EXECUTE on set_website_ordering_enabled(boolean).';
  end if;

  raise notice 'O12A privilege verification passed.';
end;
$$;

-- 3. Public read RPC contract and fail-closed missing-row behavior.
do $$
declare
  v_response jsonb;
begin
  v_response := public.get_public_store_status();

  if (select array_agg(key order by key) from jsonb_object_keys(v_response) as key)
    <> array['website_ordering_enabled'] then
    raise exception 'get_public_store_status returned unexpected keys: %', v_response;
  end if;

  if v_response ? 'updated_by' or v_response ? 'id' or v_response ? 'updated_at' then
    raise exception 'get_public_store_status exposed internal fields: %', v_response;
  end if;

  delete from public.store_settings where id is true;
  v_response := public.get_public_store_status();

  if coalesce((v_response ->> 'website_ordering_enabled')::boolean, true) is not false then
    raise exception 'get_public_store_status did not fail closed when store_settings row was missing: %', v_response;
  end if;

  insert into public.store_settings (id, website_ordering_enabled)
  values (true, true)
  on conflict (id) do nothing;

  raise notice 'O12A public status RPC verification passed.';
end;
$$;

-- 4. Owner update RPC auth, admin, input, update, audit, and return contract.
do $$
declare
  v_owner_id uuid;
  v_non_admin_id uuid := '00000000-0000-4000-8000-0000000012ff';
  v_response jsonb;
  v_before timestamptz;
  v_after timestamptz;
  v_detail text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform public.set_website_ordering_enabled(false);
    raise exception 'Unauthenticated update unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Unauthenticated update unexpectedly succeeded.' then
      raise;
    end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'CURV_AUTH_REQUIRED' then
      raise exception 'Unauthenticated update failed with wrong detail: %', v_detail;
    end if;
  end;

  begin
    perform set_config('request.jwt.claim.sub', v_non_admin_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform public.set_website_ordering_enabled(false);
    raise exception 'Non-admin update unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Non-admin update unexpectedly succeeded.' then
      raise;
    end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'CURV_ADMIN_REQUIRED' then
      raise exception 'Non-admin update failed with wrong detail: %', v_detail;
    end if;
  end;

  select ap.id
  into v_owner_id
  from public.admin_profiles ap
  where ap.role = 'owner'
  limit 1;

  if v_owner_id is null then
    raise notice 'O12A owner update admin success test skipped: no owner row found in public.admin_profiles. Manual Supabase test required.';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    perform public.set_website_ordering_enabled(null);
    raise exception 'Null update unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Null update unexpectedly succeeded.' then
      raise;
    end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'CURV_INVALID_INPUT' then
      raise exception 'Null update failed with wrong detail: %', v_detail;
    end if;
  end;

  select updated_at into v_before
  from public.store_settings
  where id is true;

  perform pg_sleep(0.01);
  v_response := public.set_website_ordering_enabled(false);

  if (select array_agg(key order by key) from jsonb_object_keys(v_response) as key)
    <> array['ok', 'updated_at', 'website_ordering_enabled'] then
    raise exception 'set_website_ordering_enabled returned unexpected keys: %', v_response;
  end if;

  if (v_response ->> 'ok')::boolean is not true
    or (v_response ->> 'website_ordering_enabled')::boolean is not false then
    raise exception 'set_website_ordering_enabled(false) returned unexpected response: %', v_response;
  end if;

  select updated_at into v_after
  from public.store_settings
  where id is true
    and website_ordering_enabled is false
    and updated_by = v_owner_id;

  if v_after is null or v_after <= v_before then
    raise exception 'set_website_ordering_enabled(false) did not update status/audit fields.';
  end if;

  v_response := public.set_website_ordering_enabled(true);

  if (v_response ->> 'website_ordering_enabled')::boolean is not true then
    raise exception 'set_website_ordering_enabled(true) returned unexpected response: %', v_response;
  end if;

  delete from public.store_settings where id is true;

  begin
    perform public.set_website_ordering_enabled(true);
    raise exception 'Missing settings update unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Missing settings update unexpectedly succeeded.' then
      raise;
    end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'CURV_STORE_SETTINGS_MISSING' then
      raise exception 'Missing settings update failed with wrong detail: %', v_detail;
    end if;
  end;

  insert into public.store_settings (id, website_ordering_enabled)
  values (true, true);

  raise notice 'O12A owner update RPC verification passed.';
end;
$$;

-- 5. submit_public_order metadata, grants, and safe response contract.
do $$
declare
  v_function record;
begin
  select
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as function_result,
    p.prosecdef as is_security_definer,
    p.proconfig as function_config
  into v_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'submit_public_order'
    and pg_get_function_identity_arguments(p.oid) = 'order_payload jsonb';

  if not found then
    raise exception 'submit_public_order(order_payload jsonb) was not found.';
  end if;

  if v_function.function_result <> 'jsonb' then
    raise exception 'submit_public_order does not return jsonb.';
  end if;

  if v_function.is_security_definer is not true then
    raise exception 'submit_public_order is not SECURITY DEFINER.';
  end if;

  if v_function.function_config is null
    or not ('search_path=public, pg_temp' = any(v_function.function_config)) then
    raise exception 'submit_public_order search_path is not public, pg_temp. config=%', v_function.function_config;
  end if;

  if not has_function_privilege('anon', 'public.submit_public_order(jsonb)', 'EXECUTE') then
    raise exception 'anon EXECUTE grant missing for submit_public_order(jsonb).';
  end if;

  if not has_function_privilege('authenticated', 'public.submit_public_order(jsonb)', 'EXECUTE') then
    raise exception 'authenticated EXECUTE grant missing for submit_public_order(jsonb).';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'submit_public_order'
      and lower(grantee) = 'public'
      and privilege_type = 'EXECUTE'
  ) then
    raise exception 'public retains EXECUTE on submit_public_order(jsonb).';
  end if;

  raise notice 'O12A submit_public_order metadata verification passed.';
end;
$$;

-- 6. While enabled, valid new submission succeeds normally.
do $$
declare
  v_response jsonb;
  v_response_keys text[];
begin
  update public.store_settings
  set website_ordering_enabled = true
  where id is true;

  v_response := public.submit_public_order(jsonb_build_object(
    'submission_key', '00000000-0000-4000-8000-0000000012a1',
    'customer_name', 'O12A Enabled Verification Customer',
    'customer_phone', '09990001201',
    'fulfillment_type', 'pickup',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 75,
    'total', 75,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O12A Enabled Verification Item',
        'quantity', 1,
        'unit_price', 75,
        'line_total', 75,
        'sort_order', 0
      )
    )
  ));

  select array_agg(key order by key)
  into v_response_keys
  from jsonb_object_keys(v_response) as key;

  if v_response_keys <> array['order_number', 'tracking_token'] then
    raise exception 'Enabled submission returned unexpected response keys: %', v_response;
  end if;

  if v_response ? 'website_ordering_enabled'
    or v_response ? 'updated_by'
    or v_response ? 'public_submission_key'
    or v_response ? 'public_submission_fingerprint' then
    raise exception 'Enabled submission exposed internal fields: %', v_response;
  end if;

  raise notice 'O12A enabled submission verification passed.';
end;
$$;

-- 7. While disabled, genuinely new submissions fail closed with no partial rows.
do $$
declare
  v_key uuid := '00000000-0000-4000-8000-0000000012a2';
  v_payload jsonb;
  v_orders_before integer;
  v_items_before integer;
  v_orders_after integer;
  v_items_after integer;
  v_detail text;
begin
  v_payload := jsonb_build_object(
    'submission_key', v_key::text,
    'customer_name', 'O12A Closed Verification Customer',
    'customer_phone', '09990001202',
    'fulfillment_type', 'pickup',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 90,
    'total', 90,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O12A Closed Verification Item',
        'quantity', 1,
        'unit_price', 90,
        'line_total', 90,
        'sort_order', 0
      )
    )
  );

  select count(*) into v_orders_before from public.orders;
  select count(*) into v_items_before from public.order_items;

  update public.store_settings
  set website_ordering_enabled = false
  where id is true;

  begin
    perform public.submit_public_order(v_payload);
    raise exception 'Closed new submission unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Closed new submission unexpectedly succeeded.' then
      raise;
    end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate <> 'P0001' or v_detail <> 'CURV_ORDERING_CLOSED' then
      raise exception 'Closed new submission failed incorrectly. SQLSTATE=%, detail=%, message=%', sqlstate, v_detail, sqlerrm;
    end if;
  end;

  select count(*) into v_orders_after from public.orders;
  select count(*) into v_items_after from public.order_items;

  if v_orders_after <> v_orders_before or v_items_after <> v_items_before then
    raise exception 'Closed new submission created partial rows. orders before/after=%/%, items before/after=%/%',
      v_orders_before, v_orders_after, v_items_before, v_items_after;
  end if;

  if exists (select 1 from public.orders where public_submission_key = v_key) then
    raise exception 'Closed new submission stored a keyed order.';
  end if;

  raise notice 'O12A closed new-submission verification passed.';
end;
$$;

-- 8. Idempotent replay while disabled returns the original response and inserts no duplicate items.
do $$
declare
  v_key uuid := '00000000-0000-4000-8000-0000000012a3';
  v_payload jsonb;
  v_response_first jsonb;
  v_response_second jsonb;
  v_order_id uuid;
  v_order_count_before integer;
  v_item_count_before integer;
  v_order_count_after integer;
  v_item_count_after integer;
begin
  v_payload := jsonb_build_object(
    'submission_key', v_key::text,
    'customer_name', 'O12A Replay Verification Customer',
    'customer_phone', '09990001203',
    'fulfillment_type', 'pickup',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 125,
    'total', 125,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O12A Replay Verification Item',
        'quantity', 1,
        'unit_price', 125,
        'line_total', 125,
        'sort_order', 0
      )
    )
  );

  update public.store_settings
  set website_ordering_enabled = true
  where id is true;

  v_response_first := public.submit_public_order(v_payload);

  select id into v_order_id
  from public.orders
  where public_submission_key = v_key;

  select count(*) into v_order_count_before
  from public.orders
  where public_submission_key = v_key;

  select count(*) into v_item_count_before
  from public.order_items
  where order_id = v_order_id;

  update public.store_settings
  set website_ordering_enabled = false
  where id is true;

  v_response_second := public.submit_public_order(v_payload);

  select count(*) into v_order_count_after
  from public.orders
  where public_submission_key = v_key;

  select count(*) into v_item_count_after
  from public.order_items
  where order_id = v_order_id;

  if v_response_second <> v_response_first then
    raise exception 'Replay while disabled returned a different response. first=%, second=%', v_response_first, v_response_second;
  end if;

  if v_order_count_before <> 1 or v_order_count_after <> 1 then
    raise exception 'Replay while disabled changed order count. before=%, after=%', v_order_count_before, v_order_count_after;
  end if;

  if v_item_count_before <> 1 or v_item_count_after <> 1 then
    raise exception 'Replay while disabled changed item count. before=%, after=%', v_item_count_before, v_item_count_after;
  end if;

  raise notice 'O12A disabled idempotent replay verification passed.';
end;
$$;

-- 9. Same key with changed payload while disabled preserves O10A conflict behavior.
do $$
declare
  v_key uuid := '00000000-0000-4000-8000-0000000012a4';
  v_payload jsonb;
  v_changed_payload jsonb;
  v_detail text;
  v_order_count integer;
begin
  v_payload := jsonb_build_object(
    'submission_key', v_key::text,
    'customer_name', 'O12A Conflict Verification Customer',
    'customer_phone', '09990001204',
    'fulfillment_type', 'pickup',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 55,
    'total', 55,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O12A Conflict Verification Item',
        'quantity', 1,
        'unit_price', 55,
        'line_total', 55,
        'sort_order', 0
      )
    )
  );

  update public.store_settings
  set website_ordering_enabled = true
  where id is true;

  perform public.submit_public_order(v_payload);

  update public.store_settings
  set website_ordering_enabled = false
  where id is true;

  v_changed_payload := jsonb_set(v_payload, '{customer_phone}', '"09990009999"'::jsonb);

  begin
    perform public.submit_public_order(v_changed_payload);
    raise exception 'Changed replay while disabled unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Changed replay while disabled unexpectedly succeeded.' then
      raise;
    end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate <> 'P0001' or v_detail <> 'INV_SUBMISSION_KEY_CONFLICT' then
      raise exception 'Changed replay while disabled did not preserve conflict detail. SQLSTATE=%, detail=%, message=%', sqlstate, v_detail, sqlerrm;
    end if;
  end;

  select count(*) into v_order_count
  from public.orders
  where public_submission_key = v_key;

  if v_order_count <> 1 then
    raise exception 'Changed replay while disabled changed order count: %', v_order_count;
  end if;

  raise notice 'O12A disabled conflict-preservation verification passed.';
end;
$$;

-- 10. Missing settings row: new submissions fail closed, existing replay still succeeds.
do $$
declare
  v_existing_key uuid := '00000000-0000-4000-8000-0000000012a5';
  v_new_key uuid := '00000000-0000-4000-8000-0000000012a6';
  v_existing_payload jsonb;
  v_new_payload jsonb;
  v_response_first jsonb;
  v_response_replay jsonb;
  v_detail text;
begin
  v_existing_payload := jsonb_build_object(
    'submission_key', v_existing_key::text,
    'customer_name', 'O12A Missing Settings Replay Customer',
    'customer_phone', '09990001205',
    'fulfillment_type', 'pickup',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 65,
    'total', 65,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O12A Missing Settings Replay Item',
        'quantity', 1,
        'unit_price', 65,
        'line_total', 65,
        'sort_order', 0
      )
    )
  );

  v_new_payload := jsonb_set(v_existing_payload, '{submission_key}', to_jsonb(v_new_key::text));

  insert into public.store_settings (id, website_ordering_enabled)
  values (true, true)
  on conflict (id) do update set website_ordering_enabled = excluded.website_ordering_enabled;

  v_response_first := public.submit_public_order(v_existing_payload);

  delete from public.store_settings where id is true;

  v_response_replay := public.submit_public_order(v_existing_payload);

  if v_response_replay <> v_response_first then
    raise exception 'Existing replay with missing settings row returned a different response.';
  end if;

  begin
    perform public.submit_public_order(v_new_payload);
    raise exception 'New submission with missing settings row unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'New submission with missing settings row unexpectedly succeeded.' then
      raise;
    end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate <> 'P0001' or v_detail <> 'CURV_ORDERING_CLOSED' then
      raise exception 'Missing settings new submission failed incorrectly. SQLSTATE=%, detail=%, message=%', sqlstate, v_detail, sqlerrm;
    end if;
  end;

  insert into public.store_settings (id, website_ordering_enabled)
  values (true, true);

  raise notice 'O12A missing-settings submission behavior verification passed.';
end;
$$;

-- 11. Fingerprint still uses SHA-256 over payload excluding submission_key.
do $$
declare
  v_key uuid := '00000000-0000-4000-8000-0000000012a7';
  v_payload jsonb;
  v_expected_fingerprint text;
  v_actual_fingerprint text;
begin
  update public.store_settings
  set website_ordering_enabled = true
  where id is true;

  v_payload := jsonb_build_object(
    'submission_key', v_key::text,
    'customer_name', 'O12A Fingerprint Verification Customer',
    'customer_phone', '09990001207',
    'fulfillment_type', 'pickup',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 40,
    'total', 40,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O12A Fingerprint Verification Item',
        'quantity', 1,
        'unit_price', 40,
        'line_total', 40,
        'sort_order', 0
      )
    )
  );

  v_expected_fingerprint := encode(
    extensions.digest(
      (v_payload - 'submission_key')::text,
      'sha256'
    ),
    'hex'
  );

  perform public.submit_public_order(v_payload);

  select public_submission_fingerprint
  into v_actual_fingerprint
  from public.orders
  where public_submission_key = v_key;

  if v_actual_fingerprint <> v_expected_fingerprint then
    raise exception 'O12A fingerprint mismatch. expected=%, actual=%', v_expected_fingerprint, v_actual_fingerprint;
  end if;

  raise notice 'O12A fingerprint verification passed.';
end;
$$;

rollback;

-- =========================================================
-- Manual Supabase tests still required if Section 4 reports no owner row
-- =========================================================
-- In a reviewed Supabase SQL Editor transaction, set request.jwt.claim.sub to
-- an existing owner Auth user UUID from public.admin_profiles, then call:
--
-- select public.set_website_ordering_enabled(false);
-- select public.get_public_store_status();
-- select public.set_website_ordering_enabled(true);
--
-- Confirm updated_by equals the owner user UUID, updated_at changes, and the
-- final transaction is rolled back unless Isaiah explicitly approves the
-- production state change.
--
-- Rollback note:
-- Do not casually drop public.store_settings after production use because it
-- may contain operational status and audit metadata. Prefer restoring the
-- prior submit_public_order definition and revoking/dropping new RPCs unless
-- destructive cleanup is separately reviewed and approved.
