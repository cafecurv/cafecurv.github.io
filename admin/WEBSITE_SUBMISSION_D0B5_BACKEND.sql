-- LOCAL DRAFT. Separate opt-in v2 RPC; existing public writer remains unchanged.
-- Requires D0B1-D0B4 and the current O12/O14/C1B/structured timing baseline.
begin;
do $$
declare definition text; r record;
begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname='submit_public_order_v2')
      or (n.nspname='submission_private' and p.proname='validate_current_order')) then
    raise exception 'D0B5 function collision; review required' using detail='D0B5_COLLISION';
  end if;
  select pg_get_functiondef(oid) into definition from pg_proc
    where oid=to_regprocedure('public.submit_public_order(jsonb)') and prosecdef
      and proowner=(select oid from pg_roles where rolname=current_user);
  if definition is null or position('CURV_ORDERING_CLOSED' in definition)=0
    or position('-- Structured dine-in timing:' in definition)=0
    or position('perform customer_private.link_website_order(v_order_id);' in definition)=0
    or to_regprocedure('submission_private.replay_or_prepare(jsonb)') is null
    or to_regprocedure('configuration_private.price_order_configuration(jsonb)') is null
    or to_regprocedure('configuration_private.customer_pricing_review(jsonb)') is null then
    raise exception 'D0B5 reviewed baseline/owner missing' using detail='D0B5_PREREQUISITE';
  end if;
  if not exists(select 1 from pg_index where indexrelid=to_regclass('public.orders_public_submission_key_idx')
    and indisunique and indisvalid and indisready and indrelid='public.orders'::regclass
    and indnkeyatts=1 and pg_get_indexdef(indexrelid,1,true)='public_submission_key'
    and pg_get_expr(indpred,indrelid)='(public_submission_key IS NOT NULL)') then
    raise exception 'D0B5 submission-key index missing' using detail='D0B5_PREREQUISITE';
  end if;
  for r in select * from (values
    ('orders','pricing_contract_version','smallint'),('orders','pricing_policy_version','text'),
    ('orders','pricing_fingerprint_version','smallint'),('orders','accepted_review_fingerprint','text'),
    ('orders','priced_at','timestamp with time zone'),('orders','submission_fingerprint_version','smallint'),
    ('orders','preparation_timing','text'),('orders','requested_preparation_at','timestamp with time zone'),
    ('order_items','pricing_configuration_snapshot','jsonb')) v(tbl,col,typ) loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name=r.col and data_type=r.typ) then
      raise exception 'D0B5 column prerequisite missing' using detail='D0B5_PREREQUISITE';
    end if;
  end loop;
end $$;

-- Canonicalization already validates bounded customer/fulfillment/note structure.
-- Only mutable/current checks live here, AFTER replay. Existing writer repeats
-- its own complete checks before allocation, retaining legacy business authority.
create function submission_private.validate_current_order(p_intent jsonb) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare requested timestamptz; current_time_at_check timestamptz;
begin
  if not coalesce((select s.website_ordering_enabled from public.store_settings s where s.id is true),false) then
    raise exception 'Ordering unavailable' using errcode='P0001',detail='CURV_ORDERING_CLOSED';
  end if;
  -- Match the current website's selectable methods; this is intent validation,
  -- not payment verification. Dine-in's disabled select always sends counter.
  if p_intent->>'payment_method' is null
    or p_intent->>'payment_method' not in ('counter','cod','gcash','bank')
    or (p_intent->>'fulfillment_type'='dine_in' and p_intent->>'payment_method'<>'counter')
    or (p_intent->>'fulfillment_type'='delivery' and lower(p_intent->>'delivery_address')='returning customer') then
    perform submission_private.reject('ORDER_CART_INVALID');
  end if;
  if p_intent->>'fulfillment_type'='dine_in' and p_intent->>'preparation_timing'='scheduled' then
    requested := (p_intent->>'requested_preparation_at')::timestamptz;
    current_time_at_check := clock_timestamp();
    if requested<=current_time_at_check or (requested at time zone 'Asia/Manila')::date
      <> (current_time_at_check at time zone 'Asia/Manila')::date then
      raise exception 'Choose later today' using errcode='22023',detail='DINE_TIMING_NOT_LATER_TODAY';
    end if;
  end if;
end $$;
revoke all on function submission_private.validate_current_order(jsonb) from public,anon,authenticated;

create function public.submit_public_order_v2(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare prepared jsonb; payload jsonb; intent jsonb; pricing jsonb; quote jsonb;
  trusted jsonb; result jsonb; created_id uuid; line jsonb; options jsonb; item_rows integer;
  code text; state text; constraint_hit text; message text; priced_at_value timestamptz;
begin
  -- The D0B2 envelope preserves an EXACT legacy payload on replay, with any new
  -- client metadata outside it. No new rules or price lookup before this call.
  prepared := submission_private.replay_or_prepare(p_request);
  if prepared->>'state'='replay' then return prepared->'result'; end if;
  payload := p_request->'payload'; intent := prepared->'intent';
  if jsonb_typeof(payload->'review_fingerprint') is distinct from 'string'
    or (payload->>'review_fingerprint') !~ '^[0-9a-f]{64}$' then
    perform submission_private.reject('ORDER_CART_INVALID');
  end if;
  perform submission_private.validate_current_order(intent);
  -- One engine statement snapshot supplies BOTH reviewed and persisted values.
  pricing := configuration_private.price_order_configuration(intent->'items');
  quote := configuration_private.customer_pricing_review(pricing);
  priced_at_value := clock_timestamp();
  if quote->>'review_fingerprint' is distinct from payload->>'review_fingerprint' then
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code','PRICE_CHANGED',
      'message','Your order details or prices changed. Please review again.'),'quote',quote);
  end if;

  -- Translate trusted output to the EXISTING readable snapshot contract. No
  -- client monetary/label fields reach the legacy writer. No submission key is
  -- passed: key + v2 fingerprint attach atomically below, never a v1 hash.
  trusted := (intent-'items') || jsonb_build_object(
    'customer_phone',coalesce(submission_private.text_value(payload->'customer_phone',50),''),
    'subtotal',pricing->'subtotal','total',pricing->'subtotal',
    'delivery_fee_status',case when intent->>'fulfillment_type'='delivery' then 'to_confirm' else 'not_applicable' end,
    'items','[]'::jsonb);
  for line in select value from jsonb_array_elements(pricing->'items') loop
    -- Existing consumers render options as label -> string/string-array.
    -- Equal display names share a readable list; structured snapshots preserve
    -- their distinct group identities without exposing IDs in customer wording.
    select coalesce(jsonb_object_agg(group_label,labels),'{}'::jsonb) into options from (
      select o->>'group_name' group_label,
        jsonb_agg(o->>'label' order by o->>'choice_id') labels
      from jsonb_array_elements(line->'options') o group by o->>'group_name'
    ) grouped;
    trusted := jsonb_set(trusted,'{items}',(trusted->'items')||jsonb_build_array(jsonb_build_object(
      'product_id',line->'product_id','product_size_id',line->'product_size_id',
      'product_name',line->'product_name','category_name',line->'category_name',
      'variant_label',line->'size_label','quantity',line->'quantity','item_note',line->'item_note',
      'unit_price',line->'unit_price','line_total',line->'line_total','options',options,'sort_order',line->'line_index')));
  end loop;
  begin
    result := public.submit_public_order(trusted);
    update public.orders set public_submission_key=(prepared->>'submission_key')::uuid,
      public_submission_fingerprint=prepared->>'fingerprint',submission_fingerprint_version=2,
      pricing_contract_version=2,pricing_policy_version=pricing->>'pricing_policy_version',
      pricing_fingerprint_version=1,accepted_review_fingerprint=quote->>'review_fingerprint',priced_at=priced_at_value
      where order_number=result->>'order_number' and tracking_token=(result->>'tracking_token')::uuid
        and source='website' and public_submission_key is null returning id into created_id;
    if created_id is null then raise exception 'Unexpected writer result'; end if;
    for line in select value from jsonb_array_elements(pricing->'items') loop
      -- The legacy writer trims display strings. Restore the EXACT reviewed
      -- server labels alongside the snapshot before this transaction can commit.
      update public.order_items set product_name=line->>'product_name',category_name=line->>'category_name',
        variant_label=line->>'size_label',item_note=line->>'item_note',
        pricing_configuration_snapshot=line->'pricing_configuration_snapshot'
        where order_id=created_id and sort_order=(line->>'line_index')::integer;
      get diagnostics item_rows=row_count;
      if item_rows<>1 then raise exception 'Unexpected item mapping'; end if;
    end loop;
  exception when unique_violation then
    -- Entire attempted order/items/C1B work above has rolled back. Handle ONLY
    -- the named submission index; unexpected uniqueness errors stay generic.
    get stacked diagnostics constraint_hit=constraint_name;
    if constraint_hit<>'orders_public_submission_key_idx' then raise; end if;
    prepared := submission_private.replay_or_prepare(p_request);
    if prepared->>'state'='replay' then return prepared->'result'; end if;
    perform submission_private.reject('ORDER_RETRY_REQUIRED');
  end;
  return result;
exception when query_canceled then
  return jsonb_build_object('ok',false,'error',jsonb_build_object('code','ORDER_RETRY_REQUIRED','message','Please retry the same order request.'));
when others then
  -- This handler rolls back all work in the function, including link/metadata.
  get stacked diagnostics code=pg_exception_detail,state=returned_sqlstate;
  message := case code
    when 'CLIENT_UPDATE_REQUIRED' then 'Please refresh before starting a new order.'
    when 'ORDER_CART_INVALID' then 'Please review your cart and try again.'
    when 'QUANTITY_INVALID' then 'Please review the item quantities.'
    when 'PRODUCT_UNAVAILABLE' then 'One of the selected items is no longer available.'
    when 'SIZE_INVALID' then 'One of the selected sizes is no longer available.'
    when 'OPTION_INVALID' then 'One of the selected options is no longer available.'
    when 'OPTION_REQUIRED' then 'Please complete the required options.'
    when 'OPTION_SELECTION_INVALID' then 'Please review the selected options.'
    when 'CONFIGURATION_INVALID' then 'This item is temporarily unavailable. Please refresh the menu.'
    when 'ORDER_SUBMISSION_KEY_CONFLICT' then 'This request belongs to a different order. Review your existing order before starting another.'
    when 'ORDER_RETRY_REQUIRED' then 'Please retry the same order request.'
    when 'CURV_ORDERING_CLOSED' then 'Website ordering is currently unavailable.'
    when 'DINE_TIMING_REQUIRED' then 'Choose when we should prepare your order.'
    when 'DINE_TIMING_INVALID' then 'Choose a valid preparation time later today.'
    when 'DINE_TIMING_NOT_LATER_TODAY' then 'Choose a preparation time later today.'
    else null end;
  if message is null then
    if state='22023' then code:='ORDER_CART_INVALID';message:='Please review your cart and try again.';
    else code:='ORDER_INTERNAL_ERROR';message:='Unable to submit your order. Please try again.';end if;
  end if;
  return jsonb_build_object('ok',false,'error',jsonb_build_object('code',code,'message',message));
end $$;
revoke all on function public.submit_public_order_v2(jsonb) from public,anon,authenticated;
grant execute on function public.submit_public_order_v2(jsonb) to anon,authenticated;
commit;
