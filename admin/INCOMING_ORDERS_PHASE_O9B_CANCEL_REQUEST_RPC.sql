-- Incoming Orders Phase O9B Customer Cancellation Request SQL Draft
--
-- Purpose:
-- Add a safe customer cancellation request path for private tracking links.
-- This is NOT instant cancellation. Customer requests do not update
-- orders.status. CURV staff remains the final authority through the existing
-- Incoming Orders admin Cancel action.
--
-- This draft is SQL only:
-- - No track.html changes.
-- - No admin UI changes.
-- - No menu.html changes.
-- - No submit_public_order changes.
-- - No POS/inventory deduction.
-- - No raw anonymous table access.

-- =========================================================
-- Customer Cancellation Request Fields
-- =========================================================

alter table public.orders
  add column if not exists customer_cancel_requested_at timestamptz null,
  add column if not exists customer_cancel_reason text null,
  add column if not exists customer_cancel_status text not null default 'none';

comment on column public.orders.customer_cancel_requested_at is
  'Timestamp when the customer requested cancellation from the private tracking page. This does not mean the order is cancelled.';

comment on column public.orders.customer_cancel_reason is
  'Optional customer-provided cancellation request reason. Admin-only; not returned by public tracking RPC.';

comment on column public.orders.customer_cancel_status is
  'Customer cancellation request workflow state. Staff-side order status remains the final authority.';

alter table public.orders
  drop constraint if exists orders_customer_cancel_status_check;

alter table public.orders
  add constraint orders_customer_cancel_status_check
  check (customer_cancel_status in ('none', 'requested', 'approved', 'declined'));

create index if not exists orders_customer_cancel_requested_idx
  on public.orders (customer_cancel_status, customer_cancel_requested_at desc);

-- =========================================================
-- Public-Safe Tracking RPC
-- =========================================================
-- Existing function returns a table. PostgreSQL requires dropping the function
-- before changing its returned columns.
--
-- This preserves the O7E public-safe tracking shape and adds only:
-- - customer_cancel_status
-- - customer_cancel_requested_at
--
-- It intentionally does not return:
-- - customer_cancel_reason
-- - cancel_reason
-- - raw order id
-- - customer name, phone, email, notes, or admin notes
-- - order_items.id/order_id/product_id/product_size_id/item_note

drop function if exists public.get_public_order_tracking(uuid);

create function public.get_public_order_tracking(p_tracking_token uuid)
returns table (
  order_number text,
  status text,
  fulfillment_type text,
  delivery_option text,
  delivery_address text,
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
  cancelled_at timestamptz,
  customer_cancel_status text,
  customer_cancel_requested_at timestamptz,
  items jsonb
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
    case
      when o.fulfillment_type = 'delivery' then o.delivery_address
      else null
    end as delivery_address,
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
    o.cancelled_at,
    o.customer_cancel_status,
    o.customer_cancel_requested_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'product_name', oi.product_name,
            'category_name', oi.category_name,
            'variant_label', oi.variant_label,
            'quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'line_total', oi.line_total,
            'options', oi.options,
            'sort_order', oi.sort_order
          )
          order by oi.sort_order asc, oi.created_at asc
        )
        from public.order_items oi
        where oi.order_id = o.id
      ),
      '[]'::jsonb
    ) as items
  from public.orders o
  where o.tracking_token = p_tracking_token
  limit 1;
$$;

comment on function public.get_public_order_tracking(uuid) is
  'Public-safe read-only customer order tracking snapshot by private tracking token. Includes customer cancellation request status but not the request reason.';

-- =========================================================
-- Public Cancellation Request RPC
-- =========================================================

drop function if exists public.request_public_order_cancellation(uuid, text);

create function public.request_public_order_cancellation(
  p_tracking_token uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_already_requested boolean := false;
begin
  if v_reason is not null and char_length(v_reason) > 500 then
    return jsonb_build_object(
      'ok', false,
      'status', 'invalid_reason',
      'message', 'Please keep your cancellation reason under 500 characters.'
    );
  end if;

  select
    o.id,
    o.status,
    o.customer_cancel_status,
    o.customer_cancel_requested_at,
    o.customer_cancel_reason
  into v_order
  from public.orders o
  where o.tracking_token = p_tracking_token
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'status', 'not_found',
      'message', 'Tracking link not found.'
    );
  end if;

  if v_order.status not in ('submitted', 'new', 'accepted') then
    return jsonb_build_object(
      'ok', false,
      'status', 'blocked',
      'message', 'This order is already being prepared. Please message CURV directly for urgent concerns.'
    );
  end if;

  v_already_requested := v_order.customer_cancel_status = 'requested';

  update public.orders
  set
    customer_cancel_requested_at = coalesce(customer_cancel_requested_at, now()),
    customer_cancel_status = 'requested',
    customer_cancel_reason = case
      when v_reason is not null then v_reason
      else customer_cancel_reason
    end
  where id = v_order.id;

  if v_already_requested then
    return jsonb_build_object(
      'ok', true,
      'status', 'requested',
      'message', 'Cancellation request was already sent. Please wait for CURV to confirm.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'requested',
    'message', 'Cancellation request sent. Please wait for CURV to confirm.'
  );
end;
$$;

comment on function public.request_public_order_cancellation(uuid, text) is
  'Records a customer cancellation request by private tracking token. Does not change order status; staff remains the final authority.';

-- =========================================================
-- Grants / Public Access Guardrails
-- =========================================================

revoke all on function public.get_public_order_tracking(uuid) from public;
grant execute on function public.get_public_order_tracking(uuid) to anon;
grant execute on function public.get_public_order_tracking(uuid) to authenticated;

revoke all on function public.request_public_order_cancellation(uuid, text) from public;
grant execute on function public.request_public_order_cancellation(uuid, text) to anon;
grant execute on function public.request_public_order_cancellation(uuid, text) to authenticated;

revoke select, insert, update, delete on public.orders from anon;
revoke select, insert, update, delete on public.order_items from anon;

-- =========================================================
-- Optional Verification Queries
-- =========================================================
-- Run manually after applying this SQL in Supabase.
--
-- -- Check customer cancellation request columns exist:
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'orders'
--   and column_name in (
--     'customer_cancel_requested_at',
--     'customer_cancel_reason',
--     'customer_cancel_status'
--   )
-- order by column_name;
--
-- -- Check tracking RPC includes customer cancellation request status:
-- select order_number, status, customer_cancel_status, customer_cancel_requested_at
-- from public.get_public_order_tracking(
--   (select tracking_token from public.orders order by created_at desc limit 1)
-- );
--
-- -- Test request RPC with one valid submitted/accepted token:
-- select public.request_public_order_cancellation(
--   (select tracking_token
--    from public.orders
--    where status in ('submitted', 'accepted')
--    order by created_at desc
--    limit 1),
--   'Customer requested cancellation from tracking page.'
-- );
--
-- -- Confirm order status did not change after request:
-- select order_number, status, customer_cancel_status, customer_cancel_requested_at
-- from public.orders
-- where customer_cancel_status = 'requested'
-- order by customer_cancel_requested_at desc
-- limit 5;
--
-- -- Test blocked request with preparing/ready/completed/cancelled token if available:
-- select public.request_public_order_cancellation(
--   (select tracking_token
--    from public.orders
--    where status in ('preparing', 'ready', 'completed', 'cancelled')
--    order by created_at desc
--    limit 1),
--   null
-- );
--
-- -- Confirm raw anon table access remains revoked:
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('orders', 'order_items')
--   and grantee = 'anon';

-- =========================================================
-- Rollback Notes
-- =========================================================
-- Rollback may break track.html cancellation UI once deployed.
--
-- drop function if exists public.request_public_order_cancellation(uuid, text);
-- -- Restore the previous get_public_order_tracking(uuid) shape from:
-- -- admin/INCOMING_ORDERS_PHASE_O7E_TRACKING_DETAILS.sql
-- drop index if exists public.orders_customer_cancel_requested_idx;
-- alter table public.orders drop constraint if exists orders_customer_cancel_status_check;
-- alter table public.orders drop column if exists customer_cancel_requested_at;
-- alter table public.orders drop column if exists customer_cancel_reason;
-- alter table public.orders drop column if exists customer_cancel_status;
