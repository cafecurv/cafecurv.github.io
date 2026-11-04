-- LOCAL REVIEW DRAFT ONLY. Installs disabled; no identity enrollment or activation.
begin;
do $$begin if to_regclass('kiosk_private.devices') is null or to_regprocedure('public.kiosk_context()') is not null then raise exception 'Kiosk schema missing/backend collision';end if;end $$;
create function kiosk_private.reject(code text) returns void language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Kiosk request cannot continue. Ask CURV staff for assistance.' using errcode='P0001',detail=code;end $$;

create function kiosk_private.actor() returns kiosk_private.devices language plpgsql security definer set search_path=pg_catalog as $$
declare d kiosk_private.devices%rowtype;s uuid;claims jsonb;mode text;
begin
 claims:=auth.jwt();
 if auth.uid() is null then perform kiosk_private.reject('KIOSK_AUTH_REQUIRED');end if;
 if exists(select 1 from public.admin_profiles where id=auth.uid()) or exists(select 1 from public.pos_staff_access where user_id=auth.uid()) then perform kiosk_private.reject('KIOSK_NONSTAFF_REQUIRED');end if;
 select x.mode into mode from kiosk_private.settings x where id for share;
 if mode is null or mode='off' then perform kiosk_private.reject('KIOSK_DISABLED');end if;
 select * into d from kiosk_private.devices where principal=auth.uid() for share;
 if not found or not d.active or d.valid_until<=clock_timestamp() then perform kiosk_private.reject('KIOSK_DEVICE_UNAVAILABLE');end if;
 begin s:=(claims->>'session_id')::uuid;exception when others then perform kiosk_private.reject('KIOSK_SESSION_REQUIRED');end;
 if s is null or not exists(select 1 from auth.sessions where id=s and user_id=auth.uid()) then perform kiosk_private.reject('KIOSK_SESSION_REQUIRED');end if;
 return d;
end $$;

create function kiosk_private.canonical(p jsonb) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare nick text;kind text;item jsonb;choice jsonb;choices uuid[];cid uuid;pid uuid;sid uuid;quantity numeric;note text;lines jsonb:='[]';merged jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144 or
  exists(select 1 from jsonb_object_keys(p) k where k not in ('kiosk_contract_version','submission_key','customer_name','fulfillment_type','items','customer_notes','review_fingerprint'))
  or p->'kiosk_contract_version' is distinct from '1'::jsonb then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
 nick:=submission_private.text_value(p->'customer_name',80);kind:=p->>'fulfillment_type';
 if nick is null or nick ~ '[[:cntrl:]]' or kind is null or kind not in ('dine_in','pickup') then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
 if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') not between 1 and 30 then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
 for item in select value from jsonb_array_elements(p->'items') loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('product_id','product_size_id','option_choice_ids','quantity','item_note')) then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
  pid:=submission_private.uuid_value(item->'product_id');sid:=submission_private.uuid_value(item->'product_size_id');
  if jsonb_typeof(item->'option_choice_ids') is distinct from 'array' or jsonb_array_length(item->'option_choice_ids')>64 then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
  choices:='{}';for choice in select value from jsonb_array_elements(item->'option_choice_ids') loop
   cid:=submission_private.uuid_value(choice);if cid=any(choices) then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;choices:=array_append(choices,cid);
  end loop;
  select coalesce(array_agg(x order by x),'{}'::uuid[]) into choices from unnest(choices) x;
  if jsonb_typeof(item->'quantity') is distinct from 'number' then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
  quantity:=(item->>'quantity')::numeric;if quantity<1 or quantity>2147483647 or quantity<>trunc(quantity) then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
  note:=submission_private.text_value(item->'item_note',500);
  lines:=lines||jsonb_build_array(jsonb_build_object('product_id',pid,'product_size_id',sid,'option_choice_ids',choices,'quantity',quantity::integer,'item_note',note));
 end loop;
 if exists(select 1 from jsonb_array_elements(lines) l group by l-'quantity' having sum((l->>'quantity')::numeric)>2147483647) then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
 select jsonb_agg(config||jsonb_build_object('quantity',amount) order by config::text collate "C") into merged from
  (select l-'quantity' config,sum((l->>'quantity')::numeric)::integer amount from jsonb_array_elements(lines) l group by l-'quantity') x;
 return jsonb_build_object('kiosk_contract_version',1,'customer_name',nick,'fulfillment_type',kind,'items',merged,
  'customer_notes',submission_private.text_value(p->'customer_notes',1000),'payment_method','counter','currency','PHP');
end $$;

create function kiosk_private.generation(g uuid,d uuid) returns kiosk_private.generations language plpgsql set search_path=pg_catalog as $$
declare row kiosk_private.generations%rowtype;begin
 select * into row from kiosk_private.generations where id=g and device=d for update;
 if not found then perform kiosk_private.reject('KIOSK_GENERATION_CONFLICT');end if;return row;
end $$;

create function public.kiosk_context() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d kiosk_private.devices%rowtype;g kiosk_private.generations%rowtype;a kiosk_private.attempts%rowtype;begin
 d:=kiosk_private.actor();select * into g from kiosk_private.generations where device=d.id and closed_at is null;
 if g.id is not null then select * into a from kiosk_private.attempts where generation=g.id;end if;
 return jsonb_build_object('contract_version',1,'device_id',d.id,'valid_until',d.valid_until,'generation_id',g.id,
  'state',coalesce(a.state,'draft'),'submission_key',a.key,'receipt',a.receipt,'accepted_at',a.accepted_at);
end $$;
create function public.kiosk_begin() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d kiosk_private.devices%rowtype;g uuid;begin
 d:=kiosk_private.actor();perform pg_advisory_xact_lock(hashtextextended('curv.kiosk.generation:'||d.id,0));
 select id into g from kiosk_private.generations where device=d.id and closed_at is null;
 if g is null then
  if d.drain or (select mode from kiosk_private.settings where id)<>'on' then perform kiosk_private.reject('KIOSK_DRAINING');end if;
  insert into kiosk_private.generations(device) values(d.id) returning id into g;
 end if;return jsonb_build_object('generation_id',g,'device_id',d.id);
end $$;
create function public.kiosk_quote(p_generation uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d kiosk_private.devices%rowtype;g kiosk_private.generations%rowtype;c jsonb;begin
 d:=kiosk_private.actor();g:=kiosk_private.generation(p_generation,d.id);if g.closed_at is not null then perform kiosk_private.reject('KIOSK_GENERATION_CLOSED');end if;
 c:=kiosk_private.canonical(p_payload);
 return jsonb_build_object('ok',true,'quote',configuration_private.customer_pricing_review(configuration_private.price_order_configuration(c->'items')));
end $$;
create function public.kiosk_admit(p_generation uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d kiosk_private.devices%rowtype;g kiosk_private.generations%rowtype;a kiosk_private.attempts%rowtype;c jsonb;k uuid;h text;begin
 d:=kiosk_private.actor();g:=kiosk_private.generation(p_generation,d.id);if g.closed_at is not null then perform kiosk_private.reject('KIOSK_GENERATION_CLOSED');end if;
 c:=kiosk_private.canonical(p_payload);k:=submission_private.uuid_value(p_payload->'submission_key');
 if jsonb_typeof(p_payload->'review_fingerprint') is distinct from 'string' or (p_payload->>'review_fingerprint') !~ '^[a-f0-9]{64}$' then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
 perform submission_private.lock_submission_key(k);
 h:=encode(extensions.digest(convert_to('CURV:KIOSK:INTENT:1:'||jsonb_build_object('device',d.id,'generation',g.id,'intent',c)::text,'UTF8'),'sha256'),'hex');
 select * into a from kiosk_private.attempts where key=k;
 if found then
  if a.device<>d.id or a.generation<>g.id or a.fingerprint<>h then perform kiosk_private.reject('KIOSK_KEY_CONFLICT');end if;
  if a.request is distinct from p_payload then
   if a.state<>'price_changed' or (a.request-'review_fingerprint')<>(p_payload-'review_fingerprint') then perform kiosk_private.reject('KIOSK_KEY_CONFLICT');end if;
   update kiosk_private.attempts set request=p_payload,state='admitted' where key=k;
  end if;
 else
  if d.drain or (select mode from kiosk_private.settings where id)<>'on' then perform kiosk_private.reject('KIOSK_DRAINING');end if;
  if exists(select 1 from public.orders where public_submission_key=k) or exists(select 1 from kiosk_private.attempts where generation=g.id) then perform kiosk_private.reject('KIOSK_KEY_CONFLICT');end if;
  insert into kiosk_private.attempts(key,generation,device,intent,request,fingerprint) values(k,g.id,d.id,c,p_payload,h);
 end if;
 return jsonb_build_object('state','admitted','submission_key',k);
end $$;

create function kiosk_private.submit(g uuid,k uuid) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare d kiosk_private.devices%rowtype;gen kiosk_private.generations%rowtype;a kiosk_private.attempts%rowtype;pricing jsonb;quote jsonb;line jsonb;oid uuid;num text;token uuid;opts jsonb;result jsonb;
begin
 d:=kiosk_private.actor();gen:=kiosk_private.generation(g,d.id);if gen.closed_at is not null then perform kiosk_private.reject('KIOSK_GENERATION_CLOSED');end if;
 perform submission_private.lock_submission_key(k);select * into a from kiosk_private.attempts where key=k and generation=g and device=d.id for update;
 if not found then perform kiosk_private.reject('KIOSK_ATTEMPT_REQUIRED');end if;
 if a.state='accepted' then return jsonb_build_object('state','accepted','receipt',a.receipt,'accepted_at',a.accepted_at);end if;
 if exists(select 1 from public.orders where public_submission_key=k) then perform kiosk_private.reject('KIOSK_KEY_CONFLICT');end if;
 if not coalesce((select website_ordering_enabled from public.store_settings where id),false) then perform kiosk_private.reject('CURV_ORDERING_CLOSED');end if;
 pricing:=configuration_private.price_order_configuration(a.intent->'items');quote:=configuration_private.customer_pricing_review(pricing);
 if a.request->>'review_fingerprint' is distinct from quote->>'review_fingerprint' then
  update kiosk_private.attempts set state='price_changed' where key=k;
  return jsonb_build_object('state','price_changed','quote',quote);
 end if;
 begin
  num:='C-'||nextval('public.order_number_seq');token:=gen_random_uuid();
  insert into public.orders(order_number,customer_name,customer_phone,customer_email,fulfillment_type,preparation_timing,requested_preparation_at,pickup_time,
   customer_notes,subtotal,total,currency,payment_method,payment_status,source,tracking_token,delivery_fee_status,
   public_submission_key,public_submission_fingerprint,submission_fingerprint_version,pricing_contract_version,pricing_policy_version,pricing_fingerprint_version,accepted_review_fingerprint,priced_at)
  values(num,a.intent->>'customer_name','',null,a.intent->>'fulfillment_type',case when a.intent->>'fulfillment_type'='dine_in' then 'asap' end,null,
   case when a.intent->>'fulfillment_type'='pickup' then 'ASAP' end,a.intent->>'customer_notes',(pricing->>'subtotal')::numeric,(pricing->>'subtotal')::numeric,
   'PHP','counter','unpaid','website',token,'not_applicable',k,a.fingerprint,3,2,pricing->>'pricing_policy_version',1,quote->>'review_fingerprint',clock_timestamp()) returning id into oid;
  for line in select value from jsonb_array_elements(pricing->'items') loop
   select coalesce(jsonb_object_agg(label,vals),'{}') into opts from (select o->>'group_name' label,jsonb_agg(o->>'label' order by o->>'choice_id') vals from jsonb_array_elements(line->'options') o group by o->>'group_name') x;
   insert into public.order_items(order_id,product_id,product_size_id,product_name,category_name,variant_label,quantity,unit_price,line_total,options,item_note,sort_order,pricing_configuration_snapshot)
   values(oid,(line->>'product_id')::uuid,(line->>'product_size_id')::uuid,line->>'product_name',line->>'category_name',line->>'size_label',
    (line->>'quantity')::integer,(line->>'unit_price')::numeric,(line->>'line_total')::numeric,opts,line->>'item_note',(line->>'line_index')::integer,line->'pricing_configuration_snapshot');
  end loop;
  insert into kiosk_private.provenance values(oid,k,d.id,g,a.fingerprint,1);
  result:=jsonb_build_object('order_number',num);
  update kiosk_private.attempts set state='accepted',receipt=result,accepted_at=clock_timestamp() where key=k returning * into a;
  insert into kiosk_private.audit(event,actor,key,device) values('accepted',auth.uid(),k,d.id);
 exception when unique_violation then
  -- Legacy v1 does not share the advisory lock. Its unique-index winner
  -- must roll back this entire subtransaction, never become a kiosk replay.
  perform kiosk_private.reject('KIOSK_KEY_CONFLICT');
 end;
 return jsonb_build_object('state','accepted','receipt',result,'accepted_at',a.accepted_at);
end $$;
create function public.kiosk_submit(p_generation uuid,p_key uuid) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$select kiosk_private.submit(p_generation,p_key)$$;
create function public.kiosk_confirm_price(p_generation uuid,p_key uuid,p_review text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d kiosk_private.devices%rowtype;g kiosk_private.generations%rowtype;a kiosk_private.attempts%rowtype;q jsonb;begin
 d:=kiosk_private.actor();g:=kiosk_private.generation(p_generation,d.id);if g.closed_at is not null then perform kiosk_private.reject('KIOSK_GENERATION_CLOSED');end if;
 perform submission_private.lock_submission_key(p_key);select * into a from kiosk_private.attempts where key=p_key and generation=g.id and device=d.id for update;
 if not found then perform kiosk_private.reject('KIOSK_ATTEMPT_REQUIRED');end if;
 if a.state='accepted' then return jsonb_build_object('state','accepted','receipt',a.receipt,'accepted_at',a.accepted_at);end if;
 if a.state='admitted' and a.request->>'review_fingerprint'=p_review then return jsonb_build_object('state','admitted');end if;
 if a.state<>'price_changed' or p_review is null or p_review !~ '^[a-f0-9]{64}$' then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
 q:=configuration_private.customer_pricing_review(configuration_private.price_order_configuration(a.intent->'items'));
 if q->>'review_fingerprint'<>p_review then return jsonb_build_object('state','price_changed','quote',q);end if;
 update kiosk_private.attempts set request=jsonb_set(request,'{review_fingerprint}',to_jsonb(p_review)),state='admitted' where key=p_key;
 return jsonb_build_object('state','admitted');end $$;
create function public.kiosk_recover(p_generation uuid,p_key uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d kiosk_private.devices%rowtype;g kiosk_private.generations%rowtype;a kiosk_private.attempts%rowtype;begin
 d:=kiosk_private.actor();g:=kiosk_private.generation(p_generation,d.id);
 if g.closed_at is not null then return jsonb_build_object('state','closed');end if;
 perform submission_private.lock_submission_key(p_key);select * into a from kiosk_private.attempts where key=p_key and generation=g.id and device=d.id;
 if not found then return jsonb_build_object('state','unknown');end if;
 return jsonb_build_object('state',a.state,'receipt',a.receipt,'accepted_at',a.accepted_at);
end $$;
create function public.kiosk_close(p_generation uuid,p_draft boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d kiosk_private.devices%rowtype;g kiosk_private.generations%rowtype;a kiosk_private.attempts%rowtype;begin
 d:=kiosk_private.actor();g:=kiosk_private.generation(p_generation,d.id);
 if g.closed_at is not null then return jsonb_build_object('state','closed');end if;
 select * into a from kiosk_private.attempts where generation=g.id;
 if p_draft then if a.key is not null then perform kiosk_private.reject('KIOSK_UNCERTAIN');end if;
 elsif a.state is distinct from 'accepted' then perform kiosk_private.reject('KIOSK_UNCERTAIN');end if;
 update kiosk_private.generations set closed_at=clock_timestamp() where id=g.id;
 insert into kiosk_private.audit(event,actor,key,device) values(case when p_draft then 'draft_closed' else 'customer_done' end,auth.uid(),a.key,d.id);
 return jsonb_build_object('state','closed');
end $$;

create function kiosk_private.owner() returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) or not exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid()) then perform kiosk_private.reject('KIOSK_OWNER_REQUIRED');end if;end $$;
create function public.kiosk_owner_mode(p_mode text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$begin
 perform kiosk_private.owner();if p_mode is null or p_mode not in ('off','on','drain') then perform kiosk_private.reject('KIOSK_INPUT_INVALID');end if;
 update kiosk_private.settings set mode=p_mode where id;insert into kiosk_private.audit(event,actor) values('mode_'||p_mode,auth.uid());return jsonb_build_object('mode',p_mode);end $$;
create function public.kiosk_owner_device(p_principal uuid,p_active boolean,p_valid_until timestamptz,p_drain boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d uuid;begin
 perform kiosk_private.owner();if p_active is null or p_drain is null or p_valid_until is null or not isfinite(p_valid_until) or p_valid_until>clock_timestamp()+interval '24 hours'
  or not exists(select 1 from auth.users where id=p_principal) or exists(select 1 from public.admin_profiles where id=p_principal) or exists(select 1 from public.pos_staff_access where user_id=p_principal)
  or (p_active and p_valid_until<=clock_timestamp()) then perform kiosk_private.reject('KIOSK_NONSTAFF_REQUIRED');end if;
 insert into kiosk_private.devices(principal,active,valid_until,drain,updated_by) values(p_principal,p_active,p_valid_until,p_drain,auth.uid())
 on conflict(principal) do update set active=excluded.active,valid_until=excluded.valid_until,drain=excluded.drain,updated_by=auth.uid(),updated_at=clock_timestamp() returning id into d;
 insert into kiosk_private.audit(event,actor,device) values(case when p_active then 'device_authorized' else 'device_revoked' end,auth.uid(),d);
 return jsonb_build_object('device_id',d);end $$;
create function public.kiosk_owner_recover(p_generation uuid,p_key uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a kiosk_private.attempts%rowtype;begin
 perform kiosk_private.owner();perform submission_private.lock_submission_key(p_key);select * into a from kiosk_private.attempts where key=p_key and generation=p_generation;
 insert into kiosk_private.audit(event,actor,key,device) values('owner_recovery',auth.uid(),p_key,a.device);
 return jsonb_build_object('state',coalesce(a.state,'unknown'),'receipt',a.receipt,'accepted_at',a.accepted_at);
end $$;
create function public.kiosk_owner_provenance(p_order uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p kiosk_private.provenance%rowtype;begin perform kiosk_private.owner();select * into p from kiosk_private.provenance where order_id=p_order;
 return case when p.order_id is null then null else jsonb_build_object('channel','in_store_kiosk','contract_version',p.contract_version) end;end $$;

create function kiosk_private.immutable_provenance() returns trigger language plpgsql set search_path=pg_catalog as $$begin perform kiosk_private.reject('KIOSK_PROVENANCE_IMMUTABLE');return null;end $$;
create trigger kiosk_provenance_immutable before update or delete on kiosk_private.provenance for each row execute function kiosk_private.immutable_provenance();
create function kiosk_private.metadata_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare o public.orders%rowtype;p kiosk_private.provenance%rowtype;begin
 select * into o from public.orders where id=new.id;
 if o.submission_fingerprint_version=3 then
  select * into p from kiosk_private.provenance where order_id=o.id;
  if p.order_id is null or p.key<>o.public_submission_key or p.fingerprint<>o.public_submission_fingerprint or o.source<>'website'
   or o.fulfillment_type not in ('dine_in','pickup') or o.customer_phone<>'' or o.customer_id is not null then perform kiosk_private.reject('KIOSK_PROVENANCE_REQUIRED');end if;
 end if;return null;end $$;
create constraint trigger kiosk_metadata_consistency after insert or update on public.orders deferrable initially deferred for each row execute function kiosk_private.metadata_guard();
-- Preserve reviewed customer/financial snapshots while allowing existing staff
-- status/payment operations. Kiosk creation itself is always counter/unpaid.
create function kiosk_private.order_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if old.submission_fingerprint_version=3 and row(new.order_number,new.customer_name,new.customer_phone,new.customer_email,new.customer_notes,new.fulfillment_type,new.pickup_time,new.preparation_timing,new.requested_preparation_at,new.subtotal,new.total,new.currency,new.payment_method,new.public_submission_key,new.public_submission_fingerprint,new.submission_fingerprint_version,new.pricing_contract_version,new.pricing_policy_version,new.pricing_fingerprint_version,new.accepted_review_fingerprint,new.priced_at,new.tracking_token)
  is distinct from row(old.order_number,old.customer_name,old.customer_phone,old.customer_email,old.customer_notes,old.fulfillment_type,old.pickup_time,old.preparation_timing,old.requested_preparation_at,old.subtotal,old.total,old.currency,old.payment_method,old.public_submission_key,old.public_submission_fingerprint,old.submission_fingerprint_version,old.pricing_contract_version,old.pricing_policy_version,old.pricing_fingerprint_version,old.accepted_review_fingerprint,old.priced_at,old.tracking_token) then perform kiosk_private.reject('KIOSK_SNAPSHOT_IMMUTABLE');end if;
 return new;end $$;
create trigger kiosk_order_snapshot_guard before update on public.orders for each row execute function kiosk_private.order_guard();
create function kiosk_private.item_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if TG_OP='INSERT' then
  if exists(select 1 from kiosk_private.provenance where order_id=new.order_id) then perform kiosk_private.reject('KIOSK_SNAPSHOT_IMMUTABLE');end if;
  return new;
 end if;
 if exists(select 1 from public.orders where id=old.order_id and submission_fingerprint_version=3) then perform kiosk_private.reject('KIOSK_SNAPSHOT_IMMUTABLE');end if;
 if TG_OP='DELETE' then return old;end if;
 if exists(select 1 from kiosk_private.provenance where order_id=new.order_id) then perform kiosk_private.reject('KIOSK_SNAPSHOT_IMMUTABLE');end if;
 return new;end $$;
create trigger kiosk_item_snapshot_guard before insert or update or delete on public.order_items for each row execute function kiosk_private.item_guard();

revoke all on all functions in schema kiosk_private from public,anon,authenticated;
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'kiosk\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
end loop;end $$;
commit;
