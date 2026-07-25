-- Incoming Orders Phase O8A Verification SQL
--
-- Purpose:
-- Verify public.submit_public_order(jsonb) returns only:
-- - order_number
-- - tracking_token
--
-- Run manually in Supabase after reviewing and applying:
-- admin/INCOMING_ORDERS_PHASE_O8A_RETURN_TRACKING_TOKEN.sql
--
-- This script intentionally wraps mutation tests in a transaction and ends
-- with rollback so verification orders and order_items do not remain.

begin;

-- 1. Function exists with expected input signature and security settings.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as function_result,
  p.prosecdef as is_security_definer,
  p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'submit_public_order'
  and pg_get_function_identity_arguments(p.oid) = 'order_payload jsonb';

-- 2. tracking_token column has expected type/default/nullability.
select
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name = 'tracking_token';

-- 3. tracking_token uniqueness is enforced.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'orders'
  and indexname = 'orders_tracking_token_idx';

-- 4-7. Successful test submission returns non-null tracking_token, the token
-- belongs to the created order, public tracking can retrieve it, and the
-- response exposes no unnecessary internal/private fields.
do $$
declare
  v_response jsonb;
  v_order_number text;
  v_tracking_token uuid;
  v_response_keys text[];
  v_order record;
  v_tracking record;
begin
  v_response := public.submit_public_order(jsonb_build_object(
    'customer_name', 'O8A Verification Customer',
    'customer_phone', '09990000000',
    'fulfillment_type', 'pickup',
    'pickup_time', 'O8A rollback test',
    'currency', 'PHP',
    'payment_method', 'cash',
    'subtotal', 123.45,
    'total', 123.45,
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_name', 'O8A Verification Item',
        'category_name', 'Verification',
        'variant_label', 'Test',
        'quantity', 1,
        'unit_price', 123.45,
        'line_total', 123.45,
        'options', jsonb_build_object(),
        'sort_order', 0
      )
    )
  ));

  v_order_number := v_response ->> 'order_number';
  v_tracking_token := (v_response ->> 'tracking_token')::uuid;

  select array_agg(key order by key)
  into v_response_keys
  from jsonb_object_keys(v_response) as key;

  if v_response_keys <> array['order_number', 'tracking_token'] then
    raise exception 'Unexpected submit_public_order response keys: %', v_response_keys;
  end if;

  if v_order_number is null or v_order_number = '' then
    raise exception 'submit_public_order did not return order_number.';
  end if;

  if v_tracking_token is null then
    raise exception 'submit_public_order did not return tracking_token.';
  end if;

  select o.id, o.order_number, o.tracking_token
  into v_order
  from public.orders o
  where o.order_number = v_order_number
  limit 1;

  if not found or v_order.tracking_token <> v_tracking_token then
    raise exception 'Returned tracking_token does not belong to the created order.';
  end if;

  select *
  into v_tracking
  from public.get_public_order_tracking(v_tracking_token)
  limit 1;

  if not found or v_tracking.order_number <> v_order_number then
    raise exception 'get_public_order_tracking did not retrieve the created order.';
  end if;

  if v_response ? 'order_id'
    or v_response ? 'customer_phone'
    or v_response ? 'customer_email'
    or v_response ? 'delivery_address'
    or v_response ? 'customer_notes'
    or v_response ? 'admin_notes'
    or v_response ? 'status'
    or v_response ? 'subtotal'
    or v_response ? 'total' then
    raise exception 'submit_public_order response exposed unnecessary fields: %', v_response;
  end if;

  raise notice 'O8A response verification passed. order_number=%, tracking_token=%', v_order_number, v_tracking_token;
end;
$$;

-- 8. Existing execute grants are correct for public submission.
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'submit_public_order'
  and grantee in ('anon', 'authenticated', 'public')
order by grantee, privilege_type;

-- 9. Anonymous users have zero direct privileges on protected order tables.
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

  raise notice 'O8A anon table privilege verification passed: no SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, or other direct table privileges.';
end;
$$;

-- 10. Invalid payloads still roll back without leaving partial orders or lines.
do $$
declare
  v_orders_before integer;
  v_items_before integer;
  v_orders_after integer;
  v_items_after integer;
begin
  select count(*) into v_orders_before
  from public.orders
  where customer_name = 'O8A Invalid Verification Customer';

  select count(*) into v_items_before
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.customer_name = 'O8A Invalid Verification Customer';

  begin
    perform public.submit_public_order(jsonb_build_object(
      'customer_name', 'O8A Invalid Verification Customer',
      'customer_phone', '09990000001',
      'fulfillment_type', 'pickup',
      'currency', 'PHP',
      'subtotal', 10,
      'total', 10,
      'items', jsonb_build_array(
        jsonb_build_object(
          'product_name', 'O8A Invalid Verification Item',
          'quantity', 0,
          'unit_price', 10,
          'line_total', 10,
          'sort_order', 0
        )
      )
    ));
    raise exception 'Invalid payload unexpectedly succeeded.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Invalid payload unexpectedly succeeded.' then
      raise;
    end if;
  end;

  select count(*) into v_orders_after
  from public.orders
  where customer_name = 'O8A Invalid Verification Customer';

  select count(*) into v_items_after
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.customer_name = 'O8A Invalid Verification Customer';

  if v_orders_after <> v_orders_before or v_items_after <> v_items_before then
    raise exception 'Invalid payload left partial orders or order_items.';
  end if;

  raise notice 'O8A invalid-payload rollback verification passed.';
end;
$$;

rollback;
