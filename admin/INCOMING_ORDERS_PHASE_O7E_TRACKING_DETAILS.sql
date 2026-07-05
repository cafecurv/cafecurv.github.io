-- Incoming Orders Phase O7E Tracking Details SQL Draft
--
-- Purpose:
-- Replace the public-safe customer tracking RPC so track.html can show
-- customer-safe order details and item snapshots without exposing raw table
-- access or private customer contact fields.
--
-- This draft is SQL only:
-- - No menu.html changes.
-- - No admin UI changes.
-- - No submit_public_order changes.
-- - No table schema changes.
-- - No POS/inventory deduction.
--
-- Privacy model:
-- - Tracking access remains private-token based.
-- - Delivery address is returned only for delivery orders because the tracking
--   link is private and unguessable.
-- - Customer name, phone, email, notes, admin notes, raw order id, order item
--   ids, product_id, product_size_id, and item_note are not returned.

-- Existing function returns a table. PostgreSQL requires dropping the function
-- before changing its returned columns.
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
  'Public-safe read-only customer order tracking snapshot by private tracking token. Includes delivery address only for delivery orders and safe order item snapshots only.';

-- Keep public customer tracking RPC-only. Do not grant raw table access.
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
-- -- Test RPC with one existing token:
-- select *
-- from public.get_public_order_tracking(
--   (select tracking_token from public.orders order by created_at desc limit 1)
-- );
--
-- -- Confirm delivery address is null for pickup tracking responses:
-- select fulfillment_type, delivery_address
-- from public.get_public_order_tracking(
--   (select tracking_token from public.orders where fulfillment_type = 'pickup' order by created_at desc limit 1)
-- );
--
-- -- Confirm item snapshots do not include private/internal ids:
-- select items
-- from public.get_public_order_tracking(
--   (select tracking_token from public.orders order by created_at desc limit 1)
-- );

-- =========================================================
-- Rollback Notes
-- =========================================================
-- Re-run the O7B tracking RPC draft to restore the previous RPC shape.
