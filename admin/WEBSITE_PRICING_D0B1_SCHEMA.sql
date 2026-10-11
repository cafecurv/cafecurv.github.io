-- LOCAL DRAFT: revised WEBSITE_CONFIGURATION_D0A1_SCHEMA.sql first.
-- Requires the deployed C1B + structured dine-in baseline. No submission replacement,
-- catalog seed, backfill, preview API or enforcement switch. Explicit approval required.
begin;
do $$
declare r record;
begin
  if not exists(select 1 from pg_roles where rolname='anon') or not exists(select 1 from pg_roles where rolname='authenticated') then
    raise exception 'D0B1 roles missing' using detail='D0B1_PREREQUISITE';
  end if;
  for r in select * from (values
    ('orders','id','uuid'),('orders','public_submission_key','uuid'),('orders','public_submission_fingerprint','text'),
    ('orders','preparation_timing','text'),('orders','requested_preparation_at','timestamp with time zone'),('orders','customer_id','uuid'),
    ('order_items','id','uuid'),('order_items','order_id','uuid'),('order_items','options','jsonb'),
    ('product_sizes','id','uuid'),('product_sizes','product_id','uuid'),('product_sizes','price','numeric'),
    ('option_groups','selection_type','text'),('option_groups','group_key','text'),('option_groups','is_active','boolean'),
    ('product_option_groups','is_required','boolean'),('product_option_groups','min_selections','integer'),('product_option_groups','max_selections','integer'),
    ('product_option_defaults','product_id','uuid'),('product_option_defaults','option_group_id','uuid'),('product_option_defaults','option_choice_id','uuid'),
    ('product_option_choice_override_requirements','specificity','text'),('product_option_choice_override_requirements','product_size_id','uuid')
  ) v(tbl,col,typ) loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name=r.col and data_type=r.typ) then
      raise exception 'D0B1 missing/incompatible column %.%',r.tbl,r.col using detail='D0B1_PREREQUISITE';
    end if;
  end loop;
  if to_regprocedure('public.submit_public_order(jsonb)') is null
    or to_regprocedure('configuration_private.choice_delta(uuid,uuid,uuid)') is null
    or to_regprocedure('public.get_public_configuration_compatibility()') is null
    or position('p.is_available' in pg_get_functiondef(to_regprocedure('public.get_public_configuration_compatibility()')))=0
    or not exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_preparation_pair_check' and convalidated)
    or not exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_public_submission_pair_check' and convalidated)
    or not exists(select 1 from pg_index where indexrelid=to_regclass('public.orders_public_submission_key_idx') and indisunique and indisvalid and indisready
      and indrelid='public.orders'::regclass and indnkeyatts=1
      and pg_get_indexdef(indexrelid,1,true)='public_submission_key'
      and pg_get_expr(indpred,indrelid)='(public_submission_key IS NOT NULL)') then
    raise exception 'D0B1 timing/idempotency/configuration prerequisite missing' using detail='D0B1_PREREQUISITE';
  end if;
  for r in select unnest(array['d0a1_override_product_choice','d0a1_override_size_choice','d0a1_requirement_product_choice','d0a1_requirement_size_choice']) n loop
    if not exists(select 1 from pg_index where indexrelid=to_regclass('public.'||r.n) and indisunique and indisvalid and indisready
      and indrelid=case when r.n like 'd0a1_override_%' then 'public.product_option_choice_price_overrides'::regclass else 'public.product_option_choice_override_requirements'::regclass end
      and indnkeyatts=case when r.n like '%_size_choice' then 3 else 2 end
      and pg_get_indexdef(indexrelid,1,true)='product_id'
      and pg_get_indexdef(indexrelid,2,true)=case when r.n like '%_size_choice' then 'product_size_id' else 'option_choice_id' end
      and (r.n not like '%_size_choice' or pg_get_indexdef(indexrelid,3,true)='option_choice_id')
      and pg_get_expr(indpred,indrelid)=case when r.n like '%_size_choice' then '(is_active AND (product_size_id IS NOT NULL))' else '(is_active AND (product_size_id IS NULL))' end) then
      raise exception 'D0B1 missing valid unique index %',r.n using detail='D0B1_PREREQUISITE';
    end if;
  end loop;
  for r in select * from (values
    ('product_sizes','d0a1_size_product_unique','UNIQUE (id, product_id)'),
    ('product_option_groups','product_option_groups_unique_product_group','UNIQUE (product_id, option_group_id)'),
    ('product_option_defaults','product_option_defaults_unique_choice','UNIQUE (product_id, option_group_id, option_choice_id)'),
    ('option_groups','option_groups_selection_type_check',null),
    ('product_option_defaults','product_option_defaults_choice_group_fk',null),
    ('product_option_defaults','product_option_defaults_assignment_fk',null)
  ) v(tbl,con,definition) loop
    if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.'||r.tbl) and conname=r.con and convalidated
      and (r.definition is null or pg_get_constraintdef(oid)=r.definition)) then
      raise exception 'D0B1 missing/incompatible constraint %',r.con using detail='D0B1_PREREQUISITE';
    end if;
  end loop;
  if exists(select 1 from pg_attribute where attrelid='public.orders'::regclass and not attisdropped and attname in
      ('pricing_contract_version','pricing_policy_version','pricing_fingerprint_version','accepted_review_fingerprint','priced_at','submission_fingerprint_version'))
    or exists(select 1 from pg_attribute where attrelid='public.order_items'::regclass and not attisdropped and attname='pricing_configuration_snapshot')
    or exists(select 1 from pg_type where typnamespace='configuration_private'::regnamespace and typname='product_pricing_certifications')
    or to_regclass('configuration_private.product_pricing_certifications') is not null
    or exists(select 1 from pg_class where relnamespace in ('public'::regnamespace,'configuration_private'::regnamespace) and relname like 'd0b1_%')
    or exists(select 1 from pg_proc where pronamespace='configuration_private'::regnamespace and proname in
      ('catalog_structure','validate_product_coverage','certify_product','assert_pricing_ready','valid_pricing_snapshot','validate_item_snapshot'))
    or exists(select 1 from pg_trigger where tgrelid='public.order_items'::regclass and tgname='d0b1_item_snapshot')
    or exists(select 1 from pg_constraint where connamespace in ('public'::regnamespace,'configuration_private'::regnamespace) and conname like 'd0b1_%') then
    raise exception 'D0B1 object/column collision; inspect definitions, do not replace' using detail='D0B1_COLLISION';
  end if;
end $$;

-- Full canonical JSONB, not a hash: reviewable and no digest dependency/collision.
-- No automatically inferred certifications. Empty assignments certify zero groups
-- ONLY after an operator reviews and explicitly supplies that expected structure.
create table configuration_private.product_pricing_certifications (
  product_id uuid primary key references public.products(id),
  structure_version smallint not null default 1 check (structure_version=1),
  expected_structure jsonb not null check (jsonb_typeof(expected_structure)='object'),
  review_note text not null check (length(btrim(review_note)) between 1 and 1000),
  certified_at timestamptz not null default now(),
  certified_by name not null default session_user
);
alter table configuration_private.product_pricing_certifications enable row level security;
revoke all on configuration_private.product_pricing_certifications from public,anon,authenticated;

create function configuration_private.catalog_structure(p_product uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('structure_version',1,'product_id',p_product,
   'sizes',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.product_sizes s where s.product_id=p_product),'[]'::jsonb),
   'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.option_group_id) from public.product_option_groups a where a.product_id=p_product),'[]'::jsonb),
   'groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.option_groups g where exists(select 1 from public.product_option_groups a where a.product_id=p_product and a.option_group_id=g.id)),'[]'::jsonb),
   'choices',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.option_choices c where exists(select 1 from public.product_option_groups a where a.product_id=p_product and a.option_group_id=c.option_group_id)),'[]'::jsonb),
   'defaults',coalesce((select jsonb_agg(to_jsonb(d) order by d.option_group_id,d.option_choice_id) from public.product_option_defaults d where d.product_id=p_product),'[]'::jsonb),
   'compatibility',coalesce((select jsonb_agg(to_jsonb(t) order by t.product_size_id,t.option_choice_id) from public.product_size_option_choice_compatibility t where t.product_id=p_product),'[]'::jsonb),
   'requirements',coalesce((select jsonb_agg(to_jsonb(r) order by r.option_choice_id,r.product_size_id nulls first) from public.product_option_choice_override_requirements r where r.product_id=p_product),'[]'::jsonb),
   'overrides',coalesce((select jsonb_agg(to_jsonb(o) order by o.option_choice_id,o.product_size_id nulls first) from public.product_option_choice_price_overrides o where o.product_id=p_product),'[]'::jsonb));
$$;

create function configuration_private.validate_product_coverage(p_product uuid) returns void
language plpgsql stable set search_path=pg_catalog as $$
declare a record; n integer; d integer; minimum integer; maximum integer;
begin
  if not exists(select 1 from public.products where id=p_product)
    or not exists(select 1 from public.product_sizes where product_id=p_product)
    or exists(select 1 from public.product_sizes where product_id=p_product and not (price>=0 and price<=999999.99 and price=round(price,2)) is true) then
    raise exception 'Product/size coverage invalid' using detail='D0B1_SIZE_COVERAGE';
  end if;
  for a in select x.*,g.selection_type,g.group_key,g.is_active group_active from public.product_option_groups x join public.option_groups g on g.id=x.option_group_id
    where x.product_id=p_product and x.is_active loop
    minimum:=greatest(a.min_selections,case when a.is_required then 1 else 0 end);
    select count(*) into n from public.option_choices where option_group_id=a.option_group_id and is_active;
    maximum:=coalesce(a.max_selections,case when a.selection_type='single' then 1 else n end);
    if not a.group_active or a.selection_type not in ('single','multi') or a.min_selections<0
      or maximum<minimum or n<minimum or (a.selection_type='single' and (maximum>1 or minimum>1))
      or exists(select 1 from public.option_choices where option_group_id=a.option_group_id and is_active
        and not (price_delta>=0 and price_delta<=999999.99 and price_delta=round(price_delta,2)) is true) then
      raise exception 'Group/choice coverage invalid' using detail='D0B1_GROUP_COVERAGE';
    end if;
    select count(*) into d from public.product_option_defaults x join public.option_choices c on c.id=x.option_choice_id and c.option_group_id=x.option_group_id
      where x.product_id=p_product and x.option_group_id=a.option_group_id and c.is_active;
    if d<minimum or d>maximum or d<>(select count(*) from public.product_option_defaults where product_id=p_product and option_group_id=a.option_group_id) then
      raise exception 'Default coverage invalid' using detail='D0B1_DEFAULT_COVERAGE';
    end if;
    if a.group_key='temperature' and (a.selection_type<>'single' or minimum<>1 or maximum<>1
      or exists(select 1 from public.product_sizes s where s.product_id=p_product and not exists(
        select 1 from public.product_size_option_choice_compatibility t join public.option_choices c on c.id=t.option_choice_id
        where t.product_id=p_product and t.product_size_id=s.id and t.is_active and c.is_active and c.option_group_id=a.option_group_id))) then
      raise exception 'Temperature coverage invalid' using detail='D0B1_TEMPERATURE_COVERAGE';
    end if;
  end loop;
  if exists(select 1 from public.product_option_defaults d where d.product_id=p_product and not exists(
    select 1 from public.product_option_groups assignment where assignment.product_id=p_product and assignment.option_group_id=d.option_group_id and assignment.is_active)) then
    raise exception 'Default has no active assignment' using detail='D0B1_DEFAULT_COVERAGE';
  end if;
  if exists(select 1 from public.product_size_option_choice_compatibility t where t.product_id=p_product and t.is_active and
    (not configuration_private.choice_allowed(p_product,t.option_choice_id) or not exists(select 1 from public.option_choices c join public.option_groups g on g.id=c.option_group_id where c.id=t.option_choice_id and g.group_key='temperature'))) then
    raise exception 'Invalid temperature tuple' using detail='D0B1_TEMPERATURE_COVERAGE';
  end if;
  if exists(select 1 from public.product_option_choice_override_requirements r where r.product_id=p_product and r.is_active and
    (not configuration_private.choice_allowed(p_product,r.option_choice_id) or not exists(select 1 from public.product_option_choice_price_overrides o
      where o.product_id=r.product_id and o.option_choice_id=r.option_choice_id and o.is_active and o.product_size_id is not distinct from r.product_size_id))) then
    raise exception 'Contextual price coverage missing' using detail='D0B1_OVERRIDE_COVERAGE';
  end if;
  if exists(select 1 from public.product_option_choice_price_overrides o where o.product_id=p_product and o.is_active and not configuration_private.choice_allowed(p_product,o.option_choice_id)) then
    raise exception 'Override has no active assignment' using detail='D0B1_OVERRIDE_COVERAGE';
  end if;
end $$;

create function configuration_private.certify_product(p_product uuid,p_expected jsonb,p_note text) returns void
language plpgsql set search_path=pg_catalog as $$
begin
  perform configuration_private.validate_product_coverage(p_product);
  if p_expected is distinct from configuration_private.catalog_structure(p_product) then
    raise exception 'Reviewed structure differs from catalog' using detail='D0B1_CERTIFICATION_MISMATCH';
  end if;
  insert into configuration_private.product_pricing_certifications(product_id,expected_structure,review_note)
    values(p_product,p_expected,p_note)
    on conflict(product_id) do update set expected_structure=excluded.expected_structure,review_note=excluded.review_note,
      certified_at=clock_timestamp(),certified_by=session_user;
end $$;

-- Required runtime gate for the future engine, in the SAME snapshot as pricing.
-- Do not treat a certification row's existence as sufficient.
create function configuration_private.assert_pricing_ready(p_product uuid) returns void
language plpgsql stable set search_path=pg_catalog as $$
begin
  if not exists(select 1 from public.products where id=p_product and is_available and is_published and not is_sold_out and archived_at is null) then
    raise exception 'Product unavailable' using detail='D0B1_PRODUCT_UNAVAILABLE';
  end if;
  if not exists(select 1 from configuration_private.product_pricing_certifications c where c.product_id=p_product and c.structure_version=1
    and c.expected_structure=configuration_private.catalog_structure(p_product)) then
    raise exception 'Missing/stale pricing certification' using detail='D0B1_CERTIFICATION_STALE';
  end if;
  perform configuration_private.validate_product_coverage(p_product);
end $$;

-- Immutable structural validation only; never consult mutable catalog/history FKs.
create function configuration_private.valid_pricing_snapshot(s jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare x jsonb; ids uuid[]; option_ids uuid[]; amount numeric; v uuid;
begin
  if not (jsonb_typeof(s)='object' and s->>'contract_version'='2'
    and jsonb_typeof(s->'pricing_policy_version')='string' and length(btrim(s->>'pricing_policy_version')) between 1 and 100
    and jsonb_typeof(s->'product_id')='string' and jsonb_typeof(s->'product_size_id')='string'
    and jsonb_typeof(s->'option_choice_ids')='array' and jsonb_typeof(s->'options')='array') is true then return false; end if;
  v:=(s->>'product_id')::uuid; v:=(s->>'product_size_id')::uuid;
  for x in select value from jsonb_array_elements(s->'option_choice_ids') loop
    if jsonb_typeof(x)<>'string' then return false; end if;
    v:=(x#>>'{}')::uuid; ids:=array_append(ids,v);
  end loop;
  for x in select value from jsonb_array_elements(s->'options') loop
    if not (jsonb_typeof(x)='object' and jsonb_typeof(x->'choice_id')='string' and jsonb_typeof(x->'group_id')='string'
      and jsonb_typeof(x->'group_name')='string' and jsonb_typeof(x->'label')='string'
      and jsonb_typeof(x->'effective_price_delta')='number') is true then return false; end if;
    v:=(x->>'group_id')::uuid; v:=(x->>'choice_id')::uuid; option_ids:=array_append(option_ids,v);
    amount:=(x->>'effective_price_delta')::numeric;
    if not (amount>=0 and amount<=999999.99 and amount=round(amount,2)) then return false; end if;
  end loop;
  return (select count(*)=count(distinct id) from unnest(ids) id)
    and coalesce((select array_agg(id order by id) from unnest(ids) id),'{}'::uuid[])
      =coalesce((select array_agg(id order by id) from unnest(option_ids) id),'{}'::uuid[]);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;

alter table public.orders
  add column pricing_contract_version smallint,
  add column pricing_policy_version text,
  add column pricing_fingerprint_version smallint,
  add column accepted_review_fingerprint text,
  add column priced_at timestamptz,
  add column submission_fingerprint_version smallint;
-- Columns cannot preexist (preflight). Every historical value is NULL, so no
-- historical row can fail these new checks; no UPDATE/backfill occurs.
alter table public.orders add constraint d0b1_order_pricing_metadata check ((
  (pricing_contract_version is null or pricing_contract_version in (1,2))
  and (submission_fingerprint_version is null or submission_fingerprint_version in (1,2))
  and (pricing_contract_version is distinct from 2 or (
    pricing_policy_version is not null and length(btrim(pricing_policy_version)) between 1 and 100
    and pricing_fingerprint_version is not null and pricing_fingerprint_version=1
    and accepted_review_fingerprint is not null and accepted_review_fingerprint ~ '^[0-9a-f]{64}$'
    and priced_at is not null and isfinite(priced_at)
    and submission_fingerprint_version is not null and submission_fingerprint_version=2
    and public_submission_key is not null and public_submission_fingerprint is not null
  ))
) is true);
alter table public.order_items add column pricing_configuration_snapshot jsonb;
-- Avoid a private helper in an existing table CHECK: ordinary authorized legacy
-- writes must not acquire a new private-schema EXECUTE dependency.
create function configuration_private.validate_item_snapshot() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new.pricing_configuration_snapshot is not null and not configuration_private.valid_pricing_snapshot(new.pricing_configuration_snapshot) then
    raise exception 'Invalid authoritative item snapshot' using errcode='23514',detail='D0B1_SNAPSHOT_INVALID';
  end if;
  return new;
end $$;
create trigger d0b1_item_snapshot before insert or update of pricing_configuration_snapshot on public.order_items
  for each row execute function configuration_private.validate_item_snapshot();
revoke all on all functions in schema configuration_private from public,anon,authenticated;
comment on column public.orders.submission_fingerprint_version is
  'NULL/1 = existing raw-payload fingerprint; 2 = future canonical intent fingerprint. D0B1 changes no replay logic.';
comment on column public.order_items.pricing_configuration_snapshot is
  'Nullable independent per-line v2 configuration snapshot. No catalog FKs; existing readable options unchanged.';
commit;
