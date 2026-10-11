-- LOCAL DRAFT ONLY. Apply after D0A.1 / D0B1 / D0B2 / D0B3 review.
-- Stateless merchandise preview only; no submission replacement or data writes.
begin;
do $$
declare engine_oid oid := to_regprocedure('configuration_private.price_order_configuration(jsonb)');
begin
  if not exists(select 1 from pg_roles where rolname='anon')
    or not exists(select 1 from pg_roles where rolname='authenticated')
    or to_regprocedure('extensions.digest(bytea,text)') is null
    or not exists(select 1 from pg_proc where oid=engine_oid and not prosecdef
      and provolatile='s' and prorettype='jsonb'::regtype and proconfig=array['search_path=pg_catalog']) then
    raise exception 'D0B4 reviewed engine/role/digest prerequisite missing' using detail='D0B4_PREREQUISITE';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname='quote_public_cart')
       or (n.nspname='configuration_private' and p.proname='customer_pricing_review')) then
    raise exception 'D0B4 function collision; stop for review' using detail='D0B4_COLLISION';
  end if;
  if has_schema_privilege('anon','configuration_private','USAGE')
    or has_schema_privilege('authenticated','configuration_private','USAGE')
    or has_function_privilege('anon',engine_oid,'EXECUTE')
    or has_function_privilege('authenticated',engine_oid,'EXECUTE') then
    raise exception 'D0B4 private engine access mismatch' using detail='D0B4_PREREQUISITE';
  end if;
end $$;

-- Shared projection/hash contract for future D0B5. Input is a TRUSTED engine
-- result, never a client quote. Whitelisting prevents future engine metadata
-- additions from becoming public or silently changing the review contract.
create function configuration_private.customer_pricing_review(p_pricing jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
  with projected as materialized (
    select jsonb_build_object(
      'pricing_contract_version',p_pricing->'pricing_contract_version',
      'pricing_policy_version',p_pricing->'pricing_policy_version',
      'pricing_fingerprint_version',1,
      'currency',p_pricing->'currency',
      'subtotal',p_pricing->'subtotal',
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'line_index',i->'line_index','product_id',i->'product_id',
        'product_size_id',i->'product_size_id','option_choice_ids',i->'option_choice_ids',
        'quantity',i->'quantity','item_note',i->'item_note',
        'product_name',i->'product_name','category_name',i->'category_name','size_label',i->'size_label',
        'base_price',i->'base_price','option_total',i->'option_total',
        'unit_price',i->'unit_price','line_total',i->'line_total',
        'options',coalesce((select jsonb_agg(jsonb_build_object(
          'group_id',o->'group_id','group_key',o->'group_key','group_name',o->'group_name',
          'choice_id',o->'choice_id','label',o->'label','value',o->'value',
          'effective_price_delta',to_char((o->>'effective_price_delta')::numeric,'FM999999990.00')
        ) order by choice_position) from jsonb_array_elements(i->'options') with ordinality opts(o,choice_position)), '[]'::jsonb)
      ) order by line_position) from jsonb_array_elements(p_pricing->'items') with ordinality lines(i,line_position)), '[]'::jsonb)
    ) quote
  )
  select quote || jsonb_build_object('review_fingerprint',encode(extensions.digest(
    convert_to('CURV:PUBLIC_PRICING_REVIEW:v1:' || quote::text,'UTF8'),'sha256'),'hex'))
  from projected;
$$;
revoke all on function configuration_private.customer_pricing_review(jsonb) from public,anon,authenticated;

create function public.quote_public_cart(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare code text; message text;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or octet_length(p_request::text)>262144 then
    code := 'ORDER_CART_INVALID';
  elsif not (p_request ? 'pricing_contract_version') or not (p_request ? 'items')
    or p_request->'pricing_contract_version'<>'2'::jsonb
    or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('pricing_contract_version','items')) then
    code := 'ORDER_CART_INVALID';
  else
    begin
      return jsonb_build_object('ok',true,'quote',configuration_private.customer_pricing_review(
        configuration_private.price_order_configuration(p_request->'items')));
    exception
      when sqlstate '22023' then
        get stacked diagnostics code=pg_exception_detail;
      when query_canceled then code := 'PRICING_UNAVAILABLE';
      when others then code := 'PRICING_UNAVAILABLE';
    end;
  end if;
  message := case code
    when 'ORDER_CART_INVALID' then 'Please review your cart and try again.'
    when 'QUANTITY_INVALID' then 'Please review the item quantities.'
    when 'PRODUCT_UNAVAILABLE' then 'One of the selected items is no longer available.'
    when 'SIZE_INVALID' then 'One of the selected sizes is no longer available.'
    when 'OPTION_INVALID' then 'One of the selected options is no longer available.'
    when 'OPTION_REQUIRED' then 'Please complete the required options.'
    when 'OPTION_SELECTION_INVALID' then 'Please review the selected options.'
    when 'CONFIGURATION_INVALID' then 'This item is temporarily unavailable. Please refresh the menu.'
    else null end;
  if message is null then
    code := 'PRICING_UNAVAILABLE';
    message := 'Pricing is temporarily unavailable. Please try again.';
  end if;
  return jsonb_build_object('ok',false,'error',jsonb_build_object('code',code,'message',message));
end $$;
revoke all on function public.quote_public_cart(jsonb) from public,anon,authenticated;
grant execute on function public.quote_public_cart(jsonb) to anon,authenticated;
commit;
