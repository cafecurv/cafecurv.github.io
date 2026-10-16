-- LOCAL REVIEW DRAFT ONLY. First application; backend before matching POS frontend.
-- Never rerun blindly. No data writes, new grants, or changes to stored snapshots.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $preflight$
declare r record;
begin
 for r in select * from (values
('public.pos_get_catalog()','05b1cc7f5c6f3ec167ba2526cb01be92'),
('pos_private.resolve_line(uuid,uuid[])','c9a3cc4a6c2118aa0845da08c69fd683'),
('configuration_private.choice_allowed(uuid,uuid)','53ed6fea03e68f9e131a67d82168059f'),
('configuration_private.effective_choice_price(uuid,uuid,uuid)','b38c7b7b6374dfc9ec8b88e972b6dfba'),
('configuration_private.effective_product_choices(uuid)','7f2fa018292bf7648ad683ca0c3e2023'),
('configuration_private.choice_delta(uuid,uuid,uuid)','7fd4f00726a76ec1c3f3fa82a7b9a885'),
('configuration_private.validate_product_coverage(uuid)','dfd56bd5984b49fb286a84b6e5378525'),
('menu_save_private.reconcile_options(uuid,jsonb)','a7f38141ec0b7099eb30fc15c295652d')
 ) x(signature,source_md5) loop
 if not exists(select 1 from pg_proc where oid=to_regprocedure(r.signature) and proowner=current_user::regrole
 and md5(regexp_replace(prosrc,'\s+','','g'))=r.source_md5) then
 raise exception 'POS effective-options prerequisite or source drift: %',r.signature using detail='POS_EFFECTIVE_PREREQUISITE'; end if;
 end loop;
 if exists(select 1 from pg_proc where oid in ('public.pos_get_catalog()'::regprocedure,'pos_private.resolve_line(uuid,uuid[])'::regprocedure)
 and (not prosecdef or proconfig is distinct from array['search_path=public, pg_temp'] or provolatile<>'v')) then
 raise exception 'Unexpected POS security configuration.' using detail='POS_EFFECTIVE_PREREQUISITE'; end if;
end $preflight$;
create temporary table pos_effective_security_baseline on commit drop as select oid,proowner,proacl,prosecdef,proconfig,provolatile,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.pos_get_catalog()'::regprocedure,'pos_private.resolve_line(uuid,uuid[])'::regprocedure,'public.quote_public_cart(jsonb)'::regprocedure,'public.submit_public_order_v2(jsonb)'::regprocedure);
create or replace function public.pos_get_catalog() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pos_private.actor();
  return jsonb_build_object('products', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',p.id,'name',p.name,'description',p.description,'image_url',p.image_url,
      'category_id',c.id,'category_name',c.name,'section_id',p.category_section_id,
      'section_name',cs.name,'is_sold_out',p.is_sold_out,'is_available',p.is_available,
      'archived_at',p.archived_at,'variant_group_name',p.variant_group_name,
      'effective_options_version',1,
      'configuration_valid',not exists(select 1 from public.product_option_defaults d where d.product_id=p.id and not configuration_private.choice_allowed(p.id,d.option_choice_id)),
      'temperature_compatibility',coalesce((select jsonb_agg(jsonb_build_object('size_id',t.product_size_id,'choice_id',t.option_choice_id) order by t.product_size_id,t.option_choice_id)
        from public.product_size_option_choice_compatibility t where t.product_id=p.id and t.is_active and configuration_private.choice_allowed(p.id,t.option_choice_id)),'[]'::jsonb),
      'sizes',coalesce((select jsonb_agg(jsonb_build_object('id',ps.id,'label',ps.label,'price',ps.price)
        order by ps.sort_order,ps.id) from public.product_sizes ps where ps.product_id=p.id),'[]'::jsonb),
      'groups',coalesce((select jsonb_agg(jsonb_build_object(
        'id',og.id,'key',og.group_key,'name',og.name,'selection_type',og.selection_type,
        'is_required',pg.is_required,'min_selections',pg.min_selections,'max_selections',pg.max_selections,
        'choices',coalesce((select jsonb_agg(jsonb_build_object('id',oc.id,'label',oc.label,'value',oc.value,
          'price_delta',oc.price_delta,'price_by_size',oc.price_by_size,'is_default',exists(select 1 from public.product_option_defaults d
            where d.product_id=p.id and d.option_group_id=og.id and d.option_choice_id=oc.id))
          order by oc.sort_order,oc.id) from (select e.option_choice_id id,e.* from configuration_private.effective_product_choices(p.id) e) oc
          where oc.option_group_id=og.id),'[]'::jsonb))
        order by pg.sort_order,og.id)
        from public.product_option_groups pg join public.option_groups og on og.id=pg.option_group_id
        where pg.product_id=p.id and pg.is_active and og.is_active),'[]'::jsonb)
    ) order by c.sort_order,p.sort_order,p.id)
    from public.products p join public.categories c on c.id=p.category_id
    left join public.category_sections cs on cs.id=p.category_section_id
    where p.archived_at is null and p.is_available and c.is_active
  ),'[]'::jsonb));
end; $$;
create or replace function pos_private.resolve_line(p_size uuid,p_choices uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_size public.product_sizes%rowtype;
  v_group record; v_count integer; v_seen integer:=0; v_delta numeric:=0;
  v_options jsonb:='[]'; v_category text; v_ids uuid[]:=coalesce(p_choices,'{}'::uuid[]);
begin
  if cardinality(v_ids)>100 or array_position(v_ids,null) is not null
    or cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Invalid choices.' using errcode='P0001',detail='POS_OPTIONS_INVALID';
  end if;
  -- Serialize catalog writers with resolution, including absent policy/override rows.
  -- Lock order matches the Menu Manager boundary; no historical order data changes.
  lock table public.categories,public.products,public.product_sizes,public.option_groups,public.option_choices,public.product_option_groups,public.product_option_defaults,public.product_size_option_choice_compatibility,public.product_option_choice_price_overrides,public.product_option_choice_override_requirements,public.product_option_choice_policies in share mode;
  -- One statement snapshot resolves product/size. Subsequent selected catalog
  -- rows are share-locked so their authoritative prices cannot change mid-write.
  select * into v_size from public.product_sizes where id=p_size;
  select * into v_product from public.products where id=v_size.product_id for share;
  select * into v_size from public.product_sizes where id=p_size for share;
  if v_product.id is null or v_size.id is null or v_product.archived_at is not null
    or not v_product.is_available or v_product.is_sold_out then
    raise exception 'Item is not sellable.' using errcode='P0001',detail='POS_NOT_SELLABLE';
  end if;
  select name into v_category from public.categories where id=v_product.category_id and is_active for share;
  if not found then raise exception 'Category unavailable.' using errcode='P0001',detail='POS_NOT_SELLABLE'; end if;
  if v_size.price::text in ('NaN','Infinity','-Infinity') or v_size.price<0 or v_size.price<>round(v_size.price,2) then
    raise exception 'Price configuration needs review.' using errcode='P0001',detail='POS_CATALOG_INVALID';
  end if;
  begin
    perform configuration_private.validate_product_coverage(v_product.id);
  exception when raise_exception then
    raise exception 'Product configuration needs review.' using errcode='P0001',detail='POS_CATALOG_INVALID';
  end;
  if exists(select 1 from public.option_choices c join public.option_groups g on g.id=c.option_group_id
    where c.id=any(v_ids) and g.group_key='temperature' and not exists(select 1 from public.product_size_option_choice_compatibility t
    where t.product_id=v_product.id and t.product_size_id=p_size and t.option_choice_id=c.id and t.is_active)) then
    raise exception 'Choose a temperature available for this size.' using errcode='P0001',detail='POS_OPTIONS_INVALID'; end if;
  for v_group in select pg.*,og.selection_type,og.group_key,og.name
    from public.product_option_groups pg join public.option_groups og on og.id=pg.option_group_id
    where pg.product_id=v_product.id and pg.is_active and og.is_active
    order by pg.sort_order,og.id for share of pg,og
  loop
    perform 1 from public.option_choices where option_group_id=v_group.option_group_id and is_active order by id for share;
    select count(*) into v_count from public.option_choices where option_group_id=v_group.option_group_id
      and configuration_private.choice_allowed(v_product.id,id) and id=any(v_ids);
    if v_count<greatest(v_group.min_selections,case when v_group.is_required then 1 else 0 end)
      or (v_group.max_selections is not null and v_count>v_group.max_selections)
      or (v_group.selection_type='single' and v_count>1) then
      raise exception 'Check configured choices.' using errcode='P0001',detail='POS_OPTIONS_INVALID';
    end if;
    if exists(select 1 from public.option_choices where option_group_id=v_group.option_group_id and configuration_private.choice_allowed(v_product.id,id) and id=any(v_ids)
      and (configuration_private.effective_choice_price(v_product.id,p_size,id) is null or not (configuration_private.effective_choice_price(v_product.id,p_size,id)>=0 and configuration_private.effective_choice_price(v_product.id,p_size,id)<=999999.99 and configuration_private.effective_choice_price(v_product.id,p_size,id)=round(configuration_private.effective_choice_price(v_product.id,p_size,id),2)))) then
      raise exception 'Option price needs review.' using errcode='P0001',detail='POS_CATALOG_INVALID';
    end if;
    v_seen:=v_seen+v_count;
    v_options:=v_options||coalesce((select jsonb_agg(jsonb_build_object(
      'group_id',v_group.option_group_id,'group_key',v_group.group_key,'group_name',v_group.name,
      'choice_id',id,'label',label,'value',value,'price_delta',configuration_private.effective_choice_price(v_product.id,p_size,id)) order by sort_order,id)
      from public.option_choices where option_group_id=v_group.option_group_id and configuration_private.choice_allowed(v_product.id,id) and id=any(v_ids)),'[]'::jsonb);
  end loop;
  if v_seen<>cardinality(v_ids) then raise exception 'Choice unavailable.' using errcode='P0001',detail='POS_OPTIONS_INVALID'; end if;
  select coalesce(sum((x->>'price_delta')::numeric),0) into v_delta from jsonb_array_elements(v_options) x;
  return jsonb_build_object('product_id',v_product.id,'size_id',v_size.id,'name',v_product.name,
    'category',v_category,'variant',v_size.label,'base',v_size.price,'delta',v_delta,
    'options',jsonb_build_object('schema_version',1,'selections',v_options));
end; $$;
do $postflight$
begin
 if exists(select 1 from pos_effective_security_baseline b left join pg_proc p on p.oid=b.oid
 where p.oid is null or p.proowner<>b.proowner or p.proacl is distinct from b.proacl or p.prosecdef<>b.prosecdef
 or p.proconfig is distinct from b.proconfig or p.provolatile<>b.provolatile
 or (p.proname in ('quote_public_cart','submit_public_order_v2') and pg_get_functiondef(p.oid)<>b.definition)) then
 raise exception 'POS security or checkout contract changed unexpectedly.' using detail='POS_EFFECTIVE_PRESERVATION'; end if;
end $postflight$;
commit;
