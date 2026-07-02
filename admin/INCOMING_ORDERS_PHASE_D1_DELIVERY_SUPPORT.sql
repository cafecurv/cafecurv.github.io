-- Incoming Orders Phase D1 Delivery Support SQL Draft
--
-- Purpose:
-- Shift CURV Direct Web Ordering planning from pickup-first to delivery-first
-- while keeping live public submission locked.
--
-- Business flow:
-- - Customer usually starts in Facebook Messenger and receives the website link.
-- - Customer submits food/drink items from the website.
-- - Website returns an order number and food/drink subtotal only.
-- - Customer returns to Messenger with the order number.
-- - CURV confirms delivery fee and final total manually.
-- - Admin accepts/prepares only after final total and/or payment is confirmed.
--
-- This draft is SQL only:
-- - No menu.html changes.
-- - No admin UI changes.
-- - No POS/inventory deduction.
-- - No customer accounts, delivery accounts, rewards, or saved addresses.
-- - Do not grant anon execute while the live safety lock is in place.

-- =========================================================
-- Orders Delivery Columns
-- =========================================================
-- Existing Phase A columns:
-- - subtotal is the food/drink subtotal.
-- - total currently mirrors the customer-submitted total.
--
-- D1 semantics:
-- - For delivery submissions, subtotal and total are stored as the food/drink
--   subtotal at submit time. Delivery fee is not final yet.
-- - delivery_fee remains null until CURV confirms it manually.
-- - delivery_fee_status starts as to_confirm for delivery orders.
-- - Final delivery total should be confirmed manually before accepting.

create sequence if not exists public.order_number_seq start with 1000;

alter table public.orders
  add column if not exists delivery_option text null,
  add column if not exists delivery_address text null,
  add column if not exists delivery_fee numeric(10,2) null,
  add column if not exists delivery_fee_status text not null default 'not_applicable';

comment on column public.orders.delivery_option is
  'Delivery provider requested by the customer: curv_rider or lalamove. Null for pickup.';

comment on column public.orders.delivery_address is
  'Customer-entered delivery address snapshot. Required for delivery orders.';

comment on column public.orders.delivery_fee is
  'Manually confirmed delivery fee. Null at website submit time until CURV confirms through Messenger.';

comment on column public.orders.delivery_fee_status is
  'Delivery fee workflow state. Delivery orders submit as to_confirm; pickup orders use not_applicable.';

-- Phase A allowed pickup only. D1 allows delivery and pickup. Dine-in remains
-- rejected by both table constraints and the RPC.
alter table public.orders
  drop constraint if exists orders_fulfillment_type_check;

alter table public.orders
  add constraint orders_fulfillment_type_check
  check (fulfillment_type in ('delivery', 'pickup'));

alter table public.orders
  drop constraint if exists orders_delivery_option_check;

alter table public.orders
  add constraint orders_delivery_option_check
  check (
    delivery_option is null
    or delivery_option in ('curv_rider', 'lalamove')
  );

alter table public.orders
  drop constraint if exists orders_delivery_fee_status_check;

alter table public.orders
  add constraint orders_delivery_fee_status_check
  check (
    delivery_fee_status in (
      'not_applicable',
      'to_confirm',
      'confirmed',
      'waived'
    )
  );

alter table public.orders
  drop constraint if exists orders_delivery_fee_nonnegative_check;

alter table public.orders
  add constraint orders_delivery_fee_nonnegative_check
  check (delivery_fee is null or delivery_fee >= 0);

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
      fulfillment_type = 'pickup'
      and delivery_option is null
      and delivery_address is null
      and delivery_fee is null
      and delivery_fee_status = 'not_applicable'
    )
  );

create index if not exists orders_fulfillment_type_idx
  on public.orders (fulfillment_type);

create index if not exists orders_delivery_fee_status_idx
  on public.orders (delivery_fee_status);

-- =========================================================
-- Delivery-First Public Guest Order Submission RPC
-- =========================================================
-- ADVISORY TOTALS: line prices and food/drink subtotals are submitted by the
-- client. These are not validated against published product prices in this
-- phase. Delivery fee and final total are confirmed manually through Messenger
-- before CURV accepts/prepares the order.
create or replace function public.submit_public_order(order_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb := coalesce(order_payload, '{}'::jsonb);
  v_items jsonb := coalesce(v_payload -> 'items', '[]'::jsonb);
  v_item jsonb;
  v_customer_name text := btrim(coalesce(v_payload ->> 'customer_name', ''));
  v_customer_phone text := btrim(coalesce(v_payload ->> 'customer_phone', ''));
  v_customer_email text := nullif(btrim(coalesce(v_payload ->> 'customer_email', '')), '');
  v_fulfillment_type text := lower(btrim(coalesce(v_payload ->> 'fulfillment_type', 'delivery')));
  v_pickup_time text := nullif(btrim(coalesce(v_payload ->> 'pickup_time', v_payload ->> 'preferred_time', '')), '');
  v_customer_notes text := nullif(btrim(coalesce(v_payload ->> 'customer_notes', '')), '');
  v_currency text := upper(btrim(coalesce(v_payload ->> 'currency', 'PHP')));
  v_payment_method text := nullif(btrim(coalesce(v_payload ->> 'payment_method', '')), '');
  v_payment_status text := 'unpaid';
  v_delivery_option text := lower(btrim(coalesce(v_payload ->> 'delivery_option', '')));
  v_delivery_address text := nullif(btrim(coalesce(v_payload ->> 'delivery_address', v_payload ->> 'customer_address', '')), '');
  v_delivery_fee_status text := lower(btrim(coalesce(
    v_payload ->> 'delivery_fee_status',
    case when v_fulfillment_type = 'delivery' then 'to_confirm' else 'not_applicable' end
  )));
  v_delivery_fee numeric(10,2);
  v_subtotal numeric(10,2);
  v_total numeric(10,2);
  v_order_id uuid;
  v_order_number text;
  v_order_number_attempt integer := 0;
  v_item_count integer;
  v_item_index integer := 0;
  v_product_id uuid;
  v_product_size_id uuid;
  v_product_name text;
  v_category_name text;
  v_variant_label text;
  v_quantity integer;
  v_unit_price numeric(10,2);
  v_line_total numeric(10,2);
  v_options jsonb;
  v_item_note text;
  v_sort_order integer;
begin
  if jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'Order payload must be a JSON object.' using errcode = '22023';
  end if;

  if v_customer_name = '' then
    raise exception 'Customer name is required.' using errcode = '22023';
  end if;

  if v_customer_phone = '' then
    raise exception 'Customer phone is required.' using errcode = '22023';
  end if;

  if length(v_customer_name) > 200 then
    raise exception 'Customer name must be 200 characters or fewer.' using errcode = '22023';
  end if;

  if length(v_customer_phone) > 50 then
    raise exception 'Customer phone must be 50 characters or fewer.' using errcode = '22023';
  end if;

  if v_customer_email is not null and length(v_customer_email) > 254 then
    raise exception 'Customer email must be 254 characters or fewer.' using errcode = '22023';
  end if;

  if v_pickup_time is not null and length(v_pickup_time) > 120 then
    raise exception 'Pickup/preferred time must be 120 characters or fewer.' using errcode = '22023';
  end if;

  if v_customer_notes is not null and length(v_customer_notes) > 1000 then
    raise exception 'Customer notes must be 1000 characters or fewer.' using errcode = '22023';
  end if;

  if v_fulfillment_type not in ('delivery', 'pickup') then
    raise exception 'Unsupported fulfillment type. Delivery and pickup are supported.' using errcode = '22023';
  end if;

  if v_fulfillment_type = 'delivery' then
    if v_delivery_option not in ('curv_rider', 'lalamove') then
      raise exception 'Delivery option must be curv_rider or lalamove.' using errcode = '22023';
    end if;

    if v_delivery_address is null then
      raise exception 'Delivery address is required for delivery orders.' using errcode = '22023';
    end if;

    if length(v_delivery_address) > 1000 then
      raise exception 'Delivery address must be 1000 characters or fewer.' using errcode = '22023';
    end if;

    if v_delivery_fee_status <> 'to_confirm' then
      raise exception 'Delivery fee must be manually confirmed by CURV.' using errcode = '22023';
    end if;

    -- Do not trust or store client-submitted delivery fees in D1.
    -- CURV confirms the fee manually through Messenger before accepting.
    v_delivery_fee := null;
  else
    v_delivery_option := null;
    v_delivery_address := null;
    v_delivery_fee := null;
    v_delivery_fee_status := 'not_applicable';
  end if;

  if jsonb_typeof(v_items) is distinct from 'array' then
    raise exception 'Order items must be a JSON array.' using errcode = '22023';
  end if;

  v_item_count := jsonb_array_length(v_items);
  if v_item_count < 1 then
    raise exception 'At least one order item is required.' using errcode = '22023';
  end if;

  if v_item_count > 30 then
    raise exception 'Order item limit exceeded.' using errcode = '22023';
  end if;

  begin
    v_subtotal := coalesce((v_payload ->> 'subtotal')::numeric, 0)::numeric(10,2);
    v_total := coalesce((v_payload ->> 'total')::numeric, v_subtotal)::numeric(10,2);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Order subtotal and total must be valid nonnegative numbers.' using errcode = '22023';
  end;

  if v_subtotal < 0 or v_total < 0 then
    raise exception 'Order subtotal and total must be nonnegative.' using errcode = '22023';
  end if;

  -- For delivery, website submission records the food/drink subtotal first.
  -- Delivery fee and final total are confirmed manually in Messenger later.
  if v_fulfillment_type = 'delivery' then
    v_total := v_subtotal;
  end if;

  if v_currency = '' then
    v_currency := 'PHP';
  end if;

  if v_payment_status not in ('unpaid', 'pending', 'paid', 'refunded') then
    raise exception 'Unsupported payment status.' using errcode = '22023';
  end if;

  -- Server-generated order number. The sequence keeps customer-facing order
  -- numbers compact and avoids relying on random byte functions.
  -- Retry rare collisions from manually inserted/existing order numbers.
  loop
    v_order_number_attempt := v_order_number_attempt + 1;
    v_order_number := 'C-' || nextval('public.order_number_seq');

    begin
      insert into public.orders (
        order_number,
        status,
        customer_name,
        customer_phone,
        customer_email,
        fulfillment_type,
        pickup_time,
        customer_notes,
        subtotal,
        total,
        currency,
        payment_method,
        payment_status,
        source,
        delivery_option,
        delivery_address,
        delivery_fee,
        delivery_fee_status
      ) values (
        v_order_number,
        'submitted',
        v_customer_name,
        v_customer_phone,
        v_customer_email,
        v_fulfillment_type,
        v_pickup_time,
        v_customer_notes,
        v_subtotal,
        v_total,
        v_currency,
        v_payment_method,
        v_payment_status,
        'website',
        v_delivery_option,
        v_delivery_address,
        v_delivery_fee,
        v_delivery_fee_status
      )
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      if v_order_number_attempt >= 5 then
        raise exception 'Unable to generate a unique order number. Please try again.' using errcode = '23505';
      end if;
    end;
  end loop;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    v_item_index := v_item_index + 1;

    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Each order item must be a JSON object.' using errcode = '22023';
    end if;

    v_product_name := btrim(coalesce(v_item ->> 'product_name', v_item ->> 'name', ''));
    if v_product_name = '' then
      raise exception 'Order item product_name is required.' using errcode = '22023';
    end if;

    if length(v_product_name) > 200 then
      raise exception 'Order item product_name must be 200 characters or fewer.' using errcode = '22023';
    end if;

    begin
      v_quantity := coalesce((v_item ->> 'quantity')::integer, 0);
      v_unit_price := coalesce((v_item ->> 'unit_price')::numeric, 0)::numeric(10,2);
      v_line_total := coalesce((v_item ->> 'line_total')::numeric, 0)::numeric(10,2);
      v_sort_order := coalesce((v_item ->> 'sort_order')::integer, v_item_index - 1);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Order item quantity, prices, and sort_order must be valid numbers.' using errcode = '22023';
    end;

    if v_quantity <= 0 then
      raise exception 'Order item quantity must be greater than zero.' using errcode = '22023';
    end if;

    if v_unit_price < 0 or v_line_total < 0 then
      raise exception 'Order item prices must be nonnegative.' using errcode = '22023';
    end if;

    begin
      v_product_id := nullif(btrim(coalesce(v_item ->> 'product_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Order item product_id must be a valid UUID when provided.' using errcode = '22023';
    end;

    begin
      v_product_size_id := nullif(btrim(coalesce(v_item ->> 'product_size_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Order item product_size_id must be a valid UUID when provided.' using errcode = '22023';
    end;

    v_category_name := nullif(btrim(coalesce(v_item ->> 'category_name', '')), '');
    v_variant_label := nullif(btrim(coalesce(v_item ->> 'variant_label', '')), '');
    v_options := coalesce(v_item -> 'options', '{}'::jsonb);
    v_item_note := nullif(btrim(coalesce(v_item ->> 'item_note', '')), '');

    if v_category_name is not null and length(v_category_name) > 120 then
      raise exception 'Order item category_name must be 120 characters or fewer.' using errcode = '22023';
    end if;

    if v_variant_label is not null and length(v_variant_label) > 120 then
      raise exception 'Order item variant_label must be 120 characters or fewer.' using errcode = '22023';
    end if;

    if v_item_note is not null and length(v_item_note) > 500 then
      raise exception 'Order item item_note must be 500 characters or fewer.' using errcode = '22023';
    end if;

    if jsonb_typeof(v_options) is distinct from 'object' then
      raise exception 'Order item options must be a JSON object.' using errcode = '22023';
    end if;

    insert into public.order_items (
      order_id,
      product_id,
      product_size_id,
      product_name,
      category_name,
      variant_label,
      quantity,
      unit_price,
      line_total,
      options,
      item_note,
      sort_order
    ) values (
      v_order_id,
      v_product_id,
      v_product_size_id,
      v_product_name,
      v_category_name,
      v_variant_label,
      v_quantity,
      v_unit_price,
      v_line_total,
      v_options,
      v_item_note,
      v_sort_order
    );
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'submitted',
    'fulfillment_type', v_fulfillment_type,
    'subtotal', v_subtotal,
    'total', v_total,
    'delivery_fee_status', v_delivery_fee_status
  );
end;
$$;

comment on function public.submit_public_order(jsonb) is
  'Controlled guest delivery/pickup order submission RPC. Live anon execute remains revoked until CURV launches public online ordering.';

-- =========================================================
-- Grants And Safety Lock
-- =========================================================
-- Keep raw table access blocked. This file intentionally does not re-grant
-- anon execute while CURV keeps public website submission locked.
revoke all on function public.submit_public_order(jsonb) from public;
revoke execute on function public.submit_public_order(jsonb) from anon;
grant execute on function public.submit_public_order(jsonb) to authenticated;

revoke select, insert, update, delete on public.orders from anon;
revoke select, insert, update, delete on public.order_items from anon;
