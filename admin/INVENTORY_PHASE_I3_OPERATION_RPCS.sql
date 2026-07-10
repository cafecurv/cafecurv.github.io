-- CURV Control Inventory Management
-- Phase I3 Controlled Stock Operations SQL Draft
--
-- Draft SQL only. Review before running manually in Supabase SQL Editor.
--
-- Purpose:
-- Add owner/admin-only SECURITY DEFINER RPCs for controlled stock mutations.
-- These functions are the validation and security gatekeepers. Direct browser
-- table mutations remain unavailable; the RPCs write behind RLS only after
-- auth.uid() and public.is_admin() checks pass.
--
-- This phase does not add recipes, POS/Loyverse integration, public inventory
-- access, automatic order deduction, or a reversal RPC.

create extension if not exists pgcrypto;

-- =========================================================
-- Batch Reference Uniqueness
-- =========================================================
-- Batch references are unique per item, case-insensitively. RPCs do not upsert
-- or overwrite existing batches.

create unique index if not exists inventory_batches_item_batch_ref_ci_unique_idx
  on public.inventory_batches (item_id, lower(btrim(batch_ref)));

-- =========================================================
-- Stock Summary View Correction
-- =========================================================
-- current_stock = all remaining recorded stock, including expired stock.
-- usable_stock = stock available for service: no expiry or expiry today/future.
-- expired_stock = remaining stock with a past expiry date; review and record as
-- waste instead of using it for service.

create or replace view public.inventory_stock_summary
with (security_invoker = true)
as
select
  i.id as item_id,
  i.name as item_name,
  c.id as category_id,
  c.name as category_name,
  u.id as unit_id,
  u.name as unit_name,
  u.abbreviation as unit_abbreviation,
  i.low_stock_threshold,
  coalesce(sum(b.quantity_remaining), 0)::numeric(14,3) as current_stock,
  (
    coalesce(sum(b.quantity_remaining) filter (
      where b.quantity_remaining > 0
        and (b.expiry_date is null or b.expiry_date >= current_date)
    ), 0) <= i.low_stock_threshold
  ) as is_low_stock,
  min(b.expiry_date) filter (
    where b.quantity_remaining > 0
      and b.expiry_date is not null
      and b.expiry_date >= current_date
  ) as nearest_non_expired_expiry_date,
  i.track_expiry,
  i.storage_location,
  i.is_active,
  coalesce(sum(b.quantity_remaining) filter (
    where b.quantity_remaining > 0
      and (b.expiry_date is null or b.expiry_date >= current_date)
  ), 0)::numeric(14,3) as usable_stock,
  coalesce(sum(b.quantity_remaining) filter (
    where b.quantity_remaining > 0
      and b.expiry_date < current_date
  ), 0)::numeric(14,3) as expired_stock
from public.inventory_items i
join public.inventory_categories c on c.id = i.category_id
join public.inventory_units u on u.id = i.unit_id
left join public.inventory_batches b on b.item_id = i.id
where i.is_active = true
group by
  i.id,
  i.name,
  c.id,
  c.name,
  u.id,
  u.name,
  u.abbreviation,
  i.low_stock_threshold,
  i.track_expiry,
  i.storage_location,
  i.is_active;

comment on view public.inventory_stock_summary is
  'Owner/admin stock report. current_stock includes all remaining recorded stock; usable_stock excludes expired stock; expired_stock must be reviewed and recorded as waste.';

create or replace view public.inventory_low_stock
with (security_invoker = true)
as
select
  item_id,
  item_name,
  category_id,
  category_name,
  unit_id,
  unit_name,
  unit_abbreviation,
  low_stock_threshold,
  current_stock,
  is_low_stock,
  nearest_non_expired_expiry_date,
  track_expiry,
  storage_location,
  is_active,
  usable_stock,
  expired_stock
from public.inventory_stock_summary
where is_active = true
  and usable_stock <= low_stock_threshold;

revoke all on public.inventory_stock_summary from anon, authenticated;
revoke all on public.inventory_low_stock from anon, authenticated;
grant select on public.inventory_stock_summary to authenticated;
grant select on public.inventory_low_stock to authenticated;

-- =========================================================
-- inventory_opening_balance
-- =========================================================
-- Enters existing stock when CURV begins using inventory.

drop function if exists public.inventory_opening_balance(uuid, numeric, date, numeric, text, text);

create function public.inventory_opening_balance(
  p_item_id uuid,
  p_quantity numeric,
  p_expiry_date date default null,
  p_cost_per_unit numeric default null,
  p_batch_ref text default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.inventory_items%rowtype;
  v_batch_id uuid;
  v_batch_ref text;
  v_movement_group_id uuid := gen_random_uuid();
  v_total_stock numeric(14,3);
  v_usable_stock numeric(14,3);
  v_opening_exists boolean := false;
  v_warnings jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'Please sign in before changing inventory.'
      using errcode = 'P0001', detail = 'INV_AUTH_REQUIRED', hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can change inventory.'
      using errcode = 'P0001', detail = 'INV_ADMIN_REQUIRED', hint = 'Use an approved owner account.';
  end if;

  select *
  into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'Inventory item was not found.'
      using errcode = 'P0001', detail = 'INV_ITEM_NOT_FOUND', hint = 'Refresh inventory and choose an existing item.';
  end if;

  if not v_item.is_active then
    raise exception 'This inventory item is archived.'
      using errcode = 'P0001', detail = 'INV_ITEM_INACTIVE', hint = 'Reactivate the item before changing stock.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.'
      using errcode = 'P0001', detail = 'INV_INVALID_QUANTITY', hint = 'Enter a positive quantity.';
  end if;

  if p_cost_per_unit is not null and p_cost_per_unit < 0 then
    raise exception 'Cost per unit cannot be negative.'
      using errcode = 'P0001', detail = 'INV_INVALID_QUANTITY', hint = 'Enter zero, a positive cost, or leave cost blank.';
  end if;

  if v_item.track_expiry and p_expiry_date is null then
    raise exception 'Expiry date is required for this item.'
      using errcode = 'P0001', detail = 'INV_EXPIRY_REQUIRED', hint = 'Enter an expiry date for this stock.';
  end if;

  if p_expiry_date is not null and p_expiry_date < current_date then
    raise exception 'New usable stock cannot have a past expiry date.'
      using errcode = 'P0001', detail = 'INV_EXPIRY_IN_PAST', hint = 'Use today or a future expiry date.';
  end if;

  if p_batch_ref is not null and length(btrim(p_batch_ref)) = 0 then
    raise exception 'Batch reference cannot be blank.'
      using errcode = 'P0001', detail = 'INV_INVALID_BATCH_REF', hint = 'Enter a batch reference or leave it blank to generate one.';
  end if;

  v_batch_ref := coalesce(
    nullif(btrim(p_batch_ref), ''),
    'OPEN-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  );

  if exists (
    select 1
    from public.inventory_batches b
    where b.item_id = p_item_id
      and lower(btrim(b.batch_ref)) = lower(btrim(v_batch_ref))
  ) then
    raise exception 'That batch reference already exists for this item.'
      using errcode = 'P0001', detail = 'INV_DUPLICATE_BATCH_REF', hint = 'Use a different batch reference.';
  end if;

  select exists (
    select 1
    from public.inventory_movements m
    where m.item_id = p_item_id
      and m.movement_type = 'opening_balance'
  ) into v_opening_exists;

  if v_opening_exists then
    v_warnings := v_warnings || jsonb_build_array('This item already has an opening balance. An additional opening batch was created.');
  end if;

  insert into public.inventory_batches (
    item_id, batch_ref, batch_origin, received_date, expiry_date,
    quantity_received, quantity_remaining, cost_per_unit, notes, created_by
  )
  values (
    p_item_id, v_batch_ref, 'opening_balance', current_date, p_expiry_date,
    p_quantity, p_quantity, p_cost_per_unit, p_notes, v_actor
  )
  returning id into v_batch_id;

  insert into public.inventory_movements (
    movement_group_id, item_id, batch_id, movement_type, quantity, notes, created_by
  )
  values (
    v_movement_group_id, p_item_id, v_batch_id, 'opening_balance', p_quantity, p_notes, v_actor
  );

  select current_stock, usable_stock
  into v_total_stock, v_usable_stock
  from public.inventory_stock_summary
  where item_id = p_item_id;

  return jsonb_build_object(
    'ok', true,
    'operation', 'opening_balance',
    'item_id', p_item_id,
    'item_name', v_item.name,
    'movement_group_id', v_movement_group_id,
    'quantity', p_quantity,
    'total_stock_after', coalesce(v_total_stock, 0),
    'usable_stock_after', coalesce(v_usable_stock, 0),
    'warnings', v_warnings,
    'details', jsonb_build_object('batch_id', v_batch_id, 'batch_ref', v_batch_ref)
  );
end;
$$;

revoke execute on function public.inventory_opening_balance(uuid, numeric, date, numeric, text, text) from public;
revoke execute on function public.inventory_opening_balance(uuid, numeric, date, numeric, text, text) from anon;
grant execute on function public.inventory_opening_balance(uuid, numeric, date, numeric, text, text) to authenticated;

-- =========================================================
-- inventory_stock_in
-- =========================================================
-- Records a new delivery and always creates a new stock-in batch.

drop function if exists public.inventory_stock_in(uuid, numeric, date, numeric, text, text, text);

create function public.inventory_stock_in(
  p_item_id uuid,
  p_quantity numeric,
  p_expiry_date date default null,
  p_cost_per_unit numeric default null,
  p_reference_text text default null,
  p_batch_ref text default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.inventory_items%rowtype;
  v_batch_id uuid;
  v_batch_ref text;
  v_movement_group_id uuid := gen_random_uuid();
  v_total_stock numeric(14,3);
  v_usable_stock numeric(14,3);
begin
  if v_actor is null then
    raise exception 'Please sign in before changing inventory.'
      using errcode = 'P0001', detail = 'INV_AUTH_REQUIRED', hint = 'Sign in with the CURV owner account.';
  end if;
  if not public.is_admin() then
    raise exception 'Only CURV owners can change inventory.'
      using errcode = 'P0001', detail = 'INV_ADMIN_REQUIRED', hint = 'Use an approved owner account.';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'Inventory item was not found.'
      using errcode = 'P0001', detail = 'INV_ITEM_NOT_FOUND', hint = 'Refresh inventory and choose an existing item.';
  end if;
  if not v_item.is_active then
    raise exception 'This inventory item is archived.'
      using errcode = 'P0001', detail = 'INV_ITEM_INACTIVE', hint = 'Reactivate the item before changing stock.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.'
      using errcode = 'P0001', detail = 'INV_INVALID_QUANTITY', hint = 'Enter a positive quantity.';
  end if;
  if p_cost_per_unit is not null and p_cost_per_unit < 0 then
    raise exception 'Cost per unit cannot be negative.'
      using errcode = 'P0001', detail = 'INV_INVALID_QUANTITY', hint = 'Enter zero, a positive cost, or leave cost blank.';
  end if;
  if v_item.track_expiry and p_expiry_date is null then
    raise exception 'Expiry date is required for this item.'
      using errcode = 'P0001', detail = 'INV_EXPIRY_REQUIRED', hint = 'Enter an expiry date for this delivery.';
  end if;
  if p_expiry_date is not null and p_expiry_date < current_date then
    raise exception 'New usable stock cannot have a past expiry date.'
      using errcode = 'P0001', detail = 'INV_EXPIRY_IN_PAST', hint = 'Use today or a future expiry date.';
  end if;
  if p_batch_ref is not null and length(btrim(p_batch_ref)) = 0 then
    raise exception 'Batch reference cannot be blank.'
      using errcode = 'P0001', detail = 'INV_INVALID_BATCH_REF', hint = 'Enter a batch reference or leave it blank to generate one.';
  end if;

  v_batch_ref := coalesce(
    nullif(btrim(p_batch_ref), ''),
    'SI-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  );

  if exists (
    select 1 from public.inventory_batches b
    where b.item_id = p_item_id
      and lower(btrim(b.batch_ref)) = lower(btrim(v_batch_ref))
  ) then
    raise exception 'That batch reference already exists for this item.'
      using errcode = 'P0001', detail = 'INV_DUPLICATE_BATCH_REF', hint = 'Use a different batch reference.';
  end if;

  insert into public.inventory_batches (
    item_id, batch_ref, batch_origin, received_date, expiry_date,
    quantity_received, quantity_remaining, cost_per_unit, reference_text, notes, created_by
  )
  values (
    p_item_id, v_batch_ref, 'stock_in', current_date, p_expiry_date,
    p_quantity, p_quantity, p_cost_per_unit, p_reference_text, p_notes, v_actor
  )
  returning id into v_batch_id;

  insert into public.inventory_movements (
    movement_group_id, item_id, batch_id, movement_type, quantity, reference_text, notes, created_by
  )
  values (
    v_movement_group_id, p_item_id, v_batch_id, 'stock_in', p_quantity, p_reference_text, p_notes, v_actor
  );

  select current_stock, usable_stock into v_total_stock, v_usable_stock
  from public.inventory_stock_summary
  where item_id = p_item_id;

  return jsonb_build_object(
    'ok', true,
    'operation', 'stock_in',
    'item_id', p_item_id,
    'item_name', v_item.name,
    'movement_group_id', v_movement_group_id,
    'quantity', p_quantity,
    'total_stock_after', coalesce(v_total_stock, 0),
    'usable_stock_after', coalesce(v_usable_stock, 0),
    'warnings', '[]'::jsonb,
    'details', jsonb_build_object('batch_id', v_batch_id, 'batch_ref', v_batch_ref)
  );
end;
$$;

revoke execute on function public.inventory_stock_in(uuid, numeric, date, numeric, text, text, text) from public;
revoke execute on function public.inventory_stock_in(uuid, numeric, date, numeric, text, text, text) from anon;
grant execute on function public.inventory_stock_in(uuid, numeric, date, numeric, text, text, text) to authenticated;

-- =========================================================
-- inventory_stock_out
-- =========================================================
-- Records normal usage. Deduction is all-or-nothing and uses FEFO order.

drop function if exists public.inventory_stock_out(uuid, numeric, text, text);

create function public.inventory_stock_out(
  p_item_id uuid,
  p_quantity numeric,
  p_reference_text text default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.inventory_items%rowtype;
  v_movement_group_id uuid := gen_random_uuid();
  v_usable_stock numeric(14,3);
  v_total_stock numeric(14,3);
  v_needed numeric(14,3);
  v_take numeric(14,3);
  v_batch public.inventory_batches%rowtype;
  v_touched jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'Please sign in before changing inventory.'
      using errcode = 'P0001', detail = 'INV_AUTH_REQUIRED', hint = 'Sign in with the CURV owner account.';
  end if;
  if not public.is_admin() then
    raise exception 'Only CURV owners can change inventory.'
      using errcode = 'P0001', detail = 'INV_ADMIN_REQUIRED', hint = 'Use an approved owner account.';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'Inventory item was not found.'
      using errcode = 'P0001', detail = 'INV_ITEM_NOT_FOUND', hint = 'Refresh inventory and choose an existing item.';
  end if;
  if not v_item.is_active then
    raise exception 'This inventory item is archived.'
      using errcode = 'P0001', detail = 'INV_ITEM_INACTIVE', hint = 'Reactivate the item before changing stock.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.'
      using errcode = 'P0001', detail = 'INV_INVALID_QUANTITY', hint = 'Enter a positive quantity.';
  end if;

  select coalesce(sum(quantity_remaining), 0)::numeric(14,3)
  into v_usable_stock
  from public.inventory_batches
  where item_id = p_item_id
    and quantity_remaining > 0
    and (expiry_date is null or expiry_date >= current_date);

  if v_usable_stock < p_quantity then
    raise exception 'Not enough usable stock. Available: %, requested: %.',
      v_usable_stock,
      p_quantity
      using errcode = 'P0001', detail = 'INV_INSUFFICIENT_USABLE_STOCK', hint = 'Record a stock-in or enter a smaller quantity.';
  end if;

  v_needed := p_quantity;
  -- The item row is already locked, so another controlled operation for this
  -- item cannot change its batches until this transaction finishes.
  -- Batch rows are then locked and processed in deterministic FEFO order.
  for v_batch in
    select *
    from public.inventory_batches
    where item_id = p_item_id
      and quantity_remaining > 0
      and (expiry_date is null or expiry_date >= current_date)
    order by expiry_date asc nulls last, received_date asc, id asc
    for update
  loop
    exit when v_needed <= 0;
    v_take := least(v_needed, v_batch.quantity_remaining);

    update public.inventory_batches
    set quantity_remaining = quantity_remaining - v_take
    where id = v_batch.id
    returning quantity_remaining into v_batch.quantity_remaining;

    insert into public.inventory_movements (
      movement_group_id, item_id, batch_id, movement_type, quantity, reference_text, notes, created_by
    )
    values (
      v_movement_group_id, p_item_id, v_batch.id, 'stock_out', v_take, p_reference_text, p_notes, v_actor
    );

    v_touched := v_touched || jsonb_build_array(jsonb_build_object(
      'batch_id', v_batch.id,
      'batch_ref', v_batch.batch_ref,
      'quantity_deducted', v_take,
      'quantity_remaining', v_batch.quantity_remaining
    ));
    v_needed := v_needed - v_take;
  end loop;

  if v_needed > 0 then
    raise exception 'Not enough usable stock. Available: %, requested: %.',
      p_quantity - v_needed,
      p_quantity
      using errcode = 'P0001', detail = 'INV_INSUFFICIENT_USABLE_STOCK', hint = 'Record a stock-in or enter a smaller quantity.';
  end if;

  select current_stock, usable_stock into v_total_stock, v_usable_stock
  from public.inventory_stock_summary
  where item_id = p_item_id;

  return jsonb_build_object(
    'ok', true,
    'operation', 'stock_out',
    'item_id', p_item_id,
    'item_name', v_item.name,
    'movement_group_id', v_movement_group_id,
    'quantity', p_quantity,
    'total_stock_after', coalesce(v_total_stock, 0),
    'usable_stock_after', coalesce(v_usable_stock, 0),
    'warnings', '[]'::jsonb,
    'details', jsonb_build_object('batches_touched', v_touched, 'quantity_deducted', p_quantity)
  );
end;
$$;

revoke execute on function public.inventory_stock_out(uuid, numeric, text, text) from public;
revoke execute on function public.inventory_stock_out(uuid, numeric, text, text) from anon;
grant execute on function public.inventory_stock_out(uuid, numeric, text, text) to authenticated;

-- =========================================================
-- inventory_record_waste
-- =========================================================
-- Records lost stock. Expired waste without a chosen batch targets expired
-- batches only; other waste uses usable FEFO batches.

drop function if exists public.inventory_record_waste(uuid, numeric, text, uuid, text);

create function public.inventory_record_waste(
  p_item_id uuid,
  p_quantity numeric,
  p_reason_code text,
  p_batch_id uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.inventory_items%rowtype;
  v_reason text := lower(btrim(coalesce(p_reason_code, '')));
  v_movement_group_id uuid := gen_random_uuid();
  v_available numeric(14,3);
  v_total_stock numeric(14,3);
  v_usable_stock numeric(14,3);
  v_needed numeric(14,3);
  v_take numeric(14,3);
  v_batch public.inventory_batches%rowtype;
  v_touched jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'Please sign in before changing inventory.'
      using errcode = 'P0001', detail = 'INV_AUTH_REQUIRED', hint = 'Sign in with the CURV owner account.';
  end if;
  if not public.is_admin() then
    raise exception 'Only CURV owners can change inventory.'
      using errcode = 'P0001', detail = 'INV_ADMIN_REQUIRED', hint = 'Use an approved owner account.';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'Inventory item was not found.'
      using errcode = 'P0001', detail = 'INV_ITEM_NOT_FOUND', hint = 'Refresh inventory and choose an existing item.';
  end if;
  if not v_item.is_active then
    raise exception 'This inventory item is archived.'
      using errcode = 'P0001', detail = 'INV_ITEM_INACTIVE', hint = 'Reactivate the item before changing stock.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.'
      using errcode = 'P0001', detail = 'INV_INVALID_QUANTITY', hint = 'Enter a positive quantity.';
  end if;
  if v_reason not in ('expired','spoiled','spilled','damaged','preparation_error','overproduction','quality_rejection','staff_use','other') then
    raise exception 'Choose a valid waste reason.'
      using errcode = 'P0001', detail = 'INV_WASTE_REASON_INVALID', hint = 'Use one of the approved waste reasons.';
  end if;
  if v_reason = 'other' and length(btrim(coalesce(p_notes, ''))) = 0 then
    raise exception 'Notes are required when waste reason is other.'
      using errcode = 'P0001', detail = 'INV_NOTES_REQUIRED', hint = 'Describe the waste reason in notes.';
  end if;

  if p_batch_id is not null then
    select *
    into v_batch
    from public.inventory_batches
    where id = p_batch_id
      and item_id = p_item_id
    for update;

    if not found then
      raise exception 'That batch was not found for the selected item.'
        using errcode = 'P0001', detail = 'INV_BATCH_NOT_FOUND', hint = 'Refresh inventory and choose a batch belonging to this item.';
    end if;
    if v_batch.quantity_remaining < p_quantity then
      raise exception 'That batch does not have enough remaining stock.'
        using errcode = 'P0001', detail = 'INV_INSUFFICIENT_BATCH_STOCK', hint = 'Enter a smaller quantity or choose another batch.';
    end if;
    if v_reason = 'expired'
       and (v_batch.expiry_date is null or v_batch.expiry_date >= current_date)
       and length(btrim(coalesce(p_notes, ''))) = 0 then
      raise exception 'Notes are required for early expiry waste.'
        using errcode = 'P0001', detail = 'INV_NOTES_REQUIRED', hint = 'Explain why this batch is being treated as expired early.';
    end if;
    if v_reason = 'expired'
       and (v_batch.expiry_date is null or v_batch.expiry_date >= current_date) then
      v_warnings := v_warnings || jsonb_build_array('This batch was recorded as expired before its listed expiry date.');
    end if;

    update public.inventory_batches
    set quantity_remaining = quantity_remaining - p_quantity
    where id = v_batch.id
    returning quantity_remaining into v_batch.quantity_remaining;

    insert into public.inventory_movements (
      movement_group_id, item_id, batch_id, movement_type, quantity, reason_code, notes, created_by
    )
    values (
      v_movement_group_id, p_item_id, v_batch.id, 'waste', p_quantity, v_reason, p_notes, v_actor
    );

    v_touched := v_touched || jsonb_build_array(jsonb_build_object(
      'batch_id', v_batch.id,
      'batch_ref', v_batch.batch_ref,
      'quantity_deducted', p_quantity,
      'quantity_remaining', v_batch.quantity_remaining
    ));
  else
    if v_reason = 'expired' then
      select coalesce(sum(quantity_remaining), 0)::numeric(14,3)
      into v_available
      from public.inventory_batches
      where item_id = p_item_id
        and quantity_remaining > 0
        and expiry_date < current_date;

      if v_available < p_quantity then
        raise exception 'Not enough expired stock is available to record as waste. Available: %, requested: %.',
          v_available,
          p_quantity
          using errcode = 'P0001', detail = 'INV_INSUFFICIENT_EXPIRED_STOCK', hint = 'Choose a specific expired batch or enter a smaller quantity.';
      end if;

      v_needed := p_quantity;
      -- The item row is already locked, so another controlled operation for this
      -- item cannot change its batches until this transaction finishes.
      -- Batch rows are then locked and processed in deterministic FEFO order.
      for v_batch in
        select *
        from public.inventory_batches
        where item_id = p_item_id
          and quantity_remaining > 0
          and expiry_date < current_date
        order by expiry_date asc, received_date asc, id asc
        for update
      loop
        exit when v_needed <= 0;
        v_take := least(v_needed, v_batch.quantity_remaining);
        update public.inventory_batches
        set quantity_remaining = quantity_remaining - v_take
        where id = v_batch.id
        returning quantity_remaining into v_batch.quantity_remaining;
        insert into public.inventory_movements (
          movement_group_id, item_id, batch_id, movement_type, quantity, reason_code, notes, created_by
        )
        values (
          v_movement_group_id, p_item_id, v_batch.id, 'waste', v_take, v_reason, p_notes, v_actor
        );
        v_touched := v_touched || jsonb_build_array(jsonb_build_object(
          'batch_id', v_batch.id,
          'batch_ref', v_batch.batch_ref,
          'quantity_deducted', v_take,
          'quantity_remaining', v_batch.quantity_remaining
        ));
        v_needed := v_needed - v_take;
      end loop;

      if v_needed > 0 then
        raise exception
          'Not enough expired stock to complete this waste record. Available: %, requested: %.',
          p_quantity - v_needed,
          p_quantity
          using
            errcode = 'P0001',
            detail = 'INV_INSUFFICIENT_EXPIRED_STOCK',
            hint = 'Choose a specific expired batch or enter a smaller quantity.';
      end if;
    else
      select coalesce(sum(quantity_remaining), 0)::numeric(14,3)
      into v_available
      from public.inventory_batches
      where item_id = p_item_id
        and quantity_remaining > 0
        and (expiry_date is null or expiry_date >= current_date);

      if v_available < p_quantity then
        raise exception 'Not enough usable stock is available to record as waste. Available: %, requested: %.',
          v_available,
          p_quantity
          using errcode = 'P0001', detail = 'INV_INSUFFICIENT_USABLE_STOCK', hint = 'Record a stock-in or enter a smaller quantity.';
      end if;

      v_needed := p_quantity;
      -- The item row is already locked, so another controlled operation for this
      -- item cannot change its batches until this transaction finishes.
      -- Batch rows are then locked and processed in deterministic FEFO order.
      for v_batch in
        select *
        from public.inventory_batches
        where item_id = p_item_id
          and quantity_remaining > 0
          and (expiry_date is null or expiry_date >= current_date)
        order by expiry_date asc nulls last, received_date asc, id asc
        for update
      loop
        exit when v_needed <= 0;
        v_take := least(v_needed, v_batch.quantity_remaining);
        update public.inventory_batches
        set quantity_remaining = quantity_remaining - v_take
        where id = v_batch.id
        returning quantity_remaining into v_batch.quantity_remaining;
        insert into public.inventory_movements (
          movement_group_id, item_id, batch_id, movement_type, quantity, reason_code, notes, created_by
        )
        values (
          v_movement_group_id, p_item_id, v_batch.id, 'waste', v_take, v_reason, p_notes, v_actor
        );
        v_touched := v_touched || jsonb_build_array(jsonb_build_object(
          'batch_id', v_batch.id,
          'batch_ref', v_batch.batch_ref,
          'quantity_deducted', v_take,
          'quantity_remaining', v_batch.quantity_remaining
        ));
        v_needed := v_needed - v_take;
      end loop;

      if v_needed > 0 then
        raise exception
          'Not enough usable stock to complete this waste record. Available: %, requested: %.',
          p_quantity - v_needed,
          p_quantity
          using
            errcode = 'P0001',
            detail = 'INV_INSUFFICIENT_USABLE_STOCK',
            hint = 'Record a stock-in or enter a smaller quantity.';
      end if;
    end if;
  end if;

  select current_stock, usable_stock into v_total_stock, v_usable_stock
  from public.inventory_stock_summary
  where item_id = p_item_id;

  return jsonb_build_object(
    'ok', true,
    'operation', 'waste',
    'item_id', p_item_id,
    'item_name', v_item.name,
    'movement_group_id', v_movement_group_id,
    'quantity', p_quantity,
    'total_stock_after', coalesce(v_total_stock, 0),
    'usable_stock_after', coalesce(v_usable_stock, 0),
    'warnings', v_warnings,
    'details', jsonb_build_object('reason_code', v_reason, 'batches_touched', v_touched)
  );
end;
$$;

revoke execute on function public.inventory_record_waste(uuid, numeric, text, uuid, text) from public;
revoke execute on function public.inventory_record_waste(uuid, numeric, text, uuid, text) from anon;
grant execute on function public.inventory_record_waste(uuid, numeric, text, uuid, text) to authenticated;

-- =========================================================
-- inventory_adjust_to_count
-- =========================================================
-- Reconciles usable stock to a physical count. The count excludes expired stock.

drop function if exists public.inventory_adjust_to_count(uuid, numeric, text, uuid, date);

create function public.inventory_adjust_to_count(
  p_item_id uuid,
  p_actual_quantity numeric,
  p_notes text,
  p_existing_batch_id uuid default null,
  p_expiry_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.inventory_items%rowtype;
  v_movement_group_id uuid;
  v_current_usable numeric(14,3);
  v_delta numeric(14,3);
  v_needed numeric(14,3);
  v_take numeric(14,3);
  v_batch public.inventory_batches%rowtype;
  v_batch_id uuid;
  v_batch_ref text;
  v_total_stock numeric(14,3);
  v_usable_stock numeric(14,3);
  v_touched jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'Please sign in before changing inventory.'
      using errcode = 'P0001', detail = 'INV_AUTH_REQUIRED', hint = 'Sign in with the CURV owner account.';
  end if;
  if not public.is_admin() then
    raise exception 'Only CURV owners can change inventory.'
      using errcode = 'P0001', detail = 'INV_ADMIN_REQUIRED', hint = 'Use an approved owner account.';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'Inventory item was not found.'
      using errcode = 'P0001', detail = 'INV_ITEM_NOT_FOUND', hint = 'Refresh inventory and choose an existing item.';
  end if;
  if not v_item.is_active then
    raise exception 'This inventory item is archived.'
      using errcode = 'P0001', detail = 'INV_ITEM_INACTIVE', hint = 'Reactivate the item before changing stock.';
  end if;
  if p_actual_quantity is null or p_actual_quantity < 0 then
    raise exception 'Actual quantity cannot be negative.'
      using errcode = 'P0001', detail = 'INV_INVALID_QUANTITY', hint = 'Enter zero or a positive counted quantity.';
  end if;
  if length(btrim(coalesce(p_notes, ''))) = 0 then
    raise exception 'Notes are required for inventory adjustments.'
      using errcode = 'P0001', detail = 'INV_NOTES_REQUIRED', hint = 'Explain why the physical count differs.';
  end if;

  select coalesce(sum(quantity_remaining), 0)::numeric(14,3)
  into v_current_usable
  from public.inventory_batches
  where item_id = p_item_id
    and quantity_remaining > 0
    and (expiry_date is null or expiry_date >= current_date);

  v_delta := p_actual_quantity - v_current_usable;

  if v_delta = 0 then
    select current_stock, usable_stock into v_total_stock, v_usable_stock
    from public.inventory_stock_summary
    where item_id = p_item_id;

    return jsonb_build_object(
      'ok', true,
      'operation', 'adjust_to_count',
      'item_id', p_item_id,
      'item_name', v_item.name,
      'movement_group_id', null,
      'quantity', 0,
      'total_stock_after', coalesce(v_total_stock, 0),
      'usable_stock_after', coalesce(v_usable_stock, 0),
      'warnings', '[]'::jsonb,
      'details', jsonb_build_object(
        'result', 'no_change',
        'previous_usable_stock', v_current_usable,
        'actual_quantity', p_actual_quantity,
        'adjustment_quantity', 0
      )
    );
  end if;

  v_movement_group_id := gen_random_uuid();

  if v_delta < 0 then
    v_needed := abs(v_delta);

    -- The item row is already locked, so another controlled operation for this
    -- item cannot change its batches until this transaction finishes.
    -- Batch rows are then locked and processed in deterministic FEFO order.
    for v_batch in
      select *
      from public.inventory_batches
      where item_id = p_item_id
        and quantity_remaining > 0
        and (expiry_date is null or expiry_date >= current_date)
      order by expiry_date asc nulls last, received_date asc, id asc
      for update
    loop
      exit when v_needed <= 0;
      v_take := least(v_needed, v_batch.quantity_remaining);
      update public.inventory_batches
      set quantity_remaining = quantity_remaining - v_take
      where id = v_batch.id
      returning quantity_remaining into v_batch.quantity_remaining;
      insert into public.inventory_movements (
        movement_group_id, item_id, batch_id, movement_type, quantity, notes, created_by
      )
      values (
        v_movement_group_id, p_item_id, v_batch.id, 'adjustment_out', v_take, p_notes, v_actor
      );
      v_touched := v_touched || jsonb_build_array(jsonb_build_object(
        'batch_id', v_batch.id,
        'batch_ref', v_batch.batch_ref,
        'quantity_deducted', v_take,
        'quantity_remaining', v_batch.quantity_remaining
      ));
      v_needed := v_needed - v_take;
    end loop;

    if v_needed > 0 then
      raise exception 'Not enough usable stock to adjust down to that count.'
        using errcode = 'P0001', detail = 'INV_INSUFFICIENT_USABLE_STOCK', hint = 'Refresh stock and try the count again.';
    end if;
  else
    if p_existing_batch_id is not null then
      select *
      into v_batch
      from public.inventory_batches
      where id = p_existing_batch_id
        and item_id = p_item_id
      for update;

      if not found then
        raise exception 'That batch was not found for the selected item.'
          using errcode = 'P0001', detail = 'INV_BATCH_NOT_FOUND', hint = 'Refresh inventory and choose a batch belonging to this item.';
      end if;
      if v_batch.expiry_date is not null and v_batch.expiry_date < current_date then
        raise exception 'That batch is expired and cannot receive a positive adjustment.'
          using errcode = 'P0001', detail = 'INV_BATCH_EXPIRED', hint = 'Choose another batch or create a new adjustment batch with the correct expiry date.';
      end if;

      update public.inventory_batches
      set quantity_remaining = quantity_remaining + v_delta
      where id = v_batch.id
      returning quantity_remaining into v_batch.quantity_remaining;

      insert into public.inventory_movements (
        movement_group_id, item_id, batch_id, movement_type, quantity, notes, created_by
      )
      values (
        v_movement_group_id, p_item_id, v_batch.id, 'adjustment_in', v_delta, p_notes, v_actor
      );

      v_touched := v_touched || jsonb_build_array(jsonb_build_object(
        'batch_id', v_batch.id,
        'batch_ref', v_batch.batch_ref,
        'quantity_added', v_delta,
        'quantity_remaining', v_batch.quantity_remaining
      ));
    else
      if v_item.track_expiry and p_expiry_date is null then
        raise exception 'Expiry date is required for this adjustment batch.'
          using errcode = 'P0001', detail = 'INV_EXPIRY_REQUIRED', hint = 'Enter an expiry date for the added stock.';
      end if;
      if p_expiry_date is not null and p_expiry_date < current_date then
        raise exception 'New usable stock cannot have a past expiry date.'
          using errcode = 'P0001', detail = 'INV_EXPIRY_IN_PAST', hint = 'Use today or a future expiry date.';
      end if;

      v_batch_ref := 'ADJ-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

      insert into public.inventory_batches (
        item_id, batch_ref, batch_origin, received_date, expiry_date,
        quantity_received, quantity_remaining, notes, created_by
      )
      values (
        p_item_id, v_batch_ref, 'adjustment', current_date, p_expiry_date,
        v_delta, v_delta, p_notes, v_actor
      )
      returning id into v_batch_id;

      insert into public.inventory_movements (
        movement_group_id, item_id, batch_id, movement_type, quantity, notes, created_by
      )
      values (
        v_movement_group_id, p_item_id, v_batch_id, 'adjustment_in', v_delta, p_notes, v_actor
      );

      v_touched := v_touched || jsonb_build_array(jsonb_build_object(
        'batch_id', v_batch_id,
        'batch_ref', v_batch_ref,
        'quantity_added', v_delta,
        'quantity_remaining', v_delta
      ));
    end if;
  end if;

  select current_stock, usable_stock into v_total_stock, v_usable_stock
  from public.inventory_stock_summary
  where item_id = p_item_id;

  return jsonb_build_object(
    'ok', true,
    'operation', 'adjust_to_count',
    'item_id', p_item_id,
    'item_name', v_item.name,
    'movement_group_id', v_movement_group_id,
    'quantity', abs(v_delta),
    'total_stock_after', coalesce(v_total_stock, 0),
    'usable_stock_after', coalesce(v_usable_stock, 0),
    'warnings', '[]'::jsonb,
    'details', jsonb_build_object(
      'result', case when v_delta > 0 then 'adjusted_in' else 'adjusted_out' end,
      'previous_usable_stock', v_current_usable,
      'actual_quantity', p_actual_quantity,
      'adjustment_quantity', abs(v_delta),
      'batches_touched', v_touched
    )
  );
end;
$$;

revoke execute on function public.inventory_adjust_to_count(uuid, numeric, text, uuid, date) from public;
revoke execute on function public.inventory_adjust_to_count(uuid, numeric, text, uuid, date) from anon;
grant execute on function public.inventory_adjust_to_count(uuid, numeric, text, uuid, date) to authenticated;
