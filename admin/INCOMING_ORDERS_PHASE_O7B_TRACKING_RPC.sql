-- Incoming Orders Phase O7B Customer Tracking SQL Draft
--
-- Purpose:
-- Add a private customer order tracking token and a narrow public-safe tracking
-- RPC without exposing raw orders table access.
--
-- This draft is SQL only:
-- - No menu.html changes.
-- - No admin UI changes.
-- - No track.html page yet.
-- - No POS/inventory deduction.
-- - No customer accounts or order history.
--
-- Security model:
-- - tracking_token is a private UUID on public.orders.
-- - Customers may read a limited tracking snapshot only through
--   public.get_public_order_tracking(p_tracking_token uuid).
-- - Anonymous users must not receive raw select access on public.orders or
--   public.order_items.

-- =========================================================
-- Tracking Token Column
-- =========================================================

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists tracking_token uuid;

alter table public.orders
  alter column tracking_token set default gen_random_uuid();

update public.orders
set tracking_token = gen_random_uuid()
where tracking_token is null;

alter table public.orders
  alter column tracking_token set not null;

create unique index if not exists orders_tracking_token_idx
  on public.orders (tracking_token);

comment on column public.orders.tracking_token is
  'Private customer tracking token. Use only through public-safe tracking RPCs; do not expose raw orders rows.';

-- =========================================================
-- Delivery-First Public Guest Order Submission RPC
-- =========================================================
-- This replaces the current delivery-first submit RPC only to include
-- tracking_token in the confirmation payload. It preserves D1 behavior:
-- - delivery and pickup only
-- - delivery fee/final total confirmed manually
-- - payment_status forced to unpaid
-- - order item snapshots inserted with the order
--
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
  v_tracking_token uuid;
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

    -- Do not trust or store client-submitted delivery fees.
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
      returning id, tracking_token into v_order_id, v_tracking_token;
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
    'delivery_fee_status', v_delivery_fee_status,
    'tracking_token', v_tracking_token
  );
end;
$$;

comment on function public.submit_public_order(jsonb) is
  'Controlled guest delivery/pickup order submission RPC. Returns a private tracking token for customer tracking links.';

-- =========================================================
-- Public-Safe Tracking RPC
-- =========================================================
-- Customers can poll this RPC with their private tracking token. It returns a
-- small status snapshot only. It intentionally excludes customer contact info,
-- address, notes, admin notes, order id, and item/internal ids.

create or replace function public.get_public_order_tracking(p_tracking_token uuid)
returns table (
  order_number text,
  status text,
  fulfillment_type text,
  delivery_option text,
  subtotal numeric(10,2),
  total numeric(10,2),
  currency text,
  delivery_fee_status text,
  delivery_fee numeric(10,2),
  payment_status text,
  created_at timestamptz,
  updated_at timestamptz,
  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.order_number,
    o.status,
    o.fulfillment_type,
    o.delivery_option,
    o.subtotal,
    o.total,
    o.currency,
    o.delivery_fee_status,
    case
      when o.delivery_fee_status in ('confirmed', 'waived') then o.delivery_fee
      else null
    end as delivery_fee,
    o.payment_status,
    o.created_at,
    o.updated_at,
    o.accepted_at,
    o.preparing_at,
    o.ready_at,
    o.completed_at,
    o.cancelled_at
  from public.orders o
  where o.tracking_token = p_tracking_token
  limit 1;
$$;

comment on function public.get_public_order_tracking(uuid) is
  'Public-safe read-only customer order tracking snapshot by private tracking token. Does not expose contact details, address, notes, admin fields, raw ids, or order items.';

-- =========================================================
-- Grants
-- =========================================================
-- Keep raw table access blocked. Public customer tracking is RPC-only.
-- This draft does not change submit_public_order execute grants.

revoke all on function public.get_public_order_tracking(uuid) from public;
grant execute on function public.get_public_order_tracking(uuid) to anon;
grant execute on function public.get_public_order_tracking(uuid) to authenticated;

revoke select, insert, update, delete on public.orders from anon;
revoke select, insert, update, delete on public.order_items from anon;

-- =========================================================
-- Optional Verification Queries
-- =========================================================
-- Run manually after applying this SQL in Supabase.
--
-- -- Check tracking_token column exists:
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'orders'
--   and column_name = 'tracking_token';
--
-- -- Check tokens are not null:
-- select count(*) as orders_missing_tracking_token
-- from public.orders
-- where tracking_token is null;
--
-- -- Check unique index exists:
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename = 'orders'
--   and indexname = 'orders_tracking_token_idx';
--
-- -- Test RPC with one existing token:
-- select *
-- from public.get_public_order_tracking(
--   (select tracking_token from public.orders order by created_at desc limit 1)
-- );

-- =========================================================
-- Rollback Notes
-- =========================================================
-- WARNING: Rolling back after track.html is deployed will break customer
-- tracking links.
--
-- drop function if exists public.get_public_order_tracking(uuid);
-- drop index if exists public.orders_tracking_token_idx;
-- alter table public.orders drop column if exists tracking_token;
