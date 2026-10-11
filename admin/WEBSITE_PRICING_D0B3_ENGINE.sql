-- LOCAL DRAFT ONLY. Apply after D0B1/D0B2 in a reviewed environment.
-- Private read-only pricing. No public RPC, checkout replacement or catalog seed.
begin;
do $$
declare r record;
begin
  if to_regnamespace('configuration_private') is null
    or to_regprocedure('submission_private.uuid_value(jsonb)') is null
    or to_regprocedure('submission_private.text_value(jsonb,integer)') is null
    or to_regprocedure('configuration_private.catalog_structure(uuid)') is null
    or to_regprocedure('configuration_private.valid_pricing_snapshot(jsonb)') is null
    or not exists(select 1 from pg_roles where rolname='anon')
    or not exists(select 1 from pg_roles where rolname='authenticated') then
    raise exception 'D0B3 prerequisite missing' using detail='D0B3_PREREQUISITE';
  end if;
  if exists(select 1 from pg_proc where pronamespace='configuration_private'::regnamespace
    and proname in ('pricing_error','pricing_input_lines','price_order_configuration')) then
    raise exception 'D0B3 function collision; inspect definitions' using detail='D0B3_COLLISION';
  end if;
  for r in select * from (values
    ('public','products','id','uuid'),('public','products','name','text'),('public','products','category_id','uuid'),
    ('public','products','is_published','boolean'),('public','products','is_available','boolean'),('public','products','is_sold_out','boolean'),('public','products','archived_at','timestamp with time zone'),
    ('public','categories','id','uuid'),('public','categories','name','text'),
    ('public','product_sizes','id','uuid'),('public','product_sizes','product_id','uuid'),('public','product_sizes','price','numeric'),('public','product_sizes','label','text'),
    ('public','option_groups','id','uuid'),('public','option_groups','name','text'),('public','option_groups','group_key','text'),('public','option_groups','selection_type','text'),('public','option_groups','is_active','boolean'),
    ('public','option_choices','id','uuid'),('public','option_choices','option_group_id','uuid'),('public','option_choices','label','text'),('public','option_choices','value','text'),('public','option_choices','price_delta','numeric'),('public','option_choices','is_active','boolean'),
    ('public','product_option_groups','product_id','uuid'),('public','product_option_groups','option_group_id','uuid'),('public','product_option_groups','is_active','boolean'),('public','product_option_groups','is_required','boolean'),('public','product_option_groups','min_selections','integer'),('public','product_option_groups','max_selections','integer'),
    ('public','product_option_defaults','product_id','uuid'),('public','product_option_defaults','option_group_id','uuid'),('public','product_option_defaults','option_choice_id','uuid'),
    ('public','product_option_choice_price_overrides','product_id','uuid'),('public','product_option_choice_price_overrides','product_size_id','uuid'),('public','product_option_choice_price_overrides','option_choice_id','uuid'),('public','product_option_choice_price_overrides','price_delta','numeric'),('public','product_option_choice_price_overrides','is_active','boolean'),
    ('public','product_option_choice_override_requirements','product_id','uuid'),('public','product_option_choice_override_requirements','product_size_id','uuid'),('public','product_option_choice_override_requirements','option_choice_id','uuid'),('public','product_option_choice_override_requirements','specificity','text'),('public','product_option_choice_override_requirements','is_active','boolean'),
    ('public','product_size_option_choice_compatibility','product_id','uuid'),('public','product_size_option_choice_compatibility','product_size_id','uuid'),('public','product_size_option_choice_compatibility','option_choice_id','uuid'),('public','product_size_option_choice_compatibility','is_active','boolean'),
    ('configuration_private','product_pricing_certifications','product_id','uuid'),('configuration_private','product_pricing_certifications','expected_structure','jsonb'),('configuration_private','product_pricing_certifications','structure_version','smallint')
  ) v(sch,tbl,col,typ) loop
    if not exists(select 1 from information_schema.columns where table_schema=r.sch and table_name=r.tbl and column_name=r.col and data_type=r.typ) then
      raise exception 'D0B3 missing/incompatible prerequisite %.%.%',r.sch,r.tbl,r.col using detail='D0B3_PREREQUISITE';
    end if;
  end loop;
  for r in select unnest(array['d0a1_override_product_choice','d0a1_override_size_choice','d0a1_requirement_product_choice','d0a1_requirement_size_choice']) n loop
    if not exists(select 1 from pg_index where indexrelid=to_regclass('public.'||r.n) and indisunique and indisvalid and indisready) then
      raise exception 'D0B3 unique index prerequisite missing' using detail='D0B3_PREREQUISITE';
    end if;
  end loop;
end $$;

create function configuration_private.pricing_error(p_code text) returns void
language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p_code not in ('ORDER_CART_INVALID','QUANTITY_INVALID','PRODUCT_UNAVAILABLE','SIZE_INVALID','OPTION_INVALID','OPTION_REQUIRED','OPTION_SELECTION_INVALID','CONFIGURATION_INVALID') or p_code is null then
    raise exception 'Unable to price this order.' using errcode='P0001',detail='CONFIGURATION_INVALID';
  end if;
  raise exception 'Please review the selected items and options.' using errcode='22023',detail=p_code;
end $$;

-- Pure bounded structural normalization; NO catalog reads. IDs are cast once.
-- Mirrors frozen D0B2 item semantics without invented checkout/customer fields.
create function configuration_private.pricing_input_lines(p_items jsonb)
returns table(product_id uuid,product_size_id uuid,option_choice_ids uuid[],quantity integer,item_note text)
language plpgsql immutable rows 30 set search_path=pg_catalog as $$
declare item jsonb; choice jsonb; selected uuid; amount numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or octet_length(p_items::text)>262144 then perform configuration_private.pricing_error('ORDER_CART_INVALID'); end if;
  if jsonb_array_length(p_items) not between 1 and 30 then perform configuration_private.pricing_error('ORDER_CART_INVALID'); end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' then perform configuration_private.pricing_error('ORDER_CART_INVALID'); end if;
    if exists(select 1 from jsonb_object_keys(item) k where k<>all(array[
      'product_id','product_size_id','option_choice_ids','quantity','item_note',
      'product_name','name','category_name','variant_label','size_label','unit_price','line_total','subtotal','total',
      'options','option_snapshots','sort_order','pricing_configuration_snapshot','pricing_policy_version','ui_state'])) then perform configuration_private.pricing_error('ORDER_CART_INVALID'); end if;
    product_id:=submission_private.uuid_value(item->'product_id');
    product_size_id:=submission_private.uuid_value(item->'product_size_id');
    item_note:=submission_private.text_value(item->'item_note',500);
    if jsonb_typeof(item->'quantity') is distinct from 'number' then perform configuration_private.pricing_error('QUANTITY_INVALID'); end if;
    amount:=(item->>'quantity')::numeric;
    if amount<1 or amount>2147483647 or amount<>trunc(amount) then perform configuration_private.pricing_error('QUANTITY_INVALID'); end if;
    quantity:=amount::integer;
    if jsonb_typeof(item->'option_choice_ids') is distinct from 'array' then perform configuration_private.pricing_error('ORDER_CART_INVALID'); end if;
    if jsonb_array_length(item->'option_choice_ids')>64 then perform configuration_private.pricing_error('ORDER_CART_INVALID'); end if;
    option_choice_ids:='{}';
    for choice in select value from jsonb_array_elements(item->'option_choice_ids') loop
      selected:=submission_private.uuid_value(choice);
      if selected=any(option_choice_ids) then perform configuration_private.pricing_error('OPTION_SELECTION_INVALID'); end if;
      option_choice_ids:=array_append(option_choice_ids,selected);
    end loop;
    select coalesce(array_agg(x order by x),'{}'::uuid[]) into option_choice_ids from unnest(option_choice_ids) x;
    return next;
  end loop;
end $$;

create function configuration_private.price_order_configuration(p_items jsonb) returns jsonb
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
      'requirements',coalesce(q.data,'[]'::jsonb),'overrides',coalesce(o.data,'[]'::jsonb)) data
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
    join assignments a on a.product_id=c.product_id and a.option_group_id=c.option_group_id and a.is_active where c.is_active
  ),
  group_stats as materialized (
    select a.product_id,a.option_group_id,a.min_selections,g.selection_type,g.group_key,g.is_active group_active,
      greatest(a.min_selections,case when a.is_required then 1 else 0 end) minimum,
      coalesce(a.max_selections,case when g.selection_type='single' then 1 else coalesce(c.n,0) end) maximum,
      coalesce(c.n,0) choices_count,coalesce(d.n,0) defaults_count,coalesce(d.valid,0) valid_defaults
    from assignments a join groups g on g.product_id=a.product_id and g.id=a.option_group_id
    left join (select product_id,option_group_id,count(*) n from choices where is_active group by product_id,option_group_id) c on c.product_id=a.product_id and c.option_group_id=a.option_group_id
    left join (select d.product_id,d.option_group_id,count(*) n,count(c.id) valid from defaults d left join choices c
      on c.product_id=d.product_id and c.option_group_id=d.option_group_id and c.id=d.option_choice_id and c.is_active group by d.product_id,d.option_group_id) d on d.product_id=a.product_id and d.option_group_id=a.option_group_id
    where a.is_active
  ),
  configuration_issues as materialized (
    select s.product_id from structures s left join configuration_private.product_pricing_certifications c on c.product_id=s.product_id
      where c.structure_version is distinct from 1 or c.expected_structure is distinct from s.data
    union all select product_id from sizes where not (price>=0 and price<=999999.99 and price=round(price,2)) is true
    union all select product_id from choices where is_active and not (price_delta>=0 and price_delta<=999999.99 and price_delta=round(price_delta,2)) is true
    union all select product_id from group_stats where not group_active or selection_type not in ('single','multi') or min_selections<0
      or maximum<minimum or choices_count<minimum or (selection_type='single' and (maximum>1 or minimum>1))
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
      coalesce(sz.price_delta,pr.price_delta,c.price_delta) effective_price_delta,c.id valid_id
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
revoke all on function configuration_private.pricing_error(text),configuration_private.pricing_input_lines(jsonb),configuration_private.price_order_configuration(jsonb) from public,anon,authenticated;
commit;
