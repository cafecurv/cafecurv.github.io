-- LOCAL DRAFT ONLY. Requires accepted P1A/P1B. No tables, writes or replaced RPCs.
-- Dedicated read adds the persisted subtotal and validates the document boundary.
begin;
create or replace function public.pos_get_order_copy(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.orders%rowtype; v_result jsonb;
begin
  perform pos_private.actor();
  select * into v_order from public.orders where id=p_order_id and source='pos' for share;
  if not found then raise exception 'Order unavailable.' using errcode='P0001',detail='POS_NOT_FOUND'; end if;
  if v_order.status not in ('open','held') or v_order.payment_status is distinct from 'unpaid'
    or v_order.payment_method is not null or v_order.currency<>'PHP'
    or v_order.subtotal is distinct from v_order.total then
    -- P1A/P1B have no POS order adjustments. Do not silently omit future ones.
    raise exception 'Order copy unavailable for this order.' using errcode='P0001',detail='POS_COPY_UNAVAILABLE';
  end if;
  v_result:=pos_private.read_order(p_order_id)-'kitchen';
  if jsonb_array_length(v_result->'items')=0 then
    raise exception 'Add an item before printing.' using errcode='P0001',detail='POS_COPY_EMPTY'; end if;
  return v_result||jsonb_build_object('source','pos','payment_status','unpaid','currency',v_order.currency,
    'customer_name',coalesce(nullif(btrim(v_order.customer_name),''),'Walk-in'),
    'subtotal',v_order.subtotal,'total',v_order.total,'printed_at',clock_timestamp());
end $$;
revoke all on function public.pos_get_order_copy(uuid) from public,anon,authenticated;
grant execute on function public.pos_get_order_copy(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
