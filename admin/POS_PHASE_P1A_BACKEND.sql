-- LOCAL DRAFT. Apply after P1A schema, manually after owner review.
-- Public commands are narrow; private helpers are not exposed through PostgREST.
begin;

create or replace function pos_private.actor() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_staff public.staff%rowtype; v_name text;
begin
  if v_user is null then
    raise exception 'Sign in to use POS.' using errcode='P0001', detail='POS_AUTH_REQUIRED';
  end if;
  -- Check the real allowlist, not client claims or the local-test is_admin stub.
  select coalesce(full_name, 'Owner') into v_name from public.admin_profiles
    where id=v_user and role='owner';
  if found then return jsonb_build_object('user_id',v_user,'staff_id',null,'name',v_name,'is_owner',true); end if;
  select s.* into v_staff from public.pos_staff_access a join public.staff s on s.id=a.staff_id
    where a.user_id=v_user and a.is_active and s.is_active;
  if not found then
    raise exception 'POS access is not enabled.' using errcode='P0001', detail='POS_ACCESS_DENIED';
  end if;
  return jsonb_build_object('user_id',v_user,'staff_id',v_staff.id,'name',v_staff.name,'is_owner',false);
end; $$;

create or replace function public.pos_get_access() returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select pos_private.actor();
$$;

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
      'sizes',coalesce((select jsonb_agg(jsonb_build_object('id',ps.id,'label',ps.label,'price',ps.price)
        order by ps.sort_order,ps.id) from public.product_sizes ps where ps.product_id=p.id),'[]'::jsonb),
      'groups',coalesce((select jsonb_agg(jsonb_build_object(
        'id',og.id,'key',og.group_key,'name',og.name,'selection_type',og.selection_type,
        'is_required',pg.is_required,'min_selections',pg.min_selections,'max_selections',pg.max_selections,
        'choices',coalesce((select jsonb_agg(jsonb_build_object('id',oc.id,'label',oc.label,'value',oc.value,
          'price_delta',oc.price_delta,'is_default',exists(select 1 from public.product_option_defaults d
            where d.product_id=p.id and d.option_group_id=og.id and d.option_choice_id=oc.id))
          order by oc.sort_order,oc.id) from public.option_choices oc
          where oc.option_group_id=og.id and oc.is_active),'[]'::jsonb))
        order by pg.sort_order,og.id)
        from public.product_option_groups pg join public.option_groups og on og.id=pg.option_group_id
        where pg.product_id=p.id and pg.is_active and og.is_active),'[]'::jsonb)
    ) order by c.sort_order,p.sort_order,p.id)
    from public.products p join public.categories c on c.id=p.category_id
    left join public.category_sections cs on cs.id=p.category_section_id
    where p.archived_at is null and p.is_available and c.is_active
  ),'[]'::jsonb));
end; $$;

-- A projection, not to_jsonb(order): never return tracking/contact/admin fields.
create or replace function pos_private.read_order(p_id uuid) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,
    'revision',o.pos_revision,'customer_name',o.customer_name,'fulfillment_type',o.fulfillment_type,
    'note',o.customer_notes,'total',o.total,'created_at',o.created_at,'updated_at',o.updated_at,
    'held_at',o.pos_held_at,'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'product_id',i.product_id,'product_size_id',i.product_size_id,
      'product_name',i.product_name,'variant_label',i.variant_label,'quantity',i.quantity,
      'base_price',i.pos_base_price,'option_total',i.pos_option_total,'unit_price',i.unit_price,
      'line_total',i.line_total,'options',i.options,'item_note',i.item_note)
      order by i.sort_order,i.created_at,i.id) from public.order_items i
      where i.order_id=o.id and i.pos_removed_at is null),'[]'::jsonb))
  from public.orders o where o.id=p_id and o.source='pos';
$$;

create or replace function public.pos_get_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  perform pos_private.actor();
  -- Protect a coherent header + lines read against concurrent commands.
  perform 1 from public.orders where id=p_order_id and source='pos' for share;
  v_result := pos_private.read_order(p_order_id);
  if v_result is null then raise exception 'Order unavailable.' using errcode='P0001',detail='POS_NOT_FOUND'; end if;
  return v_result;
end; $$;

create or replace function public.pos_list_open_orders() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pos_private.actor();
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'order_number',order_number,
    'customer_name',customer_name,'fulfillment_type',fulfillment_type,'status',status,
    'revision',pos_revision,'total',total,'created_at',created_at,'updated_at',updated_at)
    order by updated_at desc,id) from public.orders where source='pos' and status in ('open','held')),'[]'::jsonb);
end; $$;

-- Selected IDs only. Labels, prices, rules and snapshots are server-resolved.
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
  for v_group in select pg.*,og.selection_type,og.group_key,og.name
    from public.product_option_groups pg join public.option_groups og on og.id=pg.option_group_id
    where pg.product_id=v_product.id and pg.is_active and og.is_active
    order by pg.sort_order,og.id for share of pg,og
  loop
    perform 1 from public.option_choices where option_group_id=v_group.option_group_id and is_active order by id for share;
    select count(*) into v_count from public.option_choices where option_group_id=v_group.option_group_id
      and is_active and id=any(v_ids);
    if v_count<greatest(v_group.min_selections,case when v_group.is_required then 1 else 0 end)
      or (v_group.max_selections is not null and v_count>v_group.max_selections)
      or (v_group.selection_type='single' and v_count>1) then
      raise exception 'Check configured choices.' using errcode='P0001',detail='POS_OPTIONS_INVALID';
    end if;
    if exists(select 1 from public.option_choices where option_group_id=v_group.option_group_id and id=any(v_ids)
      and (price_delta::text in ('NaN','Infinity','-Infinity') or price_delta<0 or price_delta<>round(price_delta,2))) then
      raise exception 'Option price needs review.' using errcode='P0001',detail='POS_CATALOG_INVALID';
    end if;
    v_seen:=v_seen+v_count;
    v_options:=v_options||coalesce((select jsonb_agg(jsonb_build_object(
      'group_id',v_group.option_group_id,'group_key',v_group.group_key,'group_name',v_group.name,
      'choice_id',id,'label',label,'value',value,'price_delta',price_delta) order by sort_order,id)
      from public.option_choices where option_group_id=v_group.option_group_id and is_active and id=any(v_ids)),'[]'::jsonb);
  end loop;
  if v_seen<>cardinality(v_ids) then raise exception 'Choice unavailable.' using errcode='P0001',detail='POS_OPTIONS_INVALID'; end if;
  select coalesce(sum((x->>'price_delta')::numeric),0) into v_delta from jsonb_array_elements(v_options) x;
  return jsonb_build_object('product_id',v_product.id,'size_id',v_size.id,'name',v_product.name,
    'category',v_category,'variant',v_size.label,'base',v_size.price,'delta',v_delta,
    'options',jsonb_build_object('schema_version',1,'selections',v_options));
end; $$;

-- Not a public whole-order-save API. Fixed wrappers below are the only entry
-- points. Each command can change one line, one header, or one lifecycle state.
create or replace function pos_private.command(p_operation text,p_key uuid,p_order uuid,p_expected bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor jsonb:=pos_private.actor(); v_user uuid:=(v_actor->>'user_id')::uuid;
  v_staff uuid:=(v_actor->>'staff_id')::uuid; v_fingerprint text; v_previous pos_private.commands%rowtype;
  v_order public.orders%rowtype; v_item public.order_items%rowtype; v_line jsonb;
  v_qty integer; v_note text; v_id uuid; v_choices uuid[]; v_result jsonb; v_number text; v_attempt integer:=0;
begin
  if p_key is null then raise exception 'Command key required.' using errcode='P0001',detail='POS_INVALID_INPUT'; end if;
  v_fingerprint:=encode(extensions.digest(jsonb_build_object('operation',p_operation,'order',p_order,
    'expected',p_expected,'payload',p_payload)::text,'sha256'),'hex');
  -- Concurrent identical keys wait on this unique insert. The winning result
  -- commits with the mutation; rollback leaves no abandoned in-progress key.
  insert into pos_private.commands(command_key,actor_id,staff_id,operation,fingerprint)
    values(p_key,v_user,v_staff,p_operation,v_fingerprint) on conflict do nothing;
  if not found then
    select * into v_previous from pos_private.commands where command_key=p_key;
    if v_previous.actor_id<>v_user or v_previous.staff_id is distinct from v_staff
      or v_previous.fingerprint<>v_fingerprint then
      raise exception 'Command key mismatch.' using errcode='P0001',detail='POS_KEY_CONFLICT';
    end if;
    return v_previous.result;
  end if;

  if p_operation<>'create' then
    select * into v_order from public.orders where id=p_order and source='pos' for update;
    if not found then raise exception 'Order unavailable.' using errcode='P0001',detail='POS_NOT_FOUND'; end if;
    if v_order.pos_revision is distinct from p_expected then
      raise exception 'Order changed.' using errcode='P0001',detail='POS_REVISION_CONFLICT';
    end if;
    if v_order.status not in ('open','held') then raise exception 'Order locked.' using errcode='P0001',detail='POS_STATE_INVALID'; end if;
    if p_operation not in ('resume','hold') and v_order.status<>'open' then
      raise exception 'Resume this order first.' using errcode='P0001',detail='POS_STATE_INVALID';
    end if;
  end if;
  if p_operation in ('create','header') then
    if length(coalesce(p_payload->>'customer',''))>200 or length(coalesce(p_payload->>'note',''))>1000
      or coalesce(p_payload->>'type','') not in ('dine_in','pickup','delivery') then
      raise exception 'Check order details.' using errcode='P0001',detail='POS_INVALID_INPUT';
    end if;
  end if;
  if p_operation in ('create','add','update','configure') then
    v_qty:=(p_payload->>'quantity')::integer; v_note:=nullif(btrim(p_payload->>'item_note'),'');
    if v_qty is null or v_qty<1 or v_qty>999 or length(coalesce(v_note,''))>500 then
      raise exception 'Check quantity or note.' using errcode='P0001',detail='POS_INVALID_INPUT';
    end if;
  end if;
  if p_operation in ('create','add','configure') then
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_choices
      from jsonb_array_elements_text(coalesce(p_payload->'choices','[]'));
    v_line:=pos_private.resolve_line((p_payload->>'size')::uuid,v_choices);
  end if;
  if p_operation='create' then
    loop
      v_attempt:=v_attempt+1; v_number:='C-'||nextval('public.order_number_seq');
      begin
        insert into public.orders(order_number,source,status,customer_name,customer_phone,customer_notes,
          fulfillment_type,tracking_token,pos_revision,pos_created_by,pos_updated_by,pos_created_staff_id,pos_updated_staff_id)
        values(v_number,'pos','open',coalesce(nullif(btrim(p_payload->>'customer'),''),'Guest'),'',
          nullif(btrim(p_payload->>'note'),''),p_payload->>'type',null,1,v_user,v_user,v_staff,v_staff)
        returning * into v_order;
        exit;
      exception when unique_violation then
        if v_attempt>=5 then raise; end if;
      end;
    end loop;
  end if;
  if p_operation in ('update','configure','remove') then
    select * into v_item from public.order_items where id=(p_payload->>'item')::uuid
      and order_id=v_order.id and pos_removed_at is null for update;
    if not found then raise exception 'Item unavailable.' using errcode='P0001',detail='POS_NOT_FOUND'; end if;
    -- Quantity increases are new preparation intent: reject unavailable stock,
    -- but retain the saved price and options for ordinary quantity/note edits.
    if p_operation='update' and v_qty>v_item.quantity and not exists (
      select 1 from public.products p join public.categories c on c.id=p.category_id
      join public.product_sizes ps on ps.product_id=p.id
      where p.id=v_item.product_id and ps.id=v_item.product_size_id and p.archived_at is null
        and p.is_available and not p.is_sold_out and c.is_active) then
      raise exception 'Item is not sellable.' using errcode='P0001',detail='POS_NOT_SELLABLE';
    end if;
  end if;
  if p_operation in ('create','add') then
    insert into public.order_items(order_id,product_id,product_size_id,product_name,category_name,variant_label,
      quantity,unit_price,line_total,options,item_note,sort_order,pos_base_price,pos_option_total)
    values(v_order.id,(v_line->>'product_id')::uuid,(v_line->>'size_id')::uuid,v_line->>'name',v_line->>'category',v_line->>'variant',
      v_qty,(v_line->>'base')::numeric+(v_line->>'delta')::numeric,
      v_qty*((v_line->>'base')::numeric+(v_line->>'delta')::numeric),v_line->'options',v_note,
      (select coalesce(max(sort_order),-1)+1 from public.order_items where order_id=v_order.id),
      (v_line->>'base')::numeric,(v_line->>'delta')::numeric);
  elsif p_operation='update' then
    update public.order_items set quantity=v_qty,item_note=v_note,line_total=unit_price*v_qty where id=v_item.id;
  elsif p_operation='configure' then
    update public.order_items set product_id=(v_line->>'product_id')::uuid,product_size_id=(v_line->>'size_id')::uuid,
      product_name=v_line->>'name',category_name=v_line->>'category',variant_label=v_line->>'variant',quantity=v_qty,
      pos_base_price=(v_line->>'base')::numeric,pos_option_total=(v_line->>'delta')::numeric,
      unit_price=(v_line->>'base')::numeric+(v_line->>'delta')::numeric,
      line_total=v_qty*((v_line->>'base')::numeric+(v_line->>'delta')::numeric),options=v_line->'options',item_note=v_note where id=v_item.id;
  elsif p_operation='remove' then
    update public.order_items set pos_removed_at=clock_timestamp() where id=v_item.id;
  elsif p_operation='header' then
    update public.orders set customer_name=coalesce(nullif(btrim(p_payload->>'customer'),''),'Guest'),
      customer_notes=nullif(btrim(p_payload->>'note'),''),fulfillment_type=p_payload->>'type' where id=v_order.id;
  elsif p_operation='hold' then
    if v_order.status<>'open' then raise exception 'Order already held.' using errcode='P0001',detail='POS_STATE_INVALID'; end if;
    update public.orders set status='held',pos_held_at=clock_timestamp() where id=v_order.id;
  elsif p_operation='resume' then
    if v_order.status<>'held' then raise exception 'Order already open.' using errcode='P0001',detail='POS_STATE_INVALID'; end if;
    update public.orders set status='open',pos_held_at=null where id=v_order.id;
  elsif p_operation<>'create' then
    raise exception 'Unsupported command.' using errcode='P0001',detail='POS_INVALID_INPUT';
  end if;
  update public.orders set subtotal=(select coalesce(sum(line_total),0) from public.order_items
      where order_id=v_order.id and pos_removed_at is null),
    total=(select coalesce(sum(line_total),0) from public.order_items where order_id=v_order.id and pos_removed_at is null),
    pos_revision=case when p_operation='create' then 1 else pos_revision+1 end,
    pos_updated_by=v_user,pos_updated_staff_id=v_staff,updated_at=clock_timestamp() where id=v_order.id;
  v_result:=pos_private.read_order(v_order.id);
  update pos_private.commands set order_id=v_order.id,result=v_result where command_key=p_key;
  return v_result;
end; $$;

create or replace function public.pos_create_order(p_key uuid,p_size uuid,p_choices uuid[],p_quantity integer,
  p_item_note text,p_customer text,p_type text,p_note text) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select pos_private.command('create',p_key,null,null,jsonb_build_object('size',p_size,'choices',coalesce(p_choices,'{}'::uuid[]),
 'quantity',p_quantity,'item_note',p_item_note,'customer',p_customer,'type',p_type,'note',p_note)); $$;
create or replace function public.pos_add_item(p_key uuid,p_order_id uuid,p_revision bigint,p_size uuid,p_choices uuid[],p_quantity integer,p_item_note text)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select pos_private.command('add',p_key,p_order_id,p_revision,jsonb_build_object('size',p_size,'choices',coalesce(p_choices,'{}'::uuid[]),'quantity',p_quantity,'item_note',p_item_note)); $$;
create or replace function public.pos_update_item(p_key uuid,p_order_id uuid,p_revision bigint,p_item_id uuid,p_quantity integer,p_item_note text)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select pos_private.command('update',p_key,p_order_id,p_revision,jsonb_build_object('item',p_item_id,'quantity',p_quantity,'item_note',p_item_note)); $$;
create or replace function public.pos_configure_item(p_key uuid,p_order_id uuid,p_revision bigint,p_item_id uuid,p_size uuid,p_choices uuid[],p_quantity integer,p_item_note text)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select pos_private.command('configure',p_key,p_order_id,p_revision,jsonb_build_object('item',p_item_id,'size',p_size,'choices',coalesce(p_choices,'{}'::uuid[]),'quantity',p_quantity,'item_note',p_item_note)); $$;
create or replace function public.pos_remove_item(p_key uuid,p_order_id uuid,p_revision bigint,p_item_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select pos_private.command('remove',p_key,p_order_id,p_revision,jsonb_build_object('item',p_item_id)); $$;
create or replace function public.pos_update_header(p_key uuid,p_order_id uuid,p_revision bigint,p_customer text,p_type text,p_note text)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select pos_private.command('header',p_key,p_order_id,p_revision,jsonb_build_object('customer',p_customer,'type',p_type,'note',p_note)); $$;
create or replace function public.pos_hold_order(p_key uuid,p_order_id uuid,p_revision bigint)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select pos_private.command('hold',p_key,p_order_id,p_revision,'{}'); $$;
create or replace function public.pos_resume_order(p_key uuid,p_order_id uuid,p_revision bigint)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select pos_private.command('resume',p_key,p_order_id,p_revision,'{}'); $$;

revoke all on all functions in schema pos_private from public,anon,authenticated;
-- Limit grants to this phase's entry points, without changing other modules.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('pos_get_access','pos_get_catalog','pos_get_order','pos_list_open_orders',
    'pos_create_order','pos_add_item','pos_update_item','pos_configure_item','pos_remove_item','pos_update_header','pos_hold_order','pos_resume_order')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
