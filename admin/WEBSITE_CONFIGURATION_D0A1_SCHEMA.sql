-- D0A.1 LOCAL DRAFT ONLY. No catalog data or pricing engine. One narrow compatibility read.
-- Apply only after review. Unexpected collisions abort before DDL.
-- Rollback: rollback on failure. After commit, retain data; export/review any
-- populated configuration before manually dropping these new objects.
-- Never remove the product_sizes unique constraint while dependent FKs exist.
begin;
do $$
declare r record;
begin
  if not exists(select 1 from pg_roles where rolname='anon') or not exists(select 1 from pg_roles where rolname='authenticated') then
    raise exception 'D0A1 roles missing' using detail='D0A1_PREREQUISITE';
  end if;
  for r in select * from (values
    ('products','id','uuid'),('products','is_available','boolean'),('products','is_published','boolean'),
    ('products','is_sold_out','boolean'),('products','archived_at','timestamp with time zone'),
    ('product_sizes','id','uuid'),('product_sizes','product_id','uuid'),('product_sizes','price','numeric'),
    ('option_groups','id','uuid'),('option_groups','group_key','text'),('option_groups','is_active','boolean'),
    ('option_choices','id','uuid'),('option_choices','option_group_id','uuid'),('option_choices','is_active','boolean'),('option_choices','price_delta','numeric'),
    ('product_option_groups','product_id','uuid'),('product_option_groups','option_group_id','uuid'),('product_option_groups','is_active','boolean')
  ) v(tbl,col,typ) loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name=r.col and data_type=r.typ) then
      raise exception 'D0A1 missing/incompatible column %.%',r.tbl,r.col using detail='D0A1_PREREQUISITE';
    end if;
  end loop;
  if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname like 'd0a1_%')
    or exists(select 1 from pg_type where typnamespace='public'::regnamespace and typname in ('product_option_choice_price_overrides','product_size_option_choice_compatibility','product_option_choice_override_requirements'))
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='get_public_configuration_compatibility') then
    raise exception 'D0A1 name collision' using detail='D0A1_COLLISION';
  end if;
  if to_regclass('public.products') is null or to_regclass('public.product_sizes') is null
    or to_regclass('public.product_option_groups') is null or to_regclass('public.option_choices') is null then
    raise exception 'D0A1 catalog prerequisites missing' using detail='D0A1_PREREQUISITE';
  end if;
  for r in select unnest(array['products','product_sizes','option_choices']) tbl loop
    if not exists(select 1 from pg_constraint c where c.conrelid=to_regclass('public.'||r.tbl) and c.contype='p' and c.convalidated
      and (select array_agg(a.attname::text order by k.ordinality) from unnest(c.conkey) with ordinality k(attnum,ordinality)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['id']) then
      raise exception 'D0A1 expected primary key missing: %',r.tbl using detail='D0A1_PREREQUISITE';
    end if;
  end loop;
  if to_regprocedure('gen_random_uuid()') is null
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='archived_at')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='is_sold_out') then
    raise exception 'D0A1 catalog/UUID prerequisites missing' using detail='D0A1_PREREQUISITE';
  end if;
  if to_regnamespace('configuration_private') is not null
    or to_regprocedure('public.get_public_configuration_compatibility()') is not null
    or to_regclass('public.product_option_choice_price_overrides') is not null
    or to_regclass('public.product_option_choice_override_requirements') is not null
    or to_regclass('public.product_size_option_choice_compatibility') is not null
    or exists(select 1 from pg_constraint where conrelid='public.product_sizes'::regclass and conname='d0a1_size_product_unique') then
    raise exception 'D0A1 object collision: inspect existing definitions before proceeding' using detail='D0A1_COLLISION';
  end if;
end $$;
create schema configuration_private;
revoke all on schema configuration_private from public, anon, authenticated;
alter table public.product_sizes add constraint d0a1_size_product_unique unique(id,product_id);
create table public.product_option_choice_price_overrides (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  product_size_id uuid,
  option_choice_id uuid not null references public.option_choices(id),
  price_delta numeric not null check (price_delta >= 0 and price_delta <= 999999.99 and price_delta=round(price_delta,2)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key(product_size_id,product_id) references public.product_sizes(id,product_id)
);
create unique index d0a1_override_product_choice on public.product_option_choice_price_overrides(product_id,option_choice_id)
  where is_active and product_size_id is null;
create unique index d0a1_override_size_choice on public.product_option_choice_price_overrides(product_id,product_size_id,option_choice_id)
  where is_active and product_size_id is not null;
create table public.product_size_option_choice_compatibility (
  product_id uuid not null references public.products(id),
  product_size_id uuid not null,
  option_choice_id uuid not null references public.option_choices(id),
  is_active boolean not null default true,
  primary key(product_id,product_size_id,option_choice_id),
  foreign key(product_size_id,product_id) references public.product_sizes(id,product_id)
);
-- Explicit coverage requirements; never infer recipe inclusion from price/defaults.
create table public.product_option_choice_override_requirements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  product_size_id uuid,
  option_choice_id uuid not null references public.option_choices(id),
  specificity text not null check (specificity in ('product','size')),
  is_active boolean not null default true,
  check ((specificity='product' and product_size_id is null) or (specificity='size' and product_size_id is not null)),
  foreign key(product_size_id,product_id) references public.product_sizes(id,product_id)
);
create unique index d0a1_requirement_product_choice on public.product_option_choice_override_requirements(product_id,option_choice_id)
  where is_active and product_size_id is null;
create unique index d0a1_requirement_size_choice on public.product_option_choice_override_requirements(product_id,product_size_id,option_choice_id)
  where is_active and product_size_id is not null;
-- Full indexes serve inactive-row FK maintenance as well as product lookups.
create index d0a1_override_product_size on public.product_option_choice_price_overrides(product_id,product_size_id);
create index d0a1_override_choice on public.product_option_choice_price_overrides(option_choice_id);
create index d0a1_requirement_product_size on public.product_option_choice_override_requirements(product_id,product_size_id);
create index d0a1_requirement_choice on public.product_option_choice_override_requirements(option_choice_id);
create index d0a1_compatibility_choice on public.product_size_option_choice_compatibility(option_choice_id);
alter table public.product_option_choice_override_requirements enable row level security;
revoke all on public.product_option_choice_override_requirements from public,anon,authenticated;
alter table public.product_option_choice_price_overrides enable row level security;
alter table public.product_size_option_choice_compatibility enable row level security;
revoke all on public.product_option_choice_price_overrides, public.product_size_option_choice_compatibility from public,anon,authenticated;

-- Model validation only: this is not a cart pricing or public submission RPC.
create function configuration_private.choice_allowed(p_product uuid,p_choice uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
  select exists(select 1 from public.option_choices c
    join public.option_groups g on g.id=c.option_group_id
    join public.product_option_groups a on a.option_group_id=g.id and a.product_id=p_product
    where c.id=p_choice and c.is_active and g.is_active and a.is_active);
$$;
create function configuration_private.validate_mapping() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.is_active and not configuration_private.choice_allowed(new.product_id,new.option_choice_id) then
    raise exception 'Choice is not active and assigned to product' using detail='D0A1_INVALID_CHOICE';
  end if;
  if tg_table_name='product_size_option_choice_compatibility' and new.is_active
    and not exists(select 1 from public.option_choices c join public.option_groups g on g.id=c.option_group_id
      where c.id=new.option_choice_id and g.group_key='temperature') then
    raise exception 'Compatibility is limited to temperature choices' using detail='D0A1_INVALID_TEMPERATURE';
  end if;
  return new;
end $$;
create trigger d0a1_override_mapping before insert or update on public.product_option_choice_price_overrides
  for each row execute function configuration_private.validate_mapping();
create trigger d0a1_compatibility_mapping before insert or update on public.product_size_option_choice_compatibility
  for each row execute function configuration_private.validate_mapping();
create trigger d0a1_requirement_mapping before insert or update on public.product_option_choice_override_requirements
  for each row execute function configuration_private.validate_mapping();

-- Private helper-level precedence contract. Always revalidate current assignment;
-- an override cannot authorize a removed/inactive choice. No default lookup.
create function configuration_private.choice_delta(p_product uuid,p_size uuid,p_choice uuid) returns numeric
language plpgsql stable set search_path=pg_catalog as $$
declare result numeric;
begin
  if not exists(select 1 from public.product_sizes where id=p_size and product_id=p_product)
    or not configuration_private.choice_allowed(p_product,p_choice)
    or (exists(select 1 from public.option_choices c join public.option_groups g on g.id=c.option_group_id
          where c.id=p_choice and g.group_key='temperature')
        and not exists(select 1 from public.product_size_option_choice_compatibility
          where product_id=p_product and product_size_id=p_size and option_choice_id=p_choice and is_active)) then
    raise exception 'Invalid configuration' using detail='D0A1_INVALID_CONFIGURATION';
  end if;
  if exists(select 1 from public.product_option_choice_override_requirements r
    where r.product_id=p_product and r.option_choice_id=p_choice and r.is_active
      and (r.product_size_id is null or r.product_size_id=p_size)
      and not exists(select 1 from public.product_option_choice_price_overrides o
        where o.product_id=r.product_id and o.option_choice_id=r.option_choice_id and o.is_active
          and o.product_size_id is not distinct from r.product_size_id)) then
    raise exception 'Required contextual price missing' using detail='D0A1_REQUIRED_OVERRIDE_MISSING';
  end if;
  if exists(select 1 from public.product_option_choice_price_overrides
    where product_id=p_product and option_choice_id=p_choice and is_active
      and (product_size_id=p_size or product_size_id is null)
    group by product_size_id having count(*)>1) then
    raise exception 'Ambiguous contextual price' using detail='D0A1_AMBIGUOUS_OVERRIDE';
  end if;
  select price_delta into result from public.product_option_choice_price_overrides
    where product_id=p_product and option_choice_id=p_choice and is_active
      and (product_size_id=p_size or product_size_id is null)
    order by (product_size_id is not null) desc limit 1;
  if not found then select price_delta into result from public.option_choices where id=p_choice; end if;
  if result is null or not (result>=0 and result<=999999.99 and result=round(result,2)) then
    raise exception 'Invalid option price' using detail='D0A1_INVALID_PRICE';
  end if;
  return result;
end $$;
revoke all on all functions in schema configuration_private from public,anon,authenticated;
-- Narrow customer-safe compatibility projection only. No prices, overrides,
-- unpublished products, notes or private data. No underlying anonymous grants.
create function public.get_public_configuration_compatibility()
returns table(product_id uuid,product_size_id uuid,option_choice_id uuid,is_active boolean)
language sql stable security definer set search_path=pg_catalog as $$
 select r.product_id,r.product_size_id,r.option_choice_id,r.is_active
 from public.product_size_option_choice_compatibility r
 join public.products p on p.id=r.product_id
 join public.product_sizes s on s.id=r.product_size_id and s.product_id=p.id
 join public.option_choices c on c.id=r.option_choice_id
 join public.option_groups g on g.id=c.option_group_id
 join public.product_option_groups a on a.product_id=p.id and a.option_group_id=g.id
 where r.is_active and p.is_available and p.is_published and p.archived_at is null and not p.is_sold_out
   and c.is_active and g.is_active and a.is_active and g.group_key='temperature';
$$;
revoke all on function public.get_public_configuration_compatibility() from public,anon,authenticated;
grant execute on function public.get_public_configuration_compatibility() to anon,authenticated;
commit;
