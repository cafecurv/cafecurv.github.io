-- Incoming Orders Phase O10A
-- Public Order Submission Idempotency Backend
--
-- Purpose:
-- Add backend idempotency for public website order submission without changing
-- the public RPC signature or response contract.
--
-- Safety:
-- - Review before running in Supabase.
-- - This draft does not run automatically.
-- - Expected RPC response remains exactly:
--   { "order_number": "...", "tracking_token": "..." }

create extension if not exists pgcrypto;

-- =========================================================
-- Schema: nullable idempotency metadata
-- =========================================================

alter table public.orders
  add column if not exists public_submission_key uuid;

alter table public.orders
  add column if not exists public_submission_fingerprint text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_public_submission_pair_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_public_submission_pair_check
      check (
        (public_submission_key is null and public_submission_fingerprint is null)
        or
        (public_submission_key is not null and public_submission_fingerprint is not null)
      );
  end if;
end;
$$;

create unique index if not exists orders_public_submission_key_idx
  on public.orders (public_submission_key)
  where public_submission_key is not null;

comment on column public.orders.public_submission_key is
  'Optional customer-browser submission key used by submit_public_order for idempotent public order creation.';

comment on column public.orders.public_submission_fingerprint is
  'Server-calculated fingerprint of the public order payload, excluding submission_key, used to detect key reuse with different order details.';

-- =========================================================
-- RPC: preserve O8A contract, add request-key idempotency
-- =========================================================

create or replace function public.submit_public_order(order_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb := coalesce(order_payload, '{}'::jsonb);
  v_items jsonb := coalesce(v_payload -> 'items', '[]'::jsonb);
  v_validated_items jsonb := '[]'::jsonb;
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
  v_public_submission_key uuid;
  v_submission_fingerprint text;
  v_existing_order_number text;
  v_existing_tracking_token uuid;
  v_existing_fingerprint text;
  v_constraint_name text;
begin
  if jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'Order payload must be a JSON object.' using errcode = '22023';
  end if;

  begin
    v_public_submission_key := nullif(btrim(coalesce(v_payload ->> 'submission_key', '')), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'submission_key must be a valid UUID when provided.' using errcode = '22023';
  end;

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

    v_validated_items := v_validated_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'product_size_id', v_product_size_id,
      'product_name', v_product_name,
      'category_name', v_category_name,
      'variant_label', v_variant_label,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'line_total', v_line_total,
      'options', v_options,
      'item_note', v_item_note,
      'sort_order', v_sort_order
    ));
  end loop;

  if v_public_submission_key is not null then
    v_submission_fingerprint := encode(
      extensions.digest(
        (v_payload - 'submission_key')::text,
        'sha256'
      ),
      'hex'
    );

    select
      o.order_number,
      o.tracking_token,
      o.public_submission_fingerprint
    into
      v_existing_order_number,
      v_existing_tracking_token,
      v_existing_fingerprint
    from public.orders o
    where o.public_submission_key = v_public_submission_key
    limit 1;

    if found then
      if v_existing_fingerprint is distinct from v_submission_fingerprint then
        raise exception 'This submission key has already been used for a different order.'
          using errcode = 'P0001',
                detail = 'INV_SUBMISSION_KEY_CONFLICT',
                hint = 'Generate a new submission key for a new order.';
      end if;

      return jsonb_build_object(
        'order_number', v_existing_order_number,
        'tracking_token', v_existing_tracking_token
      );
    end if;
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
        delivery_fee_status,
        public_submission_key,
        public_submission_fingerprint
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
        v_delivery_fee_status,
        v_public_submission_key,
        v_submission_fingerprint
      )
      returning id, tracking_token into v_order_id, v_tracking_token;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_public_submission_key is not null and v_constraint_name = 'orders_public_submission_key_idx' then
        select
          o.order_number,
          o.tracking_token,
          o.public_submission_fingerprint
        into
          v_existing_order_number,
          v_existing_tracking_token,
          v_existing_fingerprint
        from public.orders o
        where o.public_submission_key = v_public_submission_key
        limit 1;

        if found then
          if v_existing_fingerprint is distinct from v_submission_fingerprint then
            raise exception 'This submission key has already been used for a different order.'
              using errcode = 'P0001',
                    detail = 'INV_SUBMISSION_KEY_CONFLICT',
                    hint = 'Generate a new submission key for a new order.';
          end if;

          return jsonb_build_object(
            'order_number', v_existing_order_number,
            'tracking_token', v_existing_tracking_token
          );
        end if;

        raise exception 'Submission key is already being processed. Please try again.' using errcode = '23505';
      end if;

      if v_order_number_attempt >= 5 then
        raise exception 'Unable to generate a unique order number. Please try again.' using errcode = '23505';
      end if;
    end;
  end loop;

  for v_item in select value from jsonb_array_elements(v_validated_items)
  loop
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_product_size_id := nullif(v_item ->> 'product_size_id', '')::uuid;
    v_product_name := v_item ->> 'product_name';
    v_category_name := nullif(v_item ->> 'category_name', '');
    v_variant_label := nullif(v_item ->> 'variant_label', '');
    v_quantity := (v_item ->> 'quantity')::integer;
    v_unit_price := (v_item ->> 'unit_price')::numeric(10,2);
    v_line_total := (v_item ->> 'line_total')::numeric(10,2);
    v_options := coalesce(v_item -> 'options', '{}'::jsonb);
    v_item_note := nullif(v_item ->> 'item_note', '');
    v_sort_order := (v_item ->> 'sort_order')::integer;

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
    'order_number', v_order_number,
    'tracking_token', v_tracking_token
  );
end;
$$;

comment on function public.submit_public_order(jsonb) is
  'Controlled guest delivery/pickup order submission RPC. Returns only customer-facing order_number and private tracking_token. Supports optional submission_key idempotency.';

-- Keep public access narrow: customers can execute the RPC, but cannot access
-- raw rows in orders/order_items.
revoke all on function public.submit_public_order(jsonb) from public;
grant execute on function public.submit_public_order(jsonb) to anon;
grant execute on function public.submit_public_order(jsonb) to authenticated;

revoke all privileges on table public.orders from anon;
revoke all privileges on table public.order_items from anon;

-- =========================================================
-- Manual Concurrency Test Notes
-- =========================================================
-- Do not run this casually against production. Use only if Isaiah approves a
-- controlled, rollback-safe concurrency check.
--
-- Session A:
--   begin;
--   select public.submit_public_order('<payload with submission_key K>'::jsonb);
--   -- Function returns. Do not commit yet; keep this transaction open.
--
-- Session B:
--   select public.submit_public_order('<same payload with same submission_key K>'::jsonb);
--   -- Session B should block on orders_public_submission_key_idx until
--   -- Session A commits or rolls back.
--
-- Then Session A:
--   commit;
--
-- Expected Session B result:
--   It resumes and returns the same order_number and tracking_token.
--   Verify one order and one set of order_items for K.
--
-- Rollback variant:
--   If Session A rolls back instead of committing, Session B should proceed
--   and create the order itself.

-- =========================================================
-- Rollback Draft
-- =========================================================
-- If O10A causes issues, restore the previous O8A function body from:
-- admin/INCOMING_ORDERS_PHASE_O8A_RETURN_TRACKING_TOKEN.sql
--
-- The nullable metadata columns should remain in place to preserve any values
-- already stored by approved O10A submissions.
--
-- If idempotency must be disabled after restoring the O8A function:
--
-- drop index if exists public.orders_public_submission_key_idx;
--
-- alter table public.orders
--   drop constraint if exists orders_public_submission_pair_check;
--
-- Do not drop populated public_submission_key or
-- public_submission_fingerprint columns unless a separately reviewed data
-- migration explicitly approves that destructive cleanup.
