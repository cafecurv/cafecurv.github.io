-- PHASE 3A LOCAL DRAFT: DO NOT EXECUTE until reviewed and locally database-tested.
-- One transaction; first application only. No seeds, recertification or order writes.
-- Install backend before the public-menu consumer; keep policy editing gated until both are verified.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $preflight$
declare r record;
begin
 if to_regclass('public.product_option_choice_policies') is not null
   or to_regprocedure('configuration_private.choice_policy_structure(uuid)') is not null
   or to_regprocedure('configuration_private.effective_choice_price(uuid,uuid,uuid)') is not null
   or to_regprocedure('configuration_private.effective_product_choices(uuid)') is not null
   or exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='get_public_effective_option_choices') then
   raise exception 'Phase 3A collision. Review before retrying.' using detail='MM_3A_COLLISION';
 end if;
 for r in select * from (values
('public.menu_manager_get_product_editor(uuid)','77768a8264b09e63335e3ce946432b38'),
('configuration_private.choice_allowed(uuid,uuid)','0620c61a8ed2c7d2d2b5bf6f526fd3cd'),
('configuration_private.choice_delta(uuid,uuid,uuid)','322c2ccd043af497b9ad1fb970798c76'),
('configuration_private.catalog_structure(uuid)','c721bcd4ef362ef2a4e5e19f9c35d2a4'),
('configuration_private.validate_product_coverage(uuid)','e3c2625789d52c06e3065a4976767b15'),
('configuration_private.price_order_configuration(jsonb)','3524ac423346df98b279cab73fdb3719'),
('public.get_public_configuration_compatibility()','c6060888fe2d6d8de5277c5b75a9f504'),
('menu_save_private.guard_catalog_write()','803c3c1fee181c34b294aa3f8ca868c8'),
('public.menu_manager_save_product(jsonb)','6344f1489155a211218fe0570a3b9cd6')
 ) v(signature,source_md5) loop
   if not exists(select 1 from pg_proc where oid=to_regprocedure(r.signature)
     and proowner=current_user::regrole and md5(regexp_replace(prosrc,'\s+','','g'))=r.source_md5
     and 'search_path=pg_catalog'=any(proconfig)) then
     raise exception 'Missing or changed Phase 3A prerequisite: %',r.signature using detail='MM_3A_PREREQUISITE';
   end if;
 end loop;
 if not exists(select 1 from pg_roles where rolname='anon') or not exists(select 1 from pg_roles where rolname='authenticated')
   or to_regprocedure('configuration_private.certify_product(uuid,jsonb,text)') is null
   or to_regprocedure('configuration_private.assert_pricing_ready(uuid)') is null
   or to_regprocedure('public.quote_public_cart(jsonb)') is null
   or to_regprocedure('public.submit_public_order_v2(jsonb)') is null then
   raise exception 'Missing pricing/readiness API baseline.' using detail='MM_3A_PREREQUISITE';
 end if;
 if not exists(select 1 from pg_class where oid=to_regclass('public.public_menu_option_choices') and relkind='v'
   and relowner=current_user::regrole and 'security_invoker=true'=any(reloptions)) then
   raise exception 'Public option view security must be reviewed.' using detail='MM_3A_PREREQUISITE';
 end if;
 if regexp_replace(pg_get_viewdef('public.public_menu_option_choices'::regclass,true),'[\s()]','','g')
   is distinct from regexp_replace($reviewed_view$ SELECT pog.product_id,
    og.id AS option_group_id,
    oc.id AS option_choice_id,
    oc.label,
    oc.value,
    oc.price_delta,
    oc.sort_order
   FROM product_option_groups pog
     JOIN option_groups og ON og.id = pog.option_group_id
     JOIN option_choices oc ON oc.option_group_id = og.id
     JOIN products p ON p.id = pog.product_id
  WHERE p.is_published = true AND p.is_available = true AND p.archived_at IS NULL AND og.is_active = true AND pog.is_active = true AND oc.is_active = true;$reviewed_view$,'[\s()]','','g') then
   raise exception 'Public option view changed; review before replacing it.' using detail='MM_3A_PREREQUISITE';
 end if;
end $preflight$;
lock table public.products,public.product_sizes,public.option_groups,public.option_choices,
 public.product_option_groups,public.product_option_defaults,public.product_option_choice_price_overrides,
 public.product_option_choice_override_requirements,public.product_size_option_choice_compatibility,
 configuration_private.product_pricing_certifications in share row exclusive mode;
-- Hold exact before-images for a no-change postflight; never modify catalog/certification rows.
create temporary table phase3a_before on commit drop as
 select p.id,configuration_private.catalog_structure(p.id) structure,
 (select to_jsonb(c) from configuration_private.product_pricing_certifications c where c.product_id=p.id) certification
 from public.products p;
create table public.product_option_choice_policies (
 product_id uuid not null,
 option_group_id uuid not null,
 option_choice_id uuid not null,
 is_enabled_for_product boolean not null,
 primary key(product_id,option_choice_id),
 foreign key(product_id,option_group_id) references public.product_option_groups(product_id,option_group_id),
 foreign key(option_choice_id,option_group_id) references public.option_choices(id,option_group_id)
);
create index product_option_choice_policies_choice_idx on public.product_option_choice_policies(option_choice_id);
alter table public.product_option_choice_policies enable row level security;
revoke all on public.product_option_choice_policies from public,anon,authenticated;
-- No browser policies or direct write grants. Phase 3B must use the save capability.
create function configuration_private.choice_policy_structure(p_product uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select case when count(*)=0 then '{}'::jsonb else jsonb_build_object('choice_policies',jsonb_agg(to_jsonb(p) order by option_choice_id)) end
 from public.product_option_choice_policies p where product_id=p_product;
$$;


create or replace function configuration_private.choice_allowed(p_product uuid,p_choice uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
  select exists(select 1 from public.option_choices c
    join public.option_groups g on g.id=c.option_group_id
    join public.product_option_groups a on a.option_group_id=g.id and a.product_id=p_product
    where c.id=p_choice and c.is_active and g.is_active and a.is_active and not exists(select 1 from public.product_option_choice_policies policy
      where policy.product_id=p_product and policy.option_choice_id=p_choice and not policy.is_enabled_for_product));
$$;


-- Shared -> product -> size precedence. NULL means invalid/uncovered, never free.
create function configuration_private.effective_choice_price(p_product uuid,p_size uuid,p_choice uuid) returns numeric
language sql stable set search_path=pg_catalog as $$
 select case when not configuration_private.choice_allowed(p_product,p_choice)
   or (p_size is not null and not exists(select 1 from public.product_sizes where id=p_size and product_id=p_product))
   or exists(select 1 from public.product_option_choice_price_overrides where product_id=p_product and option_choice_id=p_choice and is_active
      and (product_size_id is null or product_size_id=p_size) group by product_size_id having count(*)>1)
   or exists(select 1 from public.product_option_choice_override_requirements r where r.product_id=p_product and r.option_choice_id=p_choice and r.is_active
      and (r.product_size_id is null or r.product_size_id=p_size) and not exists(select 1 from public.product_option_choice_price_overrides o
      where o.product_id=r.product_id and o.option_choice_id=r.option_choice_id and o.product_size_id is not distinct from r.product_size_id and o.is_active))
   then null else coalesce(
     (select price_delta from public.product_option_choice_price_overrides where product_id=p_product and option_choice_id=p_choice and product_size_id=p_size and is_active limit 1),
     (select price_delta from public.product_option_choice_price_overrides where product_id=p_product and option_choice_id=p_choice and product_size_id is null and is_active limit 1),
     (select price_delta from public.option_choices where id=p_choice)) end;
$$;


create or replace function configuration_private.choice_delta(p_product uuid,p_size uuid,p_choice uuid) returns numeric
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
  result:=configuration_private.effective_choice_price(p_product,p_size,p_choice);
  if result is null or not (result>=0 and result<=999999.99 and result=round(result,2)) then
    raise exception 'Invalid option price' using detail='D0A1_INVALID_PRICE';
  end if;
  return result;
end $$;
create or replace function configuration_private.catalog_structure(p_product uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('structure_version',1,'product_id',p_product,
   'sizes',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.product_sizes s where s.product_id=p_product),'[]'::jsonb),
   'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.option_group_id) from public.product_option_groups a where a.product_id=p_product),'[]'::jsonb),
   'groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.option_groups g where exists(select 1 from public.product_option_groups a where a.product_id=p_product and a.option_group_id=g.id)),'[]'::jsonb),
   'choices',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.option_choices c where exists(select 1 from public.product_option_groups a where a.product_id=p_product and a.option_group_id=c.option_group_id)),'[]'::jsonb),
   'defaults',coalesce((select jsonb_agg(to_jsonb(d) order by d.option_group_id,d.option_choice_id) from public.product_option_defaults d where d.product_id=p_product),'[]'::jsonb),
   'compatibility',coalesce((select jsonb_agg(to_jsonb(t) order by t.product_size_id,t.option_choice_id) from public.product_size_option_choice_compatibility t where t.product_id=p_product),'[]'::jsonb),
   'requirements',coalesce((select jsonb_agg(to_jsonb(r) order by r.option_choice_id,r.product_size_id nulls first) from public.product_option_choice_override_requirements r where r.product_id=p_product),'[]'::jsonb),
   'overrides',coalesce((select jsonb_agg(to_jsonb(o) order by o.option_choice_id,o.product_size_id nulls first) from public.product_option_choice_price_overrides o where o.product_id=p_product),'[]'::jsonb)) || configuration_private.choice_policy_structure(p_product);
$$;

create or replace function configuration_private.validate_product_coverage(p_product uuid) returns void
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
    select count(*) into n from public.option_choices where option_group_id=a.option_group_id and is_active and configuration_private.choice_allowed(p_product,id);
    maximum:=coalesce(a.max_selections,case when a.selection_type='single' then 1 else n end);
    if not a.group_active or a.selection_type not in ('single','multi') or a.min_selections<0
      or maximum<minimum or n=0 or n<minimum or (a.selection_type='single' and (maximum>1 or minimum>1))
      or exists(select 1 from public.option_choices where option_group_id=a.option_group_id and is_active
        and not (price_delta>=0 and price_delta<=999999.99 and price_delta=round(price_delta,2)) is true) then
      raise exception 'Group/choice coverage invalid' using detail='D0B1_GROUP_COVERAGE';
    end if;
    select count(*) into d from public.product_option_defaults x join public.option_choices c on c.id=x.option_choice_id and c.option_group_id=x.option_group_id
      where x.product_id=p_product and x.option_group_id=a.option_group_id and c.is_active and configuration_private.choice_allowed(p_product,c.id);
    if d<minimum or d>maximum or d<>(select count(*) from public.product_option_defaults where product_id=p_product and option_group_id=a.option_group_id) then
      raise exception 'Default coverage invalid' using detail='D0B1_DEFAULT_COVERAGE';
    end if;
    if a.group_key='temperature' and (a.selection_type<>'single' or minimum<>1 or maximum<>1
      or exists(select 1 from public.product_sizes s where s.product_id=p_product and not exists(
        select 1 from public.product_size_option_choice_compatibility t join public.option_choices c on c.id=t.option_choice_id
        where t.product_id=p_product and t.product_size_id=s.id and t.is_active and c.is_active and configuration_private.choice_allowed(p_product,c.id) and c.option_group_id=a.option_group_id))) then
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

create or replace function configuration_private.price_order_configuration(p_items jsonb) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare result jsonb; failure text;
begin
  -- PRICING_QUERY_BEGIN: tests EXPLAIN this exact query, not a simplified copy.
  with
  raw_lines as materialized (select * from configuration_private.pricing_input_lines(p_items)),
  merged as materialized (
    select product_id,product_size_id,option_choice_ids,item_note,sum(quantity)::numeric quantity,
      jsonb_build_object('product_id',product_id,'product_size_id',product_size_id,'option_choice_ids',option_choice_ids,'item_note',item_note) identity
    from raw_lines group by product_id,product_size_id,option_choice_ids,item_note
  ),
  lines as materialized (select row_number() over(order by identity::text collate "C")-1 line_index,m.* from merged m),
  requested_products as materialized (select distinct product_id from lines),
  products as materialized (select p.*,c.name category_name from requested_products r join public.products p on p.id=r.product_id left join public.categories c on c.id=p.category_id),
  sizes as materialized (select s.*,to_jsonb(s) data from requested_products r join public.product_sizes s on s.product_id=r.product_id),
  assignments as materialized (select a.*,to_jsonb(a) data from requested_products r join public.product_option_groups a on a.product_id=r.product_id),
  groups as materialized (select a.product_id,g.*,to_jsonb(g) data from assignments a join public.option_groups g on g.id=a.option_group_id),
  choices as materialized (select g.product_id,c.*,to_jsonb(c) data from groups g join public.option_choices c on c.option_group_id=g.id),
  defaults as materialized (select d.*,to_jsonb(d) data from requested_products r join public.product_option_defaults d on d.product_id=r.product_id),
  compatibility as materialized (select t.*,to_jsonb(t) data from requested_products r join public.product_size_option_choice_compatibility t on t.product_id=r.product_id),
  requirements as materialized (select q.*,to_jsonb(q) data from requested_products r join public.product_option_choice_override_requirements q on q.product_id=r.product_id),
  overrides as materialized (select o.*,to_jsonb(o) data from requested_products r join public.product_option_choice_price_overrides o on o.product_id=r.product_id),
  -- D0B1 structure v1 reconstructed in bulk. All rows, including inactive ones,
  -- participate, exactly as catalog_structure() specifies. No per-product calls.
  structures as materialized (
    select r.product_id,jsonb_build_object('structure_version',1,'product_id',r.product_id,
      'sizes',coalesce(s.data,'[]'::jsonb),'assignments',coalesce(a.data,'[]'::jsonb),'groups',coalesce(g.data,'[]'::jsonb),
      'choices',coalesce(c.data,'[]'::jsonb),'defaults',coalesce(d.data,'[]'::jsonb),'compatibility',coalesce(t.data,'[]'::jsonb),
      'requirements',coalesce(q.data,'[]'::jsonb),'overrides',coalesce(o.data,'[]'::jsonb)) || configuration_private.choice_policy_structure(r.product_id) data
    from requested_products r
    left join (select product_id,jsonb_agg(data order by id) data from sizes group by product_id) s using(product_id)
    left join (select product_id,jsonb_agg(data order by option_group_id) data from assignments group by product_id) a using(product_id)
    left join (select product_id,jsonb_agg(data order by id) data from groups group by product_id) g using(product_id)
    left join (select product_id,jsonb_agg(data order by id) data from choices group by product_id) c using(product_id)
    left join (select product_id,jsonb_agg(data order by option_group_id,option_choice_id) data from defaults group by product_id) d using(product_id)
    left join (select product_id,jsonb_agg(data order by product_size_id,option_choice_id) data from compatibility group by product_id) t using(product_id)
    left join (select product_id,jsonb_agg(data order by option_choice_id,product_size_id nulls first) data from requirements group by product_id) q using(product_id)
    left join (select product_id,jsonb_agg(data order by option_choice_id,product_size_id nulls first) data from overrides group by product_id) o using(product_id)
  ),
  active_choices as materialized (
    select c.*,g.name group_name,g.group_key from choices c
    join groups g on g.product_id=c.product_id and g.id=c.option_group_id and g.is_active
    join assignments a on a.product_id=c.product_id and a.option_group_id=c.option_group_id and a.is_active where c.is_active and configuration_private.choice_allowed(c.product_id,c.id)
  ),
  group_stats as materialized (
    select a.product_id,a.option_group_id,a.min_selections,g.selection_type,g.group_key,g.is_active group_active,
      greatest(a.min_selections,case when a.is_required then 1 else 0 end) minimum,
      coalesce(a.max_selections,case when g.selection_type='single' then 1 else coalesce(c.n,0) end) maximum,
      coalesce(c.n,0) choices_count,coalesce(d.n,0) defaults_count,coalesce(d.valid,0) valid_defaults
    from assignments a join groups g on g.product_id=a.product_id and g.id=a.option_group_id
    left join (select product_id,option_group_id,count(*) n from choices where is_active and configuration_private.choice_allowed(product_id,id) group by product_id,option_group_id) c on c.product_id=a.product_id and c.option_group_id=a.option_group_id
    left join (select d.product_id,d.option_group_id,count(*) n,count(c.id) valid from defaults d left join choices c
      on c.product_id=d.product_id and c.option_group_id=d.option_group_id and c.id=d.option_choice_id and c.is_active and configuration_private.choice_allowed(c.product_id,c.id) group by d.product_id,d.option_group_id) d on d.product_id=a.product_id and d.option_group_id=a.option_group_id
    where a.is_active
  ),
  configuration_issues as materialized (
    select s.product_id from structures s left join configuration_private.product_pricing_certifications c on c.product_id=s.product_id
      where c.structure_version is distinct from 1 or c.expected_structure is distinct from s.data
    union all select product_id from sizes where not (price>=0 and price<=999999.99 and price=round(price,2)) is true
    union all select product_id from choices where is_active and not (price_delta>=0 and price_delta<=999999.99 and price_delta=round(price_delta,2)) is true
    union all select product_id from group_stats where not group_active or selection_type not in ('single','multi') or min_selections<0
      or maximum<minimum or choices_count=0 or choices_count<minimum or (selection_type='single' and (maximum>1 or minimum>1))
      or defaults_count<>valid_defaults or valid_defaults<minimum or valid_defaults>maximum
      or (group_key='temperature' and (selection_type<>'single' or minimum<>1 or maximum<>1))
    union all select d.product_id from defaults d where not exists(select 1 from assignments a where a.product_id=d.product_id and a.option_group_id=d.option_group_id and a.is_active)
    union all select t.product_id from compatibility t left join active_choices c on c.product_id=t.product_id and c.id=t.option_choice_id
      where t.is_active and (c.id is null or c.group_key<>'temperature')
    union all select g.product_id from group_stats g join sizes s on s.product_id=g.product_id
      where g.group_key='temperature' and not exists(select 1 from compatibility t join active_choices c on c.product_id=t.product_id and c.id=t.option_choice_id
        where t.product_id=s.product_id and t.product_size_id=s.id and t.is_active and c.option_group_id=g.option_group_id)
    union all select o.product_id from overrides o left join active_choices c on c.product_id=o.product_id and c.id=o.option_choice_id
      where o.is_active and (c.id is null or not (o.price_delta>=0 and o.price_delta<=999999.99 and o.price_delta=round(o.price_delta,2)) is true)
    union all select product_id from overrides where is_active group by product_id,product_size_id,option_choice_id having count(*)>1
    union all select q.product_id from requirements q left join active_choices c on c.product_id=q.product_id and c.id=q.option_choice_id
      where q.is_active and (c.id is null or not exists(select 1 from overrides o where o.product_id=q.product_id and o.option_choice_id=q.option_choice_id
        and o.is_active and o.product_size_id is not distinct from q.product_size_id))
  ),
  selections as materialized (select l.line_index,l.product_id,l.product_size_id,u.choice_id from lines l cross join lateral unnest(l.option_choice_ids) u(choice_id)),
  resolved_choices as materialized (
    select s.*,c.option_group_id,c.group_name,c.group_key,c.label,c.value,
      configuration_private.effective_choice_price(s.product_id,s.product_size_id,s.choice_id) effective_price_delta,c.id valid_id
    from selections s left join active_choices c on c.product_id=s.product_id and c.id=s.choice_id
    left join overrides sz on sz.product_id=s.product_id and sz.product_size_id=s.product_size_id and sz.option_choice_id=s.choice_id and sz.is_active
    left join overrides pr on pr.product_id=s.product_id and pr.product_size_id is null and pr.option_choice_id=s.choice_id and pr.is_active
  ),
  selected_counts as materialized (select line_index,option_group_id,count(*) n from resolved_choices where valid_id is not null group by line_index,option_group_id),
  cardinality as materialized (
    select l.line_index,g.minimum,g.maximum,coalesce(c.n,0) selected_count from lines l join group_stats g on g.product_id=l.product_id
    left join selected_counts c on c.line_index=l.line_index and c.option_group_id=g.option_group_id
  ),
  line_effects as materialized (
    select line_index,sum(effective_price_delta) option_total,
      jsonb_agg(jsonb_build_object('group_id',option_group_id,'group_key',group_key,'group_name',group_name,
        'choice_id',choice_id,'label',label,'value',value,'effective_price_delta',effective_price_delta) order by choice_id) options
    from resolved_choices group by line_index
  ),
  priced as materialized (
    select l.*,p.name product_name,p.category_name,s.label size_label,s.price base_price,
      coalesce(e.option_total,0) option_total,coalesce(e.options,'[]'::jsonb) options,
      s.price+coalesce(e.option_total,0) unit_price,(s.price+coalesce(e.option_total,0))*l.quantity line_total
    from lines l left join products p on p.id=l.product_id left join sizes s on s.id=l.product_size_id and s.product_id=l.product_id
    left join line_effects e using(line_index)
  ),
  error as (
    select case
      when exists(select 1 from lines where quantity>2147483647) then 'QUANTITY_INVALID'
      when exists(select 1 from requested_products r left join products p on p.id=r.product_id where p.id is null or not p.is_available or not p.is_published or p.is_sold_out or p.archived_at is not null) then 'PRODUCT_UNAVAILABLE'
      when exists(select 1 from lines l where not exists(select 1 from sizes s where s.id=l.product_size_id and s.product_id=l.product_id)) then 'SIZE_INVALID'
      when exists(select 1 from configuration_issues) then 'CONFIGURATION_INVALID'
      when exists(select 1 from resolved_choices where valid_id is null) then 'OPTION_INVALID'
      when exists(select 1 from cardinality where selected_count=0 and minimum>0) then 'OPTION_REQUIRED'
      when exists(select 1 from cardinality where selected_count<minimum or selected_count>maximum) then 'OPTION_SELECTION_INVALID'
      when exists(select 1 from resolved_choices c where c.group_key='temperature' and not exists(select 1 from compatibility t
        where t.product_id=c.product_id and t.product_size_id=c.product_size_id and t.option_choice_id=c.choice_id and t.is_active)) then 'OPTION_SELECTION_INVALID'
      when exists(select 1 from priced where not (unit_price>=0 and unit_price<=99999999.99 and unit_price=round(unit_price,2)) is true) then 'CONFIGURATION_INVALID'
      when exists(select 1 from priced where not (line_total>=0 and line_total<=99999999.99 and line_total=round(line_total,2)) is true)
        or not ((select sum(line_total) from priced)<=99999999.99) is true then 'QUANTITY_INVALID'
      else null end code
  )
  select error.code,case when error.code is null then jsonb_build_object(
    'pricing_contract_version',2,'pricing_policy_version','curv-cart-v2.1','currency','PHP',
    'subtotal',to_char((select sum(line_total) from priced),'FM999999990.00'),
    'items',(select jsonb_agg(jsonb_build_object(
      'line_index',line_index,'product_id',product_id,'product_size_id',product_size_id,'option_choice_ids',option_choice_ids,
      'quantity',quantity,'item_note',item_note,'product_name',product_name,'category_name',category_name,'size_label',size_label,
      'base_price',to_char(base_price,'FM999999990.00'),'option_total',to_char(option_total,'FM999999990.00'),
      'unit_price',to_char(unit_price,'FM999999990.00'),'line_total',to_char(line_total,'FM999999990.00'),
      'options',options,'pricing_policy_version','curv-cart-v2.1',
      'pricing_configuration_snapshot',jsonb_build_object('contract_version',2,'pricing_policy_version','curv-cart-v2.1',
        'product_id',product_id,'product_size_id',product_size_id,'option_choice_ids',option_choice_ids,'options',options)
    ) order by line_index) from priced)) end into failure,result from error;
  -- PRICING_QUERY_END
  if failure is not null then perform configuration_private.pricing_error(failure); end if;
  return result;
end $$;

create or replace function public.get_public_configuration_compatibility()
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
   and configuration_private.choice_allowed(p.id,c.id) and c.is_active and g.is_active and a.is_active and g.group_key='temperature';
$$;

create or replace function menu_save_private.guard_catalog_write() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare target uuid;
begin
 -- Display order is not part of pricing; preserve the existing narrow UI path.
 if TG_TABLE_NAME='products' and TG_OP='UPDATE' then
   if (to_jsonb(NEW)-'sort_order'-'updated_at')=(to_jsonb(OLD)-'sort_order'-'updated_at') then return NEW; end if;
 end if;
 if TG_TABLE_NAME in ('products','product_sizes','product_option_choice_policies') and TG_OP<>'DELETE' then
   target:=case when TG_TABLE_NAME='products' then (to_jsonb(NEW)->>'id')::uuid else (to_jsonb(NEW)->>'product_id')::uuid end;
 elsif TG_TABLE_NAME in ('product_sizes','product_option_choice_policies') then target:=OLD.product_id;
 end if;
 if target is not null and exists(select 1 from menu_save_private.active_save
   where backend=pg_backend_pid() and transaction_id=txid_current() and product_id=target) then
   if TG_OP='DELETE' then return OLD; end if; return NEW;
 end if;
 raise exception 'Use the product editor to save. Customer option editing is temporarily read-only.' using detail='MM_SAVE_BOUNDARY';
end $$;

create or replace function public.menu_manager_save_product(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog set lock_timeout='3s' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); request_id uuid; pid uuid; old public.products%rowtype;
 fields jsonb; sizes jsonb; action text; old_structure jsonb; reviewed jsonb; result jsonb;
 replay menu_save_private.requests%rowtype; published boolean; live boolean; key text; removed record;
begin
 if actor is null or not coalesce(public.is_admin(),false) then
   raise exception 'Owner access is required to save products.' using detail='MM_SAVE_AUTH';
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Please retry this save in a new session.' using detail='MM_SAVE_INPUT';
 end if;
 if jsonb_typeof(p_request) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_request) k
   where k not in ('request_id','product_id','expected_version','action','product','sizes')) then
   raise exception 'Please reload the editor and try again.' using detail='MM_SAVE_INPUT';
 end if;
 request_id:=(p_request->>'request_id')::uuid;
 pid:=(p_request->>'product_id')::uuid;
 if request_id is null then raise exception 'Please reload the editor and try again.' using detail='MM_SAVE_INPUT'; end if;
 -- Lock all configuration sources before version/review checks. Short serialized
 -- cafe saves avoid phantom option inserts from legacy security-definer writers.
 -- No order table is locked; normal pricing reads continue.
 lock table public.categories,public.category_sections,public.products,public.product_sizes,
   public.option_groups,public.option_choices,public.product_option_groups,public.product_option_defaults,
   public.product_size_option_choice_compatibility,public.product_option_choice_price_overrides,
   public.product_option_choice_override_requirements,public.product_option_choice_policies,configuration_private.product_pricing_certifications
   in share row exclusive mode;
 select * into replay from menu_save_private.requests r where r.actor=actor and r.request_id=request_id;
 if found then
   if replay.request is distinct from p_request then raise exception 'This save request changed. Reload before saving.' using detail='MM_SAVE_KEY_CONFLICT'; end if;
   return replay.result;
 end if;
 fields:=p_request->'product'; sizes:=p_request->'sizes'; action:=p_request->>'action';
 if action is null or action not in ('save','publish','unpublish') or jsonb_typeof(fields) is distinct from 'object' then
   raise exception 'Please reload the editor and try again.' using detail='MM_SAVE_INPUT'; end if;
 if exists(select 1 from jsonb_object_keys(fields) k where k not in ('name','category_id','category_section_id','description','image_url','notes',
   'badge_labels','variant_group_name','is_available','is_sold_out','is_curv_pick','is_seasonal')) then
   raise exception 'Please reload the editor and try again.' using detail='MM_SAVE_INPUT'; end if;
 foreach key in array array['is_available','is_sold_out','is_curv_pick','is_seasonal'] loop
   if jsonb_typeof(fields->key) is distinct from 'boolean' then raise exception 'Please review the product settings.' using detail='MM_SAVE_INPUT'; end if;
 end loop;
 if nullif(btrim(fields->>'name'),'') is null then raise exception 'Enter a product name.' using detail='MM_SAVE_NAME'; end if;
 if jsonb_typeof(sizes) is distinct from 'array' then raise exception 'This product needs at least one size.' using detail='MM_SAVE_SIZES'; end if;
 if jsonb_array_length(sizes)=0 then
   raise exception 'This product needs at least one size.' using detail='MM_SAVE_SIZES'; end if;
 if exists(select 1 from jsonb_array_elements(sizes) x where nullif(x->>'price','') is null or (x->>'price')::numeric not between 0 and 999999.99 or (x->>'price')::numeric<>round((x->>'price')::numeric,2)) then
   raise exception 'Add a valid price before saving.' using detail='MM_SIZE_PRICE_INVALID'; end if;
 if not exists(select 1 from public.categories where id=(fields->>'category_id')::uuid and is_active) then
   raise exception 'Choose an available category.' using detail='MM_SAVE_CATEGORY'; end if;
 if nullif(fields->>'category_section_id','') is not null and not exists(select 1 from public.category_sections
   where id=(fields->>'category_section_id')::uuid and category_id=(fields->>'category_id')::uuid) then
   raise exception 'Choose a section in this category.' using detail='MM_SAVE_CATEGORY'; end if;
 if pid is not null then
   select * into old from public.products where id=pid for update;
   if not found or old.archived_at is not null then raise exception 'This product is no longer editable. Reload before saving.' using detail='MM_SAVE_MISSING'; end if;
   perform 1 from public.product_sizes where product_id=pid for update;
   if p_request->>'expected_version' is distinct from menu_save_private.editor_version(pid) then
     raise exception 'This product changed in another session. Reload before saving.' using detail='MM_SAVE_STALE'; end if;
   old_structure:=configuration_private.catalog_structure(pid);
   select expected_structure into reviewed from configuration_private.product_pricing_certifications where product_id=pid and structure_version=1;
   -- A price edit is not permission to bless unrelated pre-existing option drift.
   if (jsonb_array_length(old_structure->'assignments')>0 or reviewed is not null)
     and reviewed is distinct from old_structure and (action='publish' or (action='save' and old.is_published)) then
     raise exception 'Some customer options need attention. Your live product was not changed.' using detail='MM_SAVE_OPTIONS'; end if;
   -- Coverage validates existing tuples; it cannot infer the intended price for
   -- a NEW contextual size (e.g. cheese per piece count). Never certify that gap.
   if exists(select 1 from jsonb_array_elements(sizes) x where nullif(x->>'id','') is null)
     and (exists(select 1 from public.product_size_option_choice_compatibility where product_id=pid)
       or exists(select 1 from public.product_option_choice_price_overrides where product_id=pid and product_size_id is not null)
       or exists(select 1 from public.product_option_choice_override_requirements where product_id=pid and product_size_id is not null)) then
     raise exception 'New sizes need matching customer options before they can be added to this item.' using detail='MM_SAVE_SIZE_CONFIGURATION'; end if;
   for removed in select s.id from public.product_sizes s where s.product_id=pid and not exists(
     select 1 from jsonb_array_elements(sizes) x where x->>'id'=s.id::text) loop
     if exists(select 1 from pg_constraint where contype='f' and confrelid='public.product_sizes'::regclass
       and conrelid not in ('public.inventory_recipes'::regclass,'public.product_size_option_choice_compatibility'::regclass,
         'public.product_option_choice_price_overrides'::regclass,'public.product_option_choice_override_requirements'::regclass)) then
       raise exception 'This size has another dependency and cannot be removed yet.' using detail='MM_SAVE_SIZE_OPTIONS'; end if;
     if exists(select 1 from public.inventory_recipes where product_size_id=removed.id) then
       raise exception 'This size is used by a recipe and cannot be removed.' using detail='MM_SAVE_RECIPE'; end if;
     if exists(select 1 from public.product_size_option_choice_compatibility where product_size_id=removed.id)
       or exists(select 1 from public.product_option_choice_price_overrides where product_size_id=removed.id)
       or exists(select 1 from public.product_option_choice_override_requirements where product_size_id=removed.id) then
       raise exception 'This size is used by customer options and cannot be removed yet.' using detail='MM_SAVE_SIZE_OPTIONS'; end if;
   end loop;
 else
   if p_request->>'expected_version' is not null then raise exception 'Reload before creating this product.' using detail='MM_SAVE_INPUT'; end if;
   pid:=gen_random_uuid();
 end if;
 published:=case action when 'publish' then true when 'unpublish' then false else coalesce(old.is_published,false) end;
 -- Until public recipe expectations become data-driven, a zero-option product
 -- cannot adopt an existing specialized recipe name. Names frozen from the
 -- reviewed public recipe contract; regression test checks this list stays aligned.
 if published and not exists(select 1 from public.product_option_groups where product_id=pid and is_active)
   and regexp_replace(lower(btrim(fields->>'name')),'\s+',' ','g')=any(array['hojicha banana pudding latte','hojicha brûlée','hojicha latte','sea salt cream hojicha','pink hojicha latte','brown sugar cinnamon cream latte','cloud spanish oat latte','curv latte','curv seasalt latte','iced shaken vanilla jelly','seasalt dark latte','einspanner latte','spanish latte','caramel macchiato','vanilla latte','americano','cafè mocha','white chocolate mocha','white ube latte','cocoa caramel latte','double chocolate chip cream','javachip brownie curvccino','javachip jelly curvccino','strawberries & cream','white caramel curvccino','tropic kiss','tokyo sunrise','hibiscus cream tea','lime cucumber','og takoyaki','aburi salmon','oozie cheese','lava melt','classic veggie','salted egg','caffè mocha']) then
   raise exception 'This item needs customer options before it can be published.' using detail='MM_SAVE_OPTIONS';
 end if;
 insert into menu_save_private.active_save values(pg_backend_pid(),txid_current(),pid);
 if old.id is null then
   insert into public.products(id,category_id,name) values(pid,(fields->>'category_id')::uuid,btrim(fields->>'name'));
 end if;
 update public.products set name=btrim(fields->>'name'),category_id=(fields->>'category_id')::uuid,
   category_section_id=nullif(fields->>'category_section_id','')::uuid,description=fields->>'description',
   image_url=fields->>'image_url',notes=fields->>'notes',variant_group_name=fields->>'variant_group_name',
   badge_labels=coalesce(array(select jsonb_array_elements_text(fields->'badge_labels')),array[]::text[]),
   is_available=(fields->>'is_available')::boolean,is_sold_out=(fields->>'is_sold_out')::boolean,
   is_curv_pick=(fields->>'is_curv_pick')::boolean,is_seasonal=(fields->>'is_seasonal')::boolean,is_published=published where id=pid;
 -- Keep the reviewed reconciler, but ignore caller sort indexes: array order wins.
 select jsonb_agg(x.value||jsonb_build_object('sort_order',x.ordinality-1) order by x.ordinality) into sizes
   from jsonb_array_elements(sizes) with ordinality x;
 perform public.menu_manager_reconcile_product_sizes(pid,sizes);
 live:=published and (fields->>'is_available')::boolean and not (fields->>'is_sold_out')::boolean;
 if published or (reviewed is not null and reviewed=old_structure) then
   perform configuration_private.validate_product_coverage(pid);
   perform configuration_private.certify_product(pid,configuration_private.catalog_structure(pid),'Owner product save; actor '||actor::text||'; request '||request_id::text);
   if live then perform configuration_private.assert_pricing_ready(pid); end if;
 end if;
 delete from menu_save_private.active_save where backend=pg_backend_pid() and transaction_id=txid_current();
 result:=jsonb_build_object('ok',true,'product_id',pid,'is_published',published,'orderable',live,'version',menu_save_private.editor_version(pid));
 insert into menu_save_private.requests values(actor,request_id,p_request,result,clock_timestamp());
 return result;
 -- Exceptions unwind EVERY write above before exposing only safe messages.
exception
 when lock_not_available or deadlock_detected then raise exception 'Another menu change is being saved. Please try again.' using detail='MM_SAVE_BUSY';
 when invalid_text_representation or numeric_value_out_of_range then raise exception 'Please review the product values and try again.' using detail='MM_SAVE_INPUT';
end $$;


create trigger mm_phase1_save_guard before insert or update or delete on public.product_option_choice_policies
 for each row execute function menu_save_private.guard_catalog_write();
create function configuration_private.effective_product_choices(p_product uuid)
returns table(product_id uuid,option_group_id uuid,option_choice_id uuid,label text,value text,price_delta numeric,sort_order integer,price_by_size jsonb)
language sql stable set search_path=pg_catalog as $$
 select a.product_id,c.option_group_id,c.id,c.label,c.value,
 configuration_private.effective_choice_price(a.product_id,null,c.id),c.sort_order,
 coalesce((select jsonb_object_agg(s.id,configuration_private.effective_choice_price(a.product_id,s.id,c.id))
   from public.product_sizes s where s.product_id=a.product_id),'{}'::jsonb)
 from public.product_option_groups a join public.option_choices c on c.option_group_id=a.option_group_id
 where a.product_id=p_product and configuration_private.choice_allowed(a.product_id,c.id);
$$;
create function public.get_public_effective_option_choices()
returns table(product_id uuid,option_group_id uuid,option_choice_id uuid,label text,value text,price_delta numeric,sort_order integer,price_by_size jsonb)
language sql stable security definer set search_path=pg_catalog as $$
 select e.* from public.products p cross join lateral configuration_private.effective_product_choices(p.id) e
 where p.is_published and p.is_available and p.archived_at is null;
$$;
revoke all on function public.get_public_effective_option_choices() from public,anon,authenticated;
grant execute on function public.get_public_effective_option_choices() to anon,authenticated;
create or replace view public.public_menu_option_choices with (security_invoker=true) as
 select * from public.get_public_effective_option_choices();
revoke all on public.public_menu_option_choices from public;
grant select on public.public_menu_option_choices to anon,authenticated;
revoke all on function configuration_private.choice_policy_structure(uuid),
 configuration_private.effective_choice_price(uuid,uuid,uuid),configuration_private.effective_product_choices(uuid)
 from public,anon,authenticated;
create or replace function public.menu_manager_get_product_editor(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then
   raise exception 'Owner access is required to edit products.' using detail='MM_SAVE_AUTH';
 end if;
 return (select jsonb_build_object('product',to_jsonb(p)||jsonb_build_object('product_sizes',
   coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order,s.id) from public.product_sizes s where s.product_id=p.id),'[]'::jsonb)),
   'version',menu_save_private.editor_version(p.id),
   'option_configuration',jsonb_build_object('structure',configuration_private.catalog_structure(p.id),
     'choices',coalesce((select jsonb_agg(to_jsonb(e) order by e.option_group_id,e.sort_order,e.option_choice_id)
       from configuration_private.effective_product_choices(p.id) e),'[]'::jsonb))) from public.products p where p.id=p_product_id and p.archived_at is null);
end $$;

do $postflight$
begin
 if exists(select 1 from phase3a_before b where b.structure is distinct from configuration_private.catalog_structure(b.id)
    or b.certification is distinct from (select to_jsonb(c) from configuration_private.product_pricing_certifications c where c.product_id=b.id)) then
   raise exception 'Unexpected existing catalog/certification change.' using detail='MM_3A_PRESERVATION';
 end if;
 if exists(select 1 from public.product_option_choice_policies) then
   raise exception 'Policy table must be empty after installation.' using detail='MM_3A_PRESERVATION';
 end if;
end $postflight$;
commit;
