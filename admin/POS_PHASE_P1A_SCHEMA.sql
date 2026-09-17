-- CURV POS P1A. LOCAL DRAFT: owner review and manual execution only.
-- Prerequisites: Menu/Options/Archive, Incoming Orders through O14, Timekeeping T4A.
-- Apply before POS_PHASE_P1A_BACKEND.sql. Never apply the permissive local auth stub.
begin;

-- Read-only pre-flight BEFORE any schema changes. Keep writers out until COMMIT
-- so rows cannot change between inspection and constraint installation.
lock table public.orders, public.order_items in access exclusive mode;
do $$
declare v_count bigint;
begin
  select count(*) into v_count from public.orders where (
    (source = 'pos' and status in ('open','held')) or
    (source <> 'pos' and status in ('submitted','accepted','preparing','ready','completed','cancelled'))
  ) is false;
  if v_count > 0 then
    raise exception 'P1A pre-flight: % existing orders violate orders_status_check. No historical rows were changed.', v_count
      using errcode='P0001', detail='POS_PREFLIGHT_ORDER_STATUS';
  end if;

  -- JSON lookup treats not-yet-added POS columns as NULL on first installation;
  -- on reapplication it inspects their saved values. Match CHECK's IS FALSE
  -- semantics (SQL CHECK permits UNKNOWN), without filling or repairing rows.
  select count(*) into v_count from public.orders o where (
    case when source = 'pos' then
      (to_jsonb(o)->>'pos_revision')::bigint is not null
      and (to_jsonb(o)->>'pos_revision')::bigint >= 1
      and to_jsonb(o)->>'pos_created_by' is not null
      and to_jsonb(o)->>'pos_updated_by' is not null
      and tracking_token is null and payment_status = 'unpaid' and payment_method is null
      and currency = 'PHP' and subtotal = total
      and completed_at is null and cancelled_at is null
      and ((status = 'held') = (to_jsonb(o)->>'pos_held_at' is not null))
    else tracking_token is not null and to_jsonb(o)->>'pos_revision' is null end
  ) is false;
  if v_count > 0 then
    raise exception 'P1A pre-flight: % existing orders violate orders_pos_boundary_check. No historical rows were changed.', v_count
      using errcode='P0001', detail='POS_PREFLIGHT_ORDER_BOUNDARY';
  end if;

  select count(*) into v_count from public.orders where (
    (source = 'pos' and delivery_option is null and delivery_address is null
      and delivery_fee is null and delivery_fee_status = 'not_applicable')
    or (source <> 'pos' and (
      (fulfillment_type = 'delivery' and delivery_option in ('curv_rider','lalamove')
        and nullif(btrim(coalesce(delivery_address,'')), '') is not null
        and delivery_fee_status in ('to_confirm','confirmed','waived'))
      or (fulfillment_type in ('pickup','dine_in') and delivery_option is null
        and delivery_address is null and delivery_fee is null and delivery_fee_status = 'not_applicable')
    ))
  ) is false;
  if v_count > 0 then
    raise exception 'P1A pre-flight: % existing orders violate orders_delivery_state_check. No historical rows were changed.', v_count
      using errcode='P0001', detail='POS_PREFLIGHT_ORDER_DELIVERY';
  end if;

  select count(*) into v_count from (
    select i.unit_price, i.line_total, i.quantity,
      (to_jsonb(i)->>'pos_base_price')::numeric as base_price,
      (to_jsonb(i)->>'pos_option_total')::numeric as option_total
    from public.order_items i
  ) saved where (
    (base_price is null and option_total is null)
    or (base_price is not null and option_total is not null
      and base_price >= 0 and option_total >= 0
      and unit_price = base_price + option_total and line_total = unit_price * quantity)
  ) is false;
  if v_count > 0 then
    raise exception 'P1A pre-flight: % existing order items violate order_items_pos_price_check. No historical rows were changed.', v_count
      using errcode='P0001', detail='POS_PREFLIGHT_ITEM_PRICE';
  end if;
end $$;

create schema if not exists pos_private;
revoke all on schema pos_private from public, anon, authenticated;

-- Provision manually after creating a normal Supabase Auth account. No PIN or
-- password is stored here. This is an access mapping, not an employee directory.
create table if not exists public.pos_staff_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  staff_id uuid not null unique references public.staff(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict
);
alter table public.pos_staff_access enable row level security;
revoke all on public.pos_staff_access from public, anon, authenticated;

alter table public.orders
  add column if not exists pos_revision bigint,
  add column if not exists pos_created_by uuid references auth.users(id) on delete restrict,
  add column if not exists pos_updated_by uuid references auth.users(id) on delete restrict,
  add column if not exists pos_created_staff_id uuid references public.staff(id) on delete restrict,
  add column if not exists pos_updated_staff_id uuid references public.staff(id) on delete restrict,
  add column if not exists pos_held_at timestamptz;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  (source = 'pos' and status in ('open', 'held')) or
  (source <> 'pos' and status in ('submitted','accepted','preparing','ready','completed','cancelled'))
);
-- No public tracking token for a counter order. Existing website tokens unchanged.
alter table public.orders alter column tracking_token drop not null;
alter table public.orders drop constraint if exists orders_pos_boundary_check;
alter table public.orders add constraint orders_pos_boundary_check check (
  case when source = 'pos' then
    pos_revision is not null and pos_revision >= 1
    and pos_created_by is not null and pos_updated_by is not null
    and tracking_token is null and payment_status = 'unpaid' and payment_method is null
    and currency = 'PHP' and subtotal = total
    and completed_at is null and cancelled_at is null
    and ((status = 'held') = (pos_held_at is not null))
  else tracking_token is not null and pos_revision is null end
);
-- Preserve website delivery requirements. P1A counter delivery records the order
-- type only; address/rider/fee workflow is deliberately not part of this phase.
alter table public.orders drop constraint if exists orders_delivery_state_check;
alter table public.orders add constraint orders_delivery_state_check check (
  (source = 'pos' and delivery_option is null and delivery_address is null
    and delivery_fee is null and delivery_fee_status = 'not_applicable')
  or (source <> 'pos' and (
    (fulfillment_type = 'delivery' and delivery_option in ('curv_rider','lalamove')
      and nullif(btrim(coalesce(delivery_address,'')), '') is not null
      and delivery_fee_status in ('to_confirm','confirmed','waived'))
    or (fulfillment_type in ('pickup','dine_in') and delivery_option is null
      and delivery_address is null and delivery_fee is null and delivery_fee_status = 'not_applicable')
  ))
);
create index if not exists orders_pos_open_idx on public.orders(updated_at desc, id)
  where source = 'pos' and status in ('open','held');

alter table public.order_items
  add column if not exists pos_base_price numeric(10,2),
  add column if not exists pos_option_total numeric(10,2),
  add column if not exists pos_removed_at timestamptz;
alter table public.order_items drop constraint if exists order_items_pos_price_check;
alter table public.order_items add constraint order_items_pos_price_check check (
  (pos_base_price is null and pos_option_total is null)
  or (pos_base_price is not null and pos_option_total is not null
    and pos_base_price >= 0 and pos_option_total >= 0
    and unit_price = pos_base_price + pos_option_total and line_total = unit_price * quantity)
);

-- RESTRICTIVE policies also constrain pre-existing permissive owner policies.
-- All POS reads/writes go through scoped RPCs. Incoming Orders sees only its
-- existing non-POS rows, including search, badges, direct status/payment updates.
drop policy if exists pos_orders_api_boundary on public.orders;
create policy pos_orders_api_boundary on public.orders as restrictive for all
  to anon, authenticated using (source <> 'pos') with check (source <> 'pos');
drop policy if exists pos_items_api_boundary on public.order_items;
create policy pos_items_api_boundary on public.order_items as restrictive for all
  to anon, authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.source <> 'pos'))
  with check (exists (select 1 from public.orders o where o.id = order_id and o.source <> 'pos'));

-- Key ownership and result are durable. No direct browser access or short TTL.
create table if not exists pos_private.commands (
  command_key uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  staff_id uuid references public.staff(id) on delete restrict,
  operation text not null,
  fingerprint text not null,
  order_id uuid references public.orders(id) on delete restrict,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table pos_private.commands enable row level security;
revoke all on pos_private.commands from public, anon, authenticated;
comment on table pos_private.commands is
  'P1A committed command results and actor audit. Insert/finalize in one transaction; retries never repeat a mutation.';
commit;
