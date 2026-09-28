-- Draft only. Requires O10/O12/O14 + C1B and the companion schema.
-- Patches the installed function; preserves ownership, ACL, search_path and replay branches.
begin;
do $patch$
declare
  v_oid oid := to_regprocedure('public.submit_public_order(jsonb)');
  v_definition text;
  v_old text;
  v_new text;
begin
  if v_oid is null then raise exception 'Submission RPC missing.'; end if;
  if not exists(select 1 from pg_proc where oid=v_oid and prosecdef and proowner=(select oid from pg_roles where rolname=current_user)) then
    raise exception 'Run as the existing SECURITY DEFINER function owner.';
  end if;
  perform preparation_timing, requested_preparation_at from public.orders limit 0;
  select pg_get_functiondef(v_oid) into v_definition;
  if position('public_submission_key' in v_definition)=0 or position('CURV_ORDERING_CLOSED' in v_definition)=0
    or position('dine_in' in v_definition)=0 or position('perform customer_private.link_website_order(v_order_id);' in v_definition)=0 then
    raise exception 'Expected O10/O12/O14/C1B submission prerequisites missing.';
  end if;
  if position('-- Structured dine-in timing:' in v_definition)>0 then return; end if;
  v_old := $old$  v_customer_phone text :=$old$;
  v_new := $new$  v_preparation_timing text;
  v_requested_preparation_at timestamptz;
  v_customer_phone text :=$new$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'Dine-in timing patch anchor mismatch; review installed RPC.';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$  if v_customer_phone = '' then$old$;
  v_new := $new$  if v_customer_phone = '' and v_fulfillment_type <> 'dine_in' then$new$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'Dine-in timing patch anchor mismatch; review installed RPC.';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$  -- Server-generated order number.$old$;
  v_new := $new$  -- Structured dine-in timing: validate only genuinely new submissions, after replay.
  if v_fulfillment_type = 'dine_in' then
    v_preparation_timing := v_payload ->> 'preparation_timing';
    if v_preparation_timing is null or v_preparation_timing not in ('asap','scheduled') then
      raise exception 'Choose when we should prepare your order.' using errcode='22023', detail='DINE_TIMING_REQUIRED';
    end if;
    if v_preparation_timing = 'asap' then
      if nullif(v_payload ->> 'requested_preparation_at','') is not null then
        raise exception 'ASAP must not include a scheduled time.' using errcode='22023', detail='DINE_TIMING_INVALID';
      end if;
    else
      -- Require an explicit offset, never interpret a timestamp in the session timezone.
      if coalesce(v_payload ->> 'requested_preparation_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then
        raise exception 'Choose a valid preparation time later today.' using errcode='22023', detail='DINE_TIMING_INVALID';
      end if;
      begin
        v_requested_preparation_at := (v_payload ->> 'requested_preparation_at')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Choose a valid preparation time later today.' using errcode='22023', detail='DINE_TIMING_INVALID';
      end;
      if v_requested_preparation_at <= clock_timestamp()
        or (v_requested_preparation_at at time zone 'Asia/Manila')::date <> (clock_timestamp() at time zone 'Asia/Manila')::date then
        raise exception 'Choose a preparation time later today.' using errcode='22023', detail='DINE_TIMING_NOT_LATER_TODAY';
      end if;
    end if;
    v_pickup_time := null;
    v_payment_method := 'counter';
  elsif nullif(v_payload ->> 'preparation_timing','') is not null
    or nullif(v_payload ->> 'requested_preparation_at','') is not null then
    raise exception 'Preparation timing is only supported for dine-in.' using errcode='22023', detail='DINE_TIMING_INVALID';
  end if;

  -- Server-generated order number.$new$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'Dine-in timing patch anchor mismatch; review installed RPC.';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$        pickup_time,$old$;
  v_new := $new$        preparation_timing,
        requested_preparation_at,
        pickup_time,$new$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'Dine-in timing patch anchor mismatch; review installed RPC.';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$        v_pickup_time,$old$;
  v_new := $new$        v_preparation_timing,
        v_requested_preparation_at,
        v_pickup_time,$new$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'Dine-in timing patch anchor mismatch; review installed RPC.';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
end;
$patch$;
commit;
