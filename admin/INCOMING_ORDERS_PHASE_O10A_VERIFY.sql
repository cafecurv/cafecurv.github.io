-- Incoming Orders Phase O10A Verification SQL
--
-- Purpose:
-- Verify public order submission idempotency backend behavior after reviewing
-- and applying:
-- admin/INCOMING_ORDERS_PHASE_O10A_IDEMPOTENCY_BACKEND.sql
--
-- This script intentionally wraps mutation tests in a transaction and ends
-- with rollback so verification orders and order_items do not remain.

begin;

-- 1. Function exists with expected input signature and security settings.
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

  raise notice 'O10A function metadata verification passed.';
end;
$$;

-- 2. Idempotency columns, defaults, consistency constraint, and index.
do $$
declare
  v_constraint_def text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'public_submission_key'
      and udt_name = 'uuid'
      and is_nullable = 'YES'
      and column_default is null
  ) then
    raise exception 'orders.public_submission_key is missing or has the wrong type/nullability/default.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'public_submission_fingerprint'
      and data_type = 'text'
      and is_nullable = 'YES'
      and column_default is null
  ) then
    raise exception 'orders.public_submission_fingerprint is missing or has the wrong type/nullability/default.';
  end if;

  select pg_get_constraintdef(c.oid)
  into v_constraint_def
  from pg_constraint c
  where c.conname = 'orders_public_submission_pair_check'
    and c.conrelid = 'public.orders'::regclass;

  if v_constraint_def is null
    or v_constraint_def not ilike '%public_submission_key is null%'
    or v_constraint_def not ilike '%public_submission_fingerprint is null%'
    or v_constraint_def not ilike '%public_submission_key is not null%'
    or v_constraint_def not ilike '%public_submission_fingerprint is not null%' then
    raise exception 'orders_public_submission_pair_check is missing or unexpected: %', v_constraint_def;
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'orders'
      and indexname = 'orders_public_submission_key_idx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%public_submission_key%'
      and indexdef ilike '%where (public_submission_key is not null)%'
  ) then
    raise exception 'orders_public_submission_key_idx is missing or is not the expected partial unique index.';
  end if;

  raise notice 'O10A schema verification passed.';
end;
$$;

-- 3. Keyless compatibility: succeeds, exact response, stored key/fingerprint null.
do $$
declare
  v_response jsonb;
  v_response_keys text[];
  v_order record;
begin
  v_response := public.submit_public_order(jsonb_build_object(
    'customer_name', 'O10A No-Key Verification Customer',
    'customer_phone', '09990001012',
    'fulfillment_type', 'pickup',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 75,
    'total', 75,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O10A No-Key Verification Item',
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
    raise exception 'No-key submission returned unexpected response keys: %', v_response_keys;
  end if;

  select o.public_submission_key, o.public_submission_fingerprint
  into v_order
  from public.orders o
  where o.order_number = v_response ->> 'order_number'
  limit 1;

  if not found
    or v_order.public_submission_key is not null
    or v_order.public_submission_fingerprint is not null then
    raise exception 'No-key submission stored unexpected idempotency metadata.';
  end if;

  raise notice 'O10A no-key compatibility verification passed.';
end;
$$;

-- 4-8. First keyed submission, exact replay, fingerprint, item count, tracking,
-- response privacy, and exact response contract.
do $$
declare
  v_key uuid := '00000000-0000-4000-8000-0000000010a1';
  v_payload jsonb;
  v_payload_without_key jsonb;
  v_expected_fingerprint text;
  v_response_first jsonb;
  v_response_second jsonb;
  v_response_keys text[];
  v_order_number text;
  v_tracking_token uuid;
  v_order record;
  v_order_count integer;
  v_item_count integer;
  v_tracking jsonb;
begin
  v_payload := jsonb_build_object(
    'submission_key', v_key::text,
    'customer_name', 'O10A Verification Customer',
    'customer_phone', '09990001010',
    'fulfillment_type', 'pickup',
    'pickup_time', 'O10A rollback test',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 123.45,
    'total', 123.45,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O10A Verification Item',
        'category_name', 'Verification',
        'variant_label', 'Test',
        'quantity', 1,
        'unit_price', 123.45,
        'line_total', 123.45,
        'options', jsonb_build_object(),
        'sort_order', 0
      )
    )
  );
  v_payload_without_key := v_payload - 'submission_key';
  v_expected_fingerprint := encode(
    extensions.digest(
      v_payload_without_key::text,
      'sha256'
    ),
    'hex'
  );

  v_response_first := public.submit_public_order(v_payload);
  v_response_second := public.submit_public_order(v_payload);

  if v_response_second <> v_response_first then
    raise exception 'Idempotent replay returned a different response. first=%, second=%', v_response_first, v_response_second;
  end if;

  select array_agg(key order by key)
  into v_response_keys
  from jsonb_object_keys(v_response_first) as key;

  if v_response_keys <> array['order_number', 'tracking_token'] then
    raise exception 'Unexpected submit_public_order response keys: %', v_response_keys;
  end if;

  if v_response_first ? 'submission_key'
    or v_response_first ? 'public_submission_key'
    or v_response_first ? 'public_submission_fingerprint' then
    raise exception 'submit_public_order exposed idempotency fields: %', v_response_first;
  end if;

  v_order_number := v_response_first ->> 'order_number';
  v_tracking_token := (v_response_first ->> 'tracking_token')::uuid;

  select
    o.id,
    o.order_number,
    o.tracking_token,
    o.public_submission_key,
    o.public_submission_fingerprint
  into v_order
  from public.orders o
  where o.public_submission_key = v_key
  limit 1;

  if not found then
    raise exception 'Keyed submission did not store public_submission_key.';
  end if;

  if v_order.order_number <> v_order_number
    or v_order.tracking_token <> v_tracking_token
    or v_order.public_submission_key <> v_key then
    raise exception 'Stored keyed order does not match returned public response.';
  end if;

  if v_order.public_submission_fingerprint <> v_expected_fingerprint then
    raise exception 'Stored fingerprint mismatch. expected=%, actual=%', v_expected_fingerprint, v_order.public_submission_fingerprint;
  end if;

  select count(*)
  into v_order_count
  from public.orders o
  where o.public_submission_key = v_key;

  if v_order_count <> 1 then
    raise exception 'Expected one order for key %, found %.', v_key, v_order_count;
  end if;

  select count(*)
  into v_item_count
  from public.order_items oi
  where oi.order_id = v_order.id;

  if v_item_count <> 1 then
    raise exception 'Expected one order item after exact replay, found %.', v_item_count;
  end if;

  select to_jsonb(t)
  into v_tracking
  from public.get_public_order_tracking(v_tracking_token) t
  limit 1;

  if v_tracking is null or v_tracking ->> 'order_number' <> v_order_number then
    raise exception 'get_public_order_tracking did not retrieve the keyed order.';
  end if;

  if v_tracking ? 'submission_key'
    or v_tracking ? 'public_submission_key'
    or v_tracking ? 'public_submission_fingerprint' then
    raise exception 'Tracking output exposed idempotency fields: %', v_tracking;
  end if;

  raise notice 'O10A keyed submission and exact replay verification passed.';
end;
$$;

-- 9. Mismatch variants: same key with changed customer, item quantity,
-- fulfillment type, and delivery detail must raise INV_SUBMISSION_KEY_CONFLICT.
do $$
declare
  v_key uuid := '00000000-0000-4000-8000-0000000010a2';
  v_payload jsonb;
  v_changed_payload jsonb;
  v_order_id uuid;
  v_orders_before integer;
  v_items_before integer;
  v_orders_after integer;
  v_items_after integer;
  v_detail text;
begin
  v_payload := jsonb_build_object(
    'submission_key', v_key::text,
    'customer_name', 'O10A Conflict Verification Customer',
    'customer_phone', '09990001011',
    'fulfillment_type', 'delivery',
    'delivery_option', 'curv_rider',
    'delivery_address', 'O10A rollback address',
    'delivery_fee_status', 'to_confirm',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 50,
    'total', 50,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O10A Conflict Verification Item',
        'quantity', 1,
        'unit_price', 50,
        'line_total', 50,
        'sort_order', 0
      )
    )
  );

  perform public.submit_public_order(v_payload);

  select o.id
  into v_order_id
  from public.orders o
  where o.public_submission_key = v_key;

  select count(*)
  into v_orders_before
  from public.orders o
  where o.public_submission_key = v_key;

  select count(*)
  into v_items_before
  from public.order_items oi
  where oi.order_id = v_order_id;

  foreach v_changed_payload in array array[
    jsonb_set(v_payload, '{customer_phone}', '"09990009999"'::jsonb),
    jsonb_set(v_payload, '{items,0,quantity}', '2'::jsonb),
    jsonb_build_object(
      'submission_key', v_key::text,
      'customer_name', 'O10A Conflict Verification Customer',
      'customer_phone', '09990001011',
      'fulfillment_type', 'pickup',
      'currency', 'PHP',
      'payment_method', 'cash',
      'subtotal', 50,
      'total', 50,
      'items', jsonb_build_array(
        jsonb_build_object(
          'product_name', 'O10A Conflict Verification Item',
          'quantity', 1,
          'unit_price', 50,
          'line_total', 50,
          'sort_order', 0
        )
      )
    ),
    jsonb_set(v_payload, '{delivery_address}', '"O10A changed rollback address"'::jsonb)
  ]
  loop
    begin
      perform public.submit_public_order(v_changed_payload);
      raise exception 'Changed payload with reused submission_key unexpectedly succeeded.';
    exception when others then
      if sqlstate = 'P0001'
        and sqlerrm = 'Changed payload with reused submission_key unexpectedly succeeded.' then
        raise;
      end if;

      get stacked diagnostics v_detail = pg_exception_detail;
      if v_detail <> 'INV_SUBMISSION_KEY_CONFLICT' then
        raise exception 'Changed payload failed without INV_SUBMISSION_KEY_CONFLICT. SQLSTATE=%, detail=%, message=%', sqlstate, v_detail, sqlerrm;
      end if;
    end;
  end loop;

  select count(*)
  into v_orders_after
  from public.orders o
  where o.public_submission_key = v_key;

  select count(*)
  into v_items_after
  from public.order_items oi
  where oi.order_id = v_order_id;

  if v_orders_before <> 1 or v_orders_after <> 1 then
    raise exception 'Mismatch checks changed order count. before=%, after=%', v_orders_before, v_orders_after;
  end if;

  if v_items_before <> 1 or v_items_after <> 1 then
    raise exception 'Mismatch checks changed order item count. before=%, after=%', v_items_before, v_items_after;
  end if;

  raise notice 'O10A mismatch conflict verification passed.';
end;
$$;

-- 10. Same logical order with a different key creates a separate order.
do $$
declare
  v_key_a uuid := '00000000-0000-4000-8000-0000000010a3';
  v_key_b uuid := '00000000-0000-4000-8000-0000000010a4';
  v_payload_a jsonb;
  v_payload_b jsonb;
  v_response_a jsonb;
  v_response_b jsonb;
  v_order_count integer;
begin
  v_payload_a := jsonb_build_object(
    'submission_key', v_key_a::text,
    'customer_name', 'O10A Different Key Customer',
    'customer_phone', '09990001013',
    'fulfillment_type', 'pickup',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 88,
    'total', 88,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O10A Different Key Item',
        'quantity', 1,
        'unit_price', 88,
        'line_total', 88,
        'sort_order', 0
      )
    )
  );
  v_payload_b := jsonb_set(v_payload_a, '{submission_key}', to_jsonb(v_key_b::text));

  v_response_a := public.submit_public_order(v_payload_a);
  v_response_b := public.submit_public_order(v_payload_b);

  if v_response_a ->> 'order_number' = v_response_b ->> 'order_number'
    or v_response_a ->> 'tracking_token' = v_response_b ->> 'tracking_token' then
    raise exception 'Different submission keys did not create distinct public responses.';
  end if;

  select count(*)
  into v_order_count
  from public.orders o
  where o.public_submission_key in (v_key_a, v_key_b);

  if v_order_count <> 2 then
    raise exception 'Expected two keyed orders for different keys, found %.', v_order_count;
  end if;

  raise notice 'O10A different-key verification passed.';
end;
$$;

-- 11. Malformed UUID fails cleanly without partial rows.
do $$
declare
  v_orders_before integer;
  v_items_before integer;
  v_orders_after integer;
  v_items_after integer;
begin
  select count(*) into v_orders_before
  from public.orders
  where customer_name = 'O10A Malformed UUID Customer';

  select count(*) into v_items_before
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.customer_name = 'O10A Malformed UUID Customer';

  begin
    perform public.submit_public_order(jsonb_build_object(
      'submission_key', 'not-a-uuid',
      'customer_name', 'O10A Malformed UUID Customer',
      'customer_phone', '09990001014',
      'fulfillment_type', 'pickup',
      'currency', 'PHP',
      'payment_method', 'cash',
      'subtotal', 10,
      'total', 10,
      'items', jsonb_build_array(
        jsonb_build_object(
          'product_name', 'O10A Malformed UUID Item',
          'quantity', 1,
          'unit_price', 10,
          'line_total', 10,
          'sort_order', 0
        )
      )
    ));
    raise exception 'Malformed submission_key unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Malformed submission_key unexpectedly succeeded.' then
      raise;
    end if;

    if sqlstate <> '22023' then
      raise exception 'Malformed submission_key failed with unexpected SQLSTATE %. Message: %', sqlstate, sqlerrm;
    end if;
  end;

  select count(*) into v_orders_after
  from public.orders
  where customer_name = 'O10A Malformed UUID Customer';

  select count(*) into v_items_after
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.customer_name = 'O10A Malformed UUID Customer';

  if v_orders_after <> v_orders_before or v_items_after <> v_items_before then
    raise exception 'Malformed UUID left partial orders or order_items.';
  end if;

  raise notice 'O10A malformed UUID verification passed.';
end;
$$;

-- 12. Invalid payload rollback: failed keyed validation leaves no rows, then
-- the same key can be reused successfully after correction.
do $$
declare
  v_key uuid := '00000000-0000-4000-8000-0000000010a5';
  v_invalid_payload jsonb;
  v_valid_payload jsonb;
  v_response jsonb;
  v_order_count integer;
  v_item_count integer;
begin
  v_invalid_payload := jsonb_build_object(
    'submission_key', v_key::text,
    'customer_name', 'O10A Invalid Then Valid Customer',
    'customer_phone', '09990001015',
    'fulfillment_type', 'pickup',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 20,
    'total', 20,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O10A Invalid Then Valid Item',
        'quantity', 0,
        'unit_price', 20,
        'line_total', 20,
        'sort_order', 0
      )
    )
  );

  begin
    perform public.submit_public_order(v_invalid_payload);
    raise exception 'Invalid keyed payload unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Invalid keyed payload unexpectedly succeeded.' then
      raise;
    end if;
  end;

  select count(*)
  into v_order_count
  from public.orders o
  where o.public_submission_key = v_key;

  if v_order_count <> 0 then
    raise exception 'Invalid keyed payload created an order.';
  end if;

  v_valid_payload := jsonb_set(v_invalid_payload, '{items,0,quantity}', '1'::jsonb);
  v_response := public.submit_public_order(v_valid_payload);

  select count(*)
  into v_order_count
  from public.orders o
  where o.public_submission_key = v_key;

  select count(*)
  into v_item_count
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.public_submission_key = v_key;

  if v_order_count <> 1 or v_item_count <> 1 then
    raise exception 'Corrected keyed payload did not create exactly one order and item. orders=%, items=%', v_order_count, v_item_count;
  end if;

  if (select array_agg(key order by key) from jsonb_object_keys(v_response) as key) <> array['order_number', 'tracking_token'] then
    raise exception 'Corrected keyed payload returned unexpected response keys: %', v_response;
  end if;

  raise notice 'O10A invalid-payload rollback and key reuse verification passed.';
end;
$$;

-- 13. Existing execute grants are correct for public submission.
do $$
begin
  if not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'submit_public_order'
      and grantee = 'anon'
      and privilege_type = 'EXECUTE'
  ) then
    raise exception 'anon EXECUTE grant missing for submit_public_order.';
  end if;

  if not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'submit_public_order'
      and grantee = 'authenticated'
      and privilege_type = 'EXECUTE'
  ) then
    raise exception 'authenticated EXECUTE grant missing for submit_public_order.';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'submit_public_order'
      and grantee = 'public'
  ) then
    raise exception 'public has unexpected routine privilege on submit_public_order.';
  end if;

  raise notice 'O10A function grant verification passed.';
end;
$$;

-- 14. Anonymous users have zero direct privileges on protected order tables.
do $$
declare
  v_anon_privileges text;
begin
  select string_agg(table_name || ':' || privilege_type, ', ' order by table_name, privilege_type)
  into v_anon_privileges
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('orders', 'order_items')
    and grantee = 'anon';

  if v_anon_privileges is not null then
    raise exception 'Anon has direct protected table privileges: %', v_anon_privileges;
  end if;

  raise notice 'O10A anon table privilege verification passed: no direct table privileges.';
end;
$$;

rollback;
