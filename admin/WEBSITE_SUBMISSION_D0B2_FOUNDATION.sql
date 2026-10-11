-- LOCAL DRAFT ONLY. Requires D0B1, C1B and structured dine-in timing.
-- Private, inactive foundation. NO public submission replacement or pricing API.
begin;
do $$
declare r record; definition text;
begin
  if to_regnamespace('submission_private') is not null then
    raise exception 'D0B2 namespace collision; review existing objects' using detail='D0B2_COLLISION';
  end if;
  if not exists(select 1 from pg_roles where rolname='anon') or not exists(select 1 from pg_roles where rolname='authenticated')
    or to_regprocedure('extensions.digest(bytea,text)') is null
    or to_regprocedure('extensions.digest(text,text)') is null
    or to_regprocedure('customer_private.normalize_phone(text)') is null
    or to_regprocedure('configuration_private.assert_pricing_ready(uuid)') is null
    or to_regprocedure('public.submit_public_order(jsonb)') is null then
    raise exception 'D0B2 function/role prerequisite missing' using detail='D0B2_PREREQUISITE';
  end if;
  for r in select * from (values
    ('orders','public_submission_key','uuid'),('orders','public_submission_fingerprint','text'),
    ('orders','submission_fingerprint_version','smallint'),('orders','pricing_contract_version','smallint'),
    ('orders','order_number','text'),('orders','tracking_token','uuid'),('orders','source','text'),
    ('orders','preparation_timing','text'),('orders','requested_preparation_at','timestamp with time zone')
  ) v(tbl,col,typ) loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name=r.col and data_type=r.typ) then
      raise exception 'D0B2 missing/incompatible column %.%',r.tbl,r.col using detail='D0B2_PREREQUISITE';
    end if;
  end loop;
  if not exists(select 1 from pg_index where indexrelid=to_regclass('public.orders_public_submission_key_idx')
    and indrelid='public.orders'::regclass and indisunique and indisvalid and indisready and indnkeyatts=1
    and pg_get_indexdef(indexrelid,1,true)='public_submission_key'
    and pg_get_expr(indpred,indrelid)='(public_submission_key IS NOT NULL)')
    or not exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='d0b1_order_pricing_metadata' and convalidated) then
    raise exception 'D0B2 metadata/idempotency prerequisite missing' using detail='D0B2_PREREQUISITE';
  end if;
  select pg_get_functiondef(oid) into definition from pg_proc where oid=to_regprocedure('public.submit_public_order(jsonb)') and prosecdef;
  if definition is null or position('CURV_ORDERING_CLOSED' in definition)=0
    or position('-- Structured dine-in timing:' in definition)=0
    or position('perform customer_private.link_website_order(v_order_id);' in definition)=0 then
    raise exception 'D0B2 expected submission baseline missing' using detail='D0B2_PREREQUISITE';
  end if;
end $$;
create schema submission_private;
revoke all on schema submission_private from public,anon,authenticated;

-- No payload, hash, lock ID or SQL details in expected error messages.
create function submission_private.reject(p_code text) returns void
language plpgsql set search_path=pg_catalog as $$
begin
  case p_code
    when 'ORDER_CART_INVALID' then raise exception 'Please check your order details.' using errcode='22023',detail='ORDER_CART_INVALID';
    when 'CLIENT_UPDATE_REQUIRED' then raise exception 'Please refresh before starting a new order.' using errcode='P0001',detail='CLIENT_UPDATE_REQUIRED';
    when 'ORDER_SUBMISSION_KEY_CONFLICT' then raise exception 'This request belongs to a different order. Review your existing order before starting another.' using errcode='P0001',detail='ORDER_SUBMISSION_KEY_CONFLICT';
    when 'ORDER_RETRY_REQUIRED' then raise exception 'Please retry the same order request.' using errcode='55P03',detail='ORDER_RETRY_REQUIRED';
    else raise exception 'Unable to process this order.' using errcode='P0001',detail='ORDER_INTERNAL_ERROR';
  end case;
end $$;

create function submission_private.text_value(p_value jsonb,p_limit integer) returns text
language plpgsql immutable set search_path=pg_catalog as $$
declare result text;
begin
  if p_value is null or p_value='null'::jsonb then return null; end if;
  if jsonb_typeof(p_value)<>'string' then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  -- Trim only boundary ASCII whitespace. Preserve internal spacing, case,
  -- punctuation, line breaks, accents and Unicode normalization form.
  result:=nullif(btrim(p_value#>>'{}',E' \t\r\n\f\013'),'');
  if length(result)>p_limit then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  return result;
end $$;

create function submission_private.uuid_value(p_value jsonb) returns uuid
language plpgsql immutable set search_path=pg_catalog as $$
declare result uuid; value text;
begin
  value:=submission_private.text_value(p_value,50);
  if value is null then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  begin result:=value::uuid;
  exception when invalid_text_representation then perform submission_private.reject('ORDER_CART_INVALID'); end;
  return result;
end $$;

-- Freeze the current C1B supported-phone rules into fingerprint version 2.
-- Future CRM normalization changes must not change historical intent hashes.
create function submission_private.normalize_phone_v2(p_phone text) returns text
language sql immutable strict set search_path=pg_catalog as $$
  select case
    when btrim(p_phone) ~ '^09[0-9]{9}$' then '+63'||substring(btrim(p_phone) from 2)
    when btrim(p_phone) ~ '^639[0-9]{9}$' then '+'||btrim(p_phone)
    when btrim(p_phone) ~ '^\+639[0-9]{9}$' then btrim(p_phone)
    else null end;
$$;

create function submission_private.canonicalize_v2_intent(p_payload jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog set timezone='UTC' set datestyle='ISO, YMD' as $$
declare
  item jsonb; choice jsonb; choice_ids uuid[]; choice_id uuid; product_id uuid; size_id uuid;
  lines jsonb:='[]'; merged jsonb; quantity numeric; item_note text;
  customer_name text; phone text; customer_email text; fulfillment text; payment text; notes text;
  address text; alternate text; delivery_option text; pickup_time text; timing text; requested text; requested_at timestamptz;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>262144 then
    perform submission_private.reject('ORDER_CART_INVALID');
  end if;
  if p_payload->'pricing_contract_version' is distinct from '2'::jsonb then perform submission_private.reject('CLIENT_UPDATE_REQUIRED'); end if;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(array[
    'pricing_contract_version','submission_key','customer_name','customer_phone','customer_email','fulfillment_type',
    'delivery_option','delivery_address','customer_address','pickup_time','preferred_time','payment_method','customer_notes',
    'preparation_timing','requested_preparation_at','items','currency',
    'subtotal','total','unit_price','line_total','delivery_fee','delivery_fee_status','review_fingerprint',
    'pricing_snapshot','pricing_policy_version','pricing_fingerprint_version','submission_fingerprint_version',
    'accepted_review_fingerprint','priced_at','generated_at','submitted_at','created_at','updated_at','ui_state'])) then
    perform submission_private.reject('ORDER_CART_INVALID');
  end if;
  customer_name:=submission_private.text_value(p_payload->'customer_name',200);
  phone:=submission_private.text_value(p_payload->'customer_phone',50);
  phone:=coalesce(submission_private.normalize_phone_v2(phone),phone);
  customer_email:=submission_private.text_value(p_payload->'customer_email',254);
  fulfillment:=lower(submission_private.text_value(p_payload->'fulfillment_type',20) collate "C");
  payment:=lower(submission_private.text_value(p_payload->'payment_method',50) collate "C");
  notes:=submission_private.text_value(p_payload->'customer_notes',1000);
  if customer_name is null or fulfillment is null or fulfillment not in ('delivery','pickup','dine_in')
    or (fulfillment<>'dine_in' and phone is null) then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  if p_payload ? 'currency' and upper(coalesce(submission_private.text_value(p_payload->'currency',3),'PHP') collate "C")<>'PHP' then
    perform submission_private.reject('ORDER_CART_INVALID');
  end if;
  address:=submission_private.text_value(p_payload->'delivery_address',1000);
  alternate:=submission_private.text_value(p_payload->'customer_address',1000);
  if address is not null and alternate is not null and address<>alternate then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  address:=coalesce(address,alternate);
  delivery_option:=lower(submission_private.text_value(p_payload->'delivery_option',30) collate "C");
  if fulfillment='delivery' then
    if address is null or delivery_option is null or delivery_option not in ('curv_rider','lalamove') then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  else address:=null; delivery_option:=null; end if;
  pickup_time:=submission_private.text_value(p_payload->'pickup_time',120);
  alternate:=submission_private.text_value(p_payload->'preferred_time',120);
  if pickup_time is not null and alternate is not null and pickup_time<>alternate then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  pickup_time:=coalesce(pickup_time,alternate);
  timing:=lower(submission_private.text_value(p_payload->'preparation_timing',20) collate "C");
  requested:=submission_private.text_value(p_payload->'requested_preparation_at',50);
  if fulfillment='dine_in' then
    pickup_time:=null;
    if timing is null or timing not in ('asap','scheduled') or (timing='asap' and requested is not null) then perform submission_private.reject('ORDER_CART_INVALID'); end if;
    if timing='scheduled' then
      -- Explicit offset and <= microsecond precision; never round away intent.
      if requested is null or requested !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' then perform submission_private.reject('ORDER_CART_INVALID'); end if;
      begin requested_at:=requested::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then perform submission_private.reject('ORDER_CART_INVALID'); end;
      requested:=to_char(requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    end if;
  elsif timing is not null or requested is not null then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  -- No now(), ordering status, catalog, pricing, phone ownership or availability
  -- validation here: successful replay must survive changes in all of them.
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  if jsonb_array_length(p_payload->'items') not between 1 and 30 then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    if jsonb_typeof(item)<>'object' then perform submission_private.reject('ORDER_CART_INVALID'); end if;
    if exists(select 1 from jsonb_object_keys(item) k where k<>all(array[
      'product_id','product_size_id','option_choice_ids','quantity','item_note',
      'product_name','name','category_name','variant_label','size_label','unit_price','line_total',
      'options','option_snapshots','sort_order','pricing_configuration_snapshot','pricing_policy_version','ui_state'])) then
      perform submission_private.reject('ORDER_CART_INVALID');
    end if;
    product_id:=submission_private.uuid_value(item->'product_id'); size_id:=submission_private.uuid_value(item->'product_size_id');
    if jsonb_typeof(item->'option_choice_ids') is distinct from 'array' then perform submission_private.reject('ORDER_CART_INVALID'); end if;
    if jsonb_array_length(item->'option_choice_ids')>64 then perform submission_private.reject('ORDER_CART_INVALID'); end if;
    choice_ids:='{}';
    for choice in select value from jsonb_array_elements(item->'option_choice_ids') loop
      choice_id:=submission_private.uuid_value(choice);
      if choice_id=any(choice_ids) then perform submission_private.reject('ORDER_CART_INVALID'); end if;
      choice_ids:=array_append(choice_ids,choice_id);
    end loop;
    select coalesce(array_agg(v order by v),'{}'::uuid[]) into choice_ids from unnest(choice_ids) v;
    if jsonb_typeof(item->'quantity') is distinct from 'number' then perform submission_private.reject('ORDER_CART_INVALID'); end if;
    quantity:=(item->>'quantity')::numeric;
    if quantity<1 or quantity>2147483647 or quantity<>trunc(quantity) then perform submission_private.reject('ORDER_CART_INVALID'); end if;
    item_note:=submission_private.text_value(item->'item_note',500);
    lines:=lines||jsonb_build_array(jsonb_build_object('product_id',product_id,'product_size_id',size_id,
      'option_choice_ids',choice_ids,'quantity',quantity::integer,'item_note',item_note));
  end loop;
  if exists(select 1 from jsonb_array_elements(lines) l group by l-'quantity' having sum((l->>'quantity')::numeric)>2147483647) then
    perform submission_private.reject('ORDER_CART_INVALID');
  end if;
  select jsonb_agg(config||jsonb_build_object('quantity',amount) order by config::text collate "C") into merged
    from (select l-'quantity' config,sum((l->>'quantity')::numeric)::integer amount from jsonb_array_elements(lines) l group by l-'quantity') grouped;
  return jsonb_build_object('pricing_contract_version',2,'currency','PHP','customer_name',customer_name,
    'customer_phone',phone,'customer_email',customer_email,'fulfillment_type',fulfillment,
    'delivery_option',delivery_option,'delivery_address',address,'pickup_time',pickup_time,'payment_method',payment,
    'customer_notes',notes,'preparation_timing',timing,'requested_preparation_at',requested,'items',merged);
end $$;

create function submission_private.fingerprint_v2_intent(p_payload jsonb) returns text
language sql stable set search_path=pg_catalog as $$
  select encode(extensions.digest(convert_to('curv.intent.v2'||chr(10)||submission_private.canonicalize_v2_intent(p_payload)::text,'UTF8'),'sha256'),'hex');
$$;

create function submission_private.fingerprint_v1_payload(p_payload jsonb) returns text
language plpgsql immutable set search_path=pg_catalog as $$
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>1048576 then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  -- EXACT O10 expression. No field stripping, normalization or new hash prefix.
  return encode(extensions.digest((p_payload-'submission_key')::text,'sha256'),'hex');
end $$;

create function submission_private.lock_submission_key(p_key uuid) returns void
language plpgsql volatile set search_path=pg_catalog as $$
declare lock_id bigint; deadline timestamptz:=clock_timestamp()+interval '1 second';
begin
  if p_key is null then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  -- A waiting caller needs a fresh post-lock snapshot, not a Repeatable Read one.
  if current_setting('transaction_isolation')<>'read committed' then perform submission_private.reject('ORDER_RETRY_REQUIRED'); end if;
  lock_id:=('x'||substr(encode(extensions.digest(convert_to('curv.submission.lock.v2:'||p_key::text,'UTF8'),'sha256'),'hex'),1,16))::bit(64)::bigint;
  loop
    if pg_try_advisory_xact_lock(lock_id) then return; end if;
    if clock_timestamp()>=deadline then perform submission_private.reject('ORDER_RETRY_REQUIRED'); end if;
    perform pg_sleep(0.01);
  end loop;
end $$;

-- Future privileged wrapper uses {payload: <frozen submission>, client_context: {...}}.
-- Metadata outside payload cannot alter a legacy raw fingerprint. No public route
-- accepts this envelope yet. Never rebuild legacy payload from a newer cart.
create function submission_private.replay_or_prepare(p_request jsonb) returns jsonb
language plpgsql volatile set search_path=pg_catalog as $$
declare payload jsonb; key uuid; existing record; fingerprint text; canonical jsonb;
begin
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>1048576 then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  if exists(select 1 from jsonb_object_keys(p_request) k where k not in ('payload','client_context'))
    or (p_request ? 'client_context' and jsonb_typeof(p_request->'client_context') not in ('object','null')) then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  payload:=p_request->'payload';
  if jsonb_typeof(payload) is distinct from 'object' then perform submission_private.reject('ORDER_CART_INVALID'); end if;
  key:=submission_private.uuid_value(payload->'submission_key');
  perform submission_private.lock_submission_key(key);
  select o.order_number,o.tracking_token,o.public_submission_fingerprint,o.submission_fingerprint_version,o.source
    into existing from public.orders o where o.public_submission_key=key;
  if found then
    if existing.source is distinct from 'website' or existing.tracking_token is null then perform submission_private.reject('ORDER_INTERNAL_ERROR'); end if;
    case coalesce(existing.submission_fingerprint_version,1)
      when 1 then fingerprint:=submission_private.fingerprint_v1_payload(payload);
      when 2 then fingerprint:=submission_private.fingerprint_v2_intent(payload);
      else perform submission_private.reject('ORDER_INTERNAL_ERROR');
    end case;
    if fingerprint is distinct from existing.public_submission_fingerprint then perform submission_private.reject('ORDER_SUBMISSION_KEY_CONFLICT'); end if;
    return jsonb_build_object('state','replay','result',jsonb_build_object('order_number',existing.order_number,'tracking_token',existing.tracking_token));
  end if;
  canonical:=submission_private.canonicalize_v2_intent(payload);
  -- INTERNAL ONLY. Future wrapper must never return canonical PII or hashes.
  -- Caller must keep this transaction open through validation/pricing/insertion.
  return jsonb_build_object('state','new','submission_key',key,'submission_fingerprint_version',2,
    'intent',canonical,'fingerprint',submission_private.fingerprint_v2_intent(payload));
end $$;
revoke all on all functions in schema submission_private from public,anon,authenticated;
commit;
