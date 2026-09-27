-- C1B: preserve O10/O12/O14 submission and add maintenance only for new orders.
begin;
create or replace function customer_private.normalize_phone(p_phone text)
returns text language sql immutable strict set search_path = pg_catalog
as $$
  select case
    when btrim(p_phone) ~ '^09[0-9]{9}$' then '+63' || substring(btrim(p_phone) from 2)
    when btrim(p_phone) ~ '^639[0-9]{9}$' then '+' || btrim(p_phone)
    when btrim(p_phone) ~ '^\+639[0-9]{9}$' then btrim(p_phone)
    else null end;
$$;
revoke all on function customer_private.normalize_phone(text) from public, anon, authenticated;

-- SECURITY INVOKER deliberately: only the privileged submission RPC may call it.
create or replace function customer_private.link_website_order(p_order_id uuid)
returns void language plpgsql set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_phone text;
  v_address text;
  v_customer_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.source is distinct from 'website' or v_order.customer_id is not null then return; end if;
  v_phone := customer_private.normalize_phone(v_order.customer_phone);
  if v_phone is null then return; end if;
  if v_order.fulfillment_type = 'delivery'
    and nullif(btrim(v_order.delivery_address), '') is not null
    and lower(btrim(v_order.delivery_address)) <> 'returning customer'
  then v_address := btrim(v_order.delivery_address); end if;

  insert into public.customers as existing (
    normalized_phone, latest_name, latest_delivery_address, first_order_at, last_order_at
  ) values (
    v_phone, nullif(btrim(v_order.customer_name), ''), v_address, v_order.created_at, v_order.created_at
  ) on conflict (normalized_phone) do update set
    latest_name = case when excluded.last_order_at > existing.last_order_at
      then coalesce(excluded.latest_name, existing.latest_name) else existing.latest_name end,
    latest_delivery_address = case when excluded.last_order_at > existing.last_order_at
      then coalesce(excluded.latest_delivery_address, existing.latest_delivery_address) else existing.latest_delivery_address end,
    first_order_at = least(existing.first_order_at, excluded.first_order_at),
    last_order_at = greatest(existing.last_order_at, excluded.last_order_at),
    updated_at = now()
  returning id into v_customer_id;
  -- Order snapshots are never rewritten.
  update public.orders set customer_id = v_customer_id where id = p_order_id;
end;
$$;
revoke all on function customer_private.link_website_order(uuid) from public, anon, authenticated;

-- Like O14, patch the installed function rather than copying an obsolete body.
-- Abort transactionally on an unexpected implementation; never silently replace it.
do $patch$
declare
  v_oid oid := to_regprocedure('public.submit_public_order(jsonb)');
  v_definition text;
  v_anchor text := E'  return jsonb_build_object(\n    ''order_number'', v_order_number,\n    ''tracking_token'', v_tracking_token\n  );';
  v_hook text := '  perform customer_private.link_website_order(v_order_id);';
begin
  if v_oid is null then raise exception 'C1B requires submit_public_order(jsonb).'; end if;
  if not exists (select 1 from pg_proc where oid=v_oid and prosecdef and proowner=(select oid from pg_roles where rolname=current_user)) then
    raise exception 'C1B must run as the existing SECURITY DEFINER submission function owner.';
  end if;
  select pg_get_functiondef(v_oid) into v_definition;
  if position('public_submission_key' in v_definition)=0
    or position('CURV_ORDERING_CLOSED' in v_definition)=0
    or position('dine_in' in v_definition)=0
    or position('insert into public.order_items' in v_definition)=0 then
    raise exception 'C1B requires the reviewed O10/O12/O14 submission contract.';
  end if;
  if position(v_hook in v_definition)=0 then
    if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1 then
      raise exception 'C1B submission return anchor mismatch; review installed function before applying.';
    end if;
    execute replace(v_definition, v_anchor, v_hook || E'\n\n' || v_anchor);
  end if;
end;
$patch$;
commit;
