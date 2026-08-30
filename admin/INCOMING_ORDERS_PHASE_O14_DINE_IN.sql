-- CURV Incoming Orders O14 - Dine-In Ordering
-- Draft migration only. Review before manual Supabase execution.

begin;

alter table public.orders
  drop constraint if exists orders_fulfillment_type_check;

alter table public.orders
  add constraint orders_fulfillment_type_check
  check (fulfillment_type in ('delivery', 'pickup', 'dine_in'));

alter table public.orders
  drop constraint if exists orders_delivery_state_check;

alter table public.orders
  add constraint orders_delivery_state_check
  check (
    (
      fulfillment_type = 'delivery'
      and delivery_option in ('curv_rider', 'lalamove')
      and nullif(btrim(coalesce(delivery_address, '')), '') is not null
      and delivery_fee_status in ('to_confirm', 'confirmed', 'waived')
    )
    or
    (
      fulfillment_type in ('pickup', 'dine_in')
      and delivery_option is null
      and delivery_address is null
      and delivery_fee is null
      and delivery_fee_status = 'not_applicable'
    )
  );

comment on column public.orders.fulfillment_type is
  'Order fulfillment method: delivery, pickup, or dine_in. Dine-in uses customer-name handoff and has no table number.';

-- Preserve the deployed O10 idempotency and O12 Website Ordering function.
-- Only widen its explicit fulfillment validation and customer-facing error.
do $$
declare
  v_function_oid oid := to_regprocedure('public.submit_public_order(jsonb)');
  v_definition text;
  v_old_check text := 'v_fulfillment_type not in (''delivery'', ''pickup'')';
  v_new_check text := 'v_fulfillment_type not in (''delivery'', ''pickup'', ''dine_in'')';
  v_old_message text := 'Unsupported fulfillment type. Delivery and pickup are supported.';
  v_new_message text := 'Unsupported fulfillment type. Dine In, delivery, and pickup are supported.';
begin
  if v_function_oid is null then
    raise exception 'public.submit_public_order(jsonb) is missing.';
  end if;

  select pg_get_functiondef(v_function_oid) into v_definition;

  if position('public_submission_key' in v_definition) = 0
    or position('CURV_ORDERING_CLOSED' in v_definition) = 0
  then
    raise exception 'O14 requires the deployed O10/O12 submit_public_order contract.';
  end if;

  if position(v_new_check in v_definition) = 0 then
    if position(v_old_check in v_definition) = 0 then
      raise exception 'Expected delivery/pickup fulfillment validation was not found.';
    end if;
    v_definition := replace(v_definition, v_old_check, v_new_check);
  end if;

  if position(v_new_message in v_definition) = 0 then
    if position(v_old_message in v_definition) = 0 then
      raise exception 'Expected fulfillment validation message was not found.';
    end if;
    v_definition := replace(v_definition, v_old_message, v_new_message);
  end if;

  execute v_definition;
end;
$$;

comment on function public.submit_public_order(jsonb) is
  'Controlled guest delivery, pickup, and dine-in submission. Preserves tracking-token response, submission-key idempotency, and Website Ordering closure.';

revoke all on function public.submit_public_order(jsonb) from public;
grant execute on function public.submit_public_order(jsonb) to anon;
grant execute on function public.submit_public_order(jsonb) to authenticated;

revoke all privileges on table public.orders from anon;
revoke all privileges on table public.order_items from anon;

commit;
