-- CURV Incoming Orders O14 - rollback-only verification
-- Run manually only after applying INCOMING_ORDERS_PHASE_O14_DINE_IN.sql.

begin;

do $$
declare
  v_function_oid oid := to_regprocedure('public.submit_public_order(jsonb)');
  v_function_body text;
  v_fulfillment_constraint text;
  v_delivery_constraint text;
begin
  select lower(pg_get_constraintdef(c.oid))
  into v_fulfillment_constraint
  from pg_constraint c
  where c.conrelid = 'public.orders'::regclass
    and c.conname = 'orders_fulfillment_type_check';

  select lower(pg_get_constraintdef(c.oid))
  into v_delivery_constraint
  from pg_constraint c
  where c.conrelid = 'public.orders'::regclass
    and c.conname = 'orders_delivery_state_check';

  if v_fulfillment_constraint is null
    or position('delivery' in v_fulfillment_constraint) = 0
    or position('pickup' in v_fulfillment_constraint) = 0
    or position('dine_in' in v_fulfillment_constraint) = 0
  then
    raise exception 'Fulfillment constraint does not permit all three O14 methods.';
  end if;

  if v_delivery_constraint is null
    or position('dine_in' in v_delivery_constraint) = 0
    or position('delivery_address is null' in v_delivery_constraint) = 0
    or position('delivery_option is null' in v_delivery_constraint) = 0
    or position('delivery_fee is null' in v_delivery_constraint) = 0
  then
    raise exception 'Dine-in delivery-field nullability contract is missing.';
  end if;

  if v_function_oid is null then
    raise exception 'submit_public_order(jsonb) is missing.';
  end if;

  select pg_get_functiondef(v_function_oid) into v_function_body;
  if position('(''delivery'', ''pickup'', ''dine_in'')' in v_function_body) = 0
    or position('public_submission_key' in v_function_body) = 0
    or position('CURV_ORDERING_CLOSED' in v_function_body) = 0
  then
    raise exception 'O14 RPC validation, O10 idempotency, or O12 ordering gate is missing.';
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = v_function_oid
      and p.prosecdef = true
      and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'submit_public_order must remain SECURITY DEFINER with its reviewed search_path.';
  end if;

  if not has_function_privilege('anon', v_function_oid, 'EXECUTE')
    or not has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
    or has_table_privilege('anon', 'public.orders', 'INSERT')
    or has_table_privilege('anon', 'public.orders', 'UPDATE')
    or has_table_privilege('anon', 'public.order_items', 'INSERT')
  then
    raise exception 'O14 public RPC or direct-table grants are incorrect.';
  end if;
end;
$$;

do $$
declare
  v_existing_orders jsonb;
  v_test_ids uuid[] := '{}'::uuid[];
  v_dine_key uuid := gen_random_uuid();
  v_pickup_key uuid := gen_random_uuid();
  v_delivery_key uuid := gen_random_uuid();
  v_dine_response jsonb;
  v_replay_response jsonb;
  v_pickup_response jsonb;
  v_delivery_response jsonb;
  v_dine_order public.orders%rowtype;
  v_pickup_order public.orders%rowtype;
  v_delivery_order public.orders%rowtype;
  v_tracking record;
  v_invalid_rejected boolean := false;
  v_response_keys text[];
begin
  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
  into v_existing_orders
  from public.orders o;

  update public.store_settings
  set website_ordering_enabled = true
  where id is true;

  v_dine_response := public.submit_public_order(jsonb_build_object(
    'customer_name', 'O14 Dine In Test',
    'customer_phone', '09990001401',
    'fulfillment_type', 'dine_in',
    'pickup_time', null,
    'payment_method', 'counter',
    'delivery_option', 'curv_rider',
    'delivery_address', 'Must not persist',
    'delivery_fee_status', 'to_confirm',
    'subtotal', 180,
    'total', 180,
    'submission_key', v_dine_key,
    'items', jsonb_build_array(jsonb_build_object(
      'product_name', 'O14 Test Item',
      'quantity', 1,
      'unit_price', 180,
      'line_total', 180,
      'options', '{}'::jsonb,
      'sort_order', 0
    ))
  ));

  select array_agg(key order by key) into v_response_keys
  from jsonb_object_keys(v_dine_response) key;
  if v_response_keys <> array['order_number', 'tracking_token'] then
    raise exception 'Dine-in response contract changed: %', v_dine_response;
  end if;

  select o.* into strict v_dine_order
  from public.orders o
  where o.public_submission_key = v_dine_key;
  v_test_ids := array_append(v_test_ids, v_dine_order.id);

  if v_dine_order.fulfillment_type <> 'dine_in'
    or v_dine_order.customer_name <> 'O14 Dine In Test'
    or v_dine_order.customer_phone <> '09990001401'
    or v_dine_order.pickup_time is not null
    or v_dine_order.payment_method <> 'counter'
    or v_dine_order.payment_status <> 'unpaid'
    or v_dine_order.delivery_option is not null
    or v_dine_order.delivery_address is not null
    or v_dine_order.delivery_fee is not null
    or v_dine_order.delivery_fee_status <> 'not_applicable'
    or v_dine_order.tracking_token is null
  then
    raise exception 'Dine-in storage contract is incorrect.';
  end if;

  v_replay_response := public.submit_public_order(jsonb_build_object(
    'customer_name', 'O14 Dine In Test',
    'customer_phone', '09990001401',
    'fulfillment_type', 'dine_in',
    'pickup_time', null,
    'payment_method', 'counter',
    'delivery_option', 'curv_rider',
    'delivery_address', 'Must not persist',
    'delivery_fee_status', 'to_confirm',
    'subtotal', 180,
    'total', 180,
    'submission_key', v_dine_key,
    'items', jsonb_build_array(jsonb_build_object(
      'product_name', 'O14 Test Item',
      'quantity', 1,
      'unit_price', 180,
      'line_total', 180,
      'options', '{}'::jsonb,
      'sort_order', 0
    ))
  ));

  if v_replay_response is distinct from v_dine_response
    or (select count(*) from public.orders o where o.public_submission_key = v_dine_key) <> 1
  then
    raise exception 'Dine-in idempotency replay created or returned a different order.';
  end if;

  select * into strict v_tracking
  from public.get_public_order_tracking(v_dine_order.tracking_token);
  if v_tracking.fulfillment_type <> 'dine_in' or v_tracking.delivery_address is not null then
    raise exception 'Dine-in tracking contract is incorrect.';
  end if;

  v_pickup_response := public.submit_public_order(jsonb_build_object(
    'customer_name', 'O14 Pickup Test',
    'customer_phone', '09990001402',
    'fulfillment_type', 'pickup',
    'pickup_time', 'ASAP',
    'payment_method', 'cod',
    'subtotal', 90,
    'total', 90,
    'submission_key', v_pickup_key,
    'items', jsonb_build_array(jsonb_build_object(
      'product_name', 'O14 Pickup Item', 'quantity', 1,
      'unit_price', 90, 'line_total', 90, 'options', '{}'::jsonb, 'sort_order', 0
    ))
  ));
  select o.* into strict v_pickup_order from public.orders o where o.public_submission_key = v_pickup_key;
  v_test_ids := array_append(v_test_ids, v_pickup_order.id);
  if v_pickup_order.fulfillment_type <> 'pickup' or v_pickup_order.delivery_address is not null then
    raise exception 'Pickup regression detected.';
  end if;

  v_delivery_response := public.submit_public_order(jsonb_build_object(
    'customer_name', 'O14 Delivery Test',
    'customer_phone', '09990001403',
    'fulfillment_type', 'delivery',
    'pickup_time', 'ASAP',
    'payment_method', 'cod',
    'delivery_option', 'curv_rider',
    'delivery_address', 'O14 rollback address',
    'delivery_fee_status', 'to_confirm',
    'subtotal', 100,
    'total', 100,
    'submission_key', v_delivery_key,
    'items', jsonb_build_array(jsonb_build_object(
      'product_name', 'O14 Delivery Item', 'quantity', 1,
      'unit_price', 100, 'line_total', 100, 'options', '{}'::jsonb, 'sort_order', 0
    ))
  ));
  select o.* into strict v_delivery_order from public.orders o where o.public_submission_key = v_delivery_key;
  v_test_ids := array_append(v_test_ids, v_delivery_order.id);
  if v_delivery_order.fulfillment_type <> 'delivery'
    or v_delivery_order.delivery_option <> 'curv_rider'
    or v_delivery_order.delivery_address <> 'O14 rollback address'
  then
    raise exception 'Delivery regression detected.';
  end if;

  begin
    perform public.submit_public_order(jsonb_build_object(
      'customer_name', 'O14 Invalid Test',
      'customer_phone', '09990001404',
      'fulfillment_type', 'table_service',
      'subtotal', 1,
      'total', 1,
      'items', jsonb_build_array(jsonb_build_object(
        'product_name', 'Invalid', 'quantity', 1,
        'unit_price', 1, 'line_total', 1, 'options', '{}'::jsonb, 'sort_order', 0
      ))
    ));
  exception when sqlstate '22023' then
    v_invalid_rejected := true;
  end;

  if not v_invalid_rejected then
    raise exception 'Invalid fulfillment was not rejected.';
  end if;

  if (
    select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    from public.orders o
    where not (o.id = any(v_test_ids))
  ) is distinct from v_existing_orders then
    raise exception 'Historical order rows changed during O14 verification.';
  end if;

  raise notice 'O14 rollback verification passed: dine-in, pickup, delivery, tracking, idempotency, and grants.';
end;
$$;

rollback;
