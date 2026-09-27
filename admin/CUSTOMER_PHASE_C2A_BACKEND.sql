-- C2A draft: owner-only customer reads. Apply after C1B; no data writes/backfill.
begin;

create or replace function public.customer_admin_list(
  p_search text default '', p_filter text default 'all', p_sort text default 'recent',
  p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_search text := btrim(coalesce(p_search, ''));
  v_phone text;
  v_result jsonb;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Owner access is required.' using errcode = '42501', detail = 'CUSTOMER_FORBIDDEN';
  end if;
  if length(coalesce(p_search, '')) > 200
    or p_filter is null or p_filter not in ('all','repeat','one_time')
    or p_sort is null or p_sort not in ('recent','most_orders','newest','oldest')
    or p_limit is null or p_limit < 1 or p_limit > 50
    or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'Invalid customer list parameters.' using errcode = '22023', detail = 'CUSTOMER_INPUT_INVALID';
  end if;
  v_phone := customer_private.normalize_phone(v_search);
  with counted as (
    select c.id as customer_id, c.latest_name, c.normalized_phone,
      c.latest_delivery_address, c.first_order_at, c.last_order_at, c.created_at,
      s.submitted_order_count, s.completed_order_count,
      s.submitted_order_count >= 2 as repeat_customer
    from public.customers c
    cross join lateral (
      select count(*) as submitted_order_count,
        count(*) filter (where o.status = 'completed') as completed_order_count
      from public.orders o where o.customer_id = c.id and o.source = 'website'
    ) s
    where v_search = ''
      or strpos(lower(coalesce(c.latest_name,'')), lower(v_search)) > 0
      or strpos(lower(coalesce(c.latest_delivery_address,'')), lower(v_search)) > 0
      or strpos(c.normalized_phone, coalesce(v_phone,v_search)) > 0
  ), filtered as (
    select * from counted where p_filter = 'all'
      or (p_filter = 'repeat' and submitted_order_count >= 2)
      or (p_filter = 'one_time' and submitted_order_count = 1)
  ), page as (
    select * from filtered
    order by
      case when p_sort = 'recent' then last_order_at end desc,
      case when p_sort = 'most_orders' then submitted_order_count end desc,
      case when p_sort = 'newest' then created_at end desc,
      case when p_sort = 'oldest' then created_at end asc,
      customer_id asc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'customers', coalesce((select jsonb_agg(to_jsonb(p) order by
      case when p_sort = 'recent' then p.last_order_at end desc,
      case when p_sort = 'most_orders' then p.submitted_order_count end desc,
      case when p_sort = 'newest' then p.created_at end desc,
      case when p_sort = 'oldest' then p.created_at end asc, p.customer_id asc) from page p),'[]'::jsonb),
    'limit',p_limit,'offset',p_offset,'total_count',(select count(*) from filtered),
    'has_more',(select count(*) from filtered) > p_offset::bigint + p_limit
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.customer_admin_detail(
  p_customer_id uuid, p_limit integer default 20, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare v_summary jsonb; v_orders jsonb; v_count bigint;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Owner access is required.' using errcode = '42501', detail = 'CUSTOMER_FORBIDDEN';
  end if;
  if p_customer_id is null or p_limit is null or p_limit < 1 or p_limit > 50
    or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'Invalid customer detail parameters.' using errcode = '22023', detail = 'CUSTOMER_INPUT_INVALID';
  end if;
  select jsonb_build_object(
    'customer_id',c.id,'latest_name',c.latest_name,'normalized_phone',c.normalized_phone,
    'latest_delivery_address',c.latest_delivery_address,'first_order_at',c.first_order_at,
    'last_order_at',c.last_order_at,'created_at',c.created_at,
    'submitted_order_count',s.n,'completed_order_count',s.completed,'repeat_customer',s.n >= 2
  ), s.n into v_summary,v_count
  from public.customers c cross join lateral (
    select count(*) n,count(*) filter (where o.status = 'completed') completed
    from public.orders o where o.customer_id = c.id and o.source = 'website'
  ) s where c.id = p_customer_id;
  if v_summary is null then
    raise exception 'Customer record not found.' using errcode = 'P0002', detail = 'CUSTOMER_NOT_FOUND';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.order_id asc),'[]'::jsonb)
  into v_orders from (
    select o.id as order_id,o.order_number,o.created_at,o.status,o.fulfillment_type,
      o.payment_method,o.payment_status,o.total,o.customer_name,o.customer_phone,o.delivery_address
    from public.orders o where o.customer_id = p_customer_id and o.source = 'website'
    order by o.created_at desc,o.id asc limit p_limit offset p_offset
  ) p;
  return jsonb_build_object('customer',v_summary,'orders',v_orders,'limit',p_limit,
    'offset',p_offset,'total_count',v_count,'has_more',v_count > p_offset::bigint + p_limit);
end;
$$;

create or replace function public.customer_admin_order_items(p_customer_id uuid,p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog
as $$
declare v_items jsonb;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Owner access is required.' using errcode = '42501', detail = 'CUSTOMER_FORBIDDEN';
  end if;
  if p_customer_id is null or p_order_id is null then
    raise exception 'Customer and order identifiers are required.' using errcode = '22023', detail = 'CUSTOMER_INPUT_INVALID';
  end if;
  if not exists (select 1 from public.orders o
    where o.id = p_order_id and o.customer_id = p_customer_id and o.source = 'website') then
    raise exception 'Linked website order not found.' using errcode = 'P0002', detail = 'CUSTOMER_ORDER_NOT_FOUND';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_name',i.product_name,'category_name',i.category_name,'variant_label',i.variant_label,
    'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total,
    'options',i.options,'item_note',i.item_note,'sort_order',i.sort_order
  ) order by i.sort_order,i.id),'[]'::jsonb) into v_items
  from public.order_items i where i.order_id = p_order_id;
  return jsonb_build_object('items',v_items);
end;
$$;

revoke all on function public.customer_admin_list(text,text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.customer_admin_detail(uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.customer_admin_order_items(uuid,uuid) from public,anon,authenticated;
grant execute on function public.customer_admin_list(text,text,text,integer,integer) to authenticated;
grant execute on function public.customer_admin_detail(uuid,integer,integer) to authenticated;
grant execute on function public.customer_admin_order_items(uuid,uuid) to authenticated;
commit;
