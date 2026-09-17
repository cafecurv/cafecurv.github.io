-- LOCAL DRAFT ONLY. P1A then P1B schema required. No catalog reads in ticket printing.
begin;
create or replace function pos_private.kitchen_desired(p_order uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,
    'size_id',i.product_size_id,'name',i.product_name,'variant',i.variant_label,
    'quantity',i.quantity,'note',i.item_note,'options',coalesce((
      select jsonb_agg(jsonb_build_object('group_id',x->'group_id','choice_id',x->'choice_id',
        'group_name',x->'group_name','label',x->'label','value',x->'value')
        order by x->>'group_id',x->>'choice_id')
      from jsonb_array_elements(coalesce(i.options->'selections','[]')) x),'[]'::jsonb))
    order by i.sort_order,i.created_at,i.id),'[]'::jsonb)
  from public.order_items i where i.order_id=p_order and i.pos_removed_at is null;
$$;
create or replace function pos_private.kitchen_header(p_order uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('order_number',order_number,'customer_name',customer_name,
    'fulfillment_type',fulfillment_type,'note',customer_notes)
  from public.orders where id=p_order and source='pos';
$$;

-- Compare desired state to the last committed submission, never to print state.
create or replace function pos_private.kitchen_pending(p_order uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_last public.pos_kitchen_submissions%rowtype; v_now jsonb:=pos_private.kitchen_desired(p_order);
  v_header jsonb:=pos_private.kitchen_header(p_order); v_lines jsonb:='[]'; r record;
  v_action text; v_qty integer; v_prior uuid; v_oldqty integer; v_newqty integer;
begin
  select * into v_last from public.pos_kitchen_submissions where order_id=p_order order by ticket_number desc limit 1;
  for r in select coalesce(a->>'id',b->>'id') as id,a as old,b as new
    from jsonb_array_elements(coalesce(v_last.desired_state,'[]')) a
    full join jsonb_array_elements(v_now) b on a->>'id'=b->>'id'
    order by coalesce(a->>'id',b->>'id')
  loop
    v_oldqty:=coalesce((r.old->>'quantity')::integer,0); v_newqty:=coalesce((r.new->>'quantity')::integer,0);
    if r.old is null then v_action:='ADD'; v_qty:=v_newqty;
    elsif r.new is null then v_action:='CANCEL'; v_qty:=v_oldqty;
    elsif (r.old-'quantity') is distinct from (r.new-'quantity') then
      v_action:='CHANGE'; v_qty:=v_oldqty; -- replace entire prior batch with explicit before/after quantities
    elsif v_newqty>v_oldqty then v_action:='ADD'; v_qty:=v_newqty-v_oldqty;
    elsif v_newqty<v_oldqty then v_action:='CANCEL'; v_qty:=v_oldqty-v_newqty;
    else continue; end if;
    select i.id into v_prior from public.pos_kitchen_instructions i
      join public.pos_kitchen_submissions s on s.id=i.submission_id
      where s.order_id=p_order and i.order_item_id=r.id::uuid order by s.ticket_number desc,i.ordinal desc limit 1;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('scope','ITEM','order_item_id',r.id,
      'action',v_action,'quantity',v_qty,'before',r.old,'after',r.new,'prior_instruction_id',v_prior));
  end loop;
  if v_last.id is not null and v_last.header is distinct from v_header then
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('scope','ORDER','order_item_id',null,
      'action','CHANGE','quantity',0,'before',v_last.header,'after',v_header,'prior_instruction_id',null));
  end if;
  return jsonb_build_object('pending',v_lines,'pending_count',jsonb_array_length(v_lines),
    'last_submission_id',v_last.id,'ticket_number',coalesce(v_last.ticket_number,0));
end $$;

-- Same P1A safe projection plus authoritative kitchen status. All P1A commands
-- already use this private projection, so normal edits return updated markers.
create or replace function pos_private.read_order(p_id uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,
    'revision',o.pos_revision,'customer_name',o.customer_name,'fulfillment_type',o.fulfillment_type,
    'note',o.customer_notes,'total',o.total,'created_at',o.created_at,'updated_at',o.updated_at,
    'held_at',o.pos_held_at,'kitchen',pos_private.kitchen_pending(o.id),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'product_id',i.product_id,'product_size_id',i.product_size_id,
      'product_name',i.product_name,'variant_label',i.variant_label,'quantity',i.quantity,
      'base_price',i.pos_base_price,'option_total',i.pos_option_total,'unit_price',i.unit_price,
      'line_total',i.line_total,'options',i.options,'item_note',i.item_note)
      order by i.sort_order,i.created_at,i.id) from public.order_items i
      where i.order_id=o.id and i.pos_removed_at is null),'[]'::jsonb))
  from public.orders o where o.id=p_id and o.source='pos';
$$;

create or replace function pos_private.kitchen_ticket(p_id uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',s.id,'order_id',s.order_id,'ticket_number',s.ticket_number,
    'source_revision',s.source_revision,'submitted_at',s.submitted_at,'submitted_by',s.actor_label,
    'header',s.header,'instructions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'scope',i.scope,'order_item_id',i.order_item_id,'item_version',i.item_version,
      'action',i.action,'quantity',i.quantity,'before',i.before_snapshot,'after',i.after_snapshot,
      'prior_instruction_id',i.prior_instruction_id) order by i.ordinal)
      from public.pos_kitchen_instructions i where i.submission_id=s.id),'[]'::jsonb))
  from public.pos_kitchen_submissions s where s.id=p_id;
$$;
create or replace function public.pos_get_kitchen_ticket(p_submission_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform pos_private.actor();
  v_result:=pos_private.kitchen_ticket(p_submission_id);
  if v_result is null then raise exception 'Ticket unavailable.' using errcode='P0001',detail='POS_NOT_FOUND'; end if;
  return v_result;
end $$;

-- Shared P1A key namespace and actor verification. A split moves quantity to a
-- new stable line without changing prices or total; no implicit reconfiguration.
create or replace function pos_private.kitchen_command(p_operation text,p_key uuid,p_order uuid,p_revision bigint,
  p_item uuid default null,p_quantity integer default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor jsonb:=pos_private.actor(); v_user uuid:=(v_actor->>'user_id')::uuid;
  v_staff uuid:=(v_actor->>'staff_id')::uuid; v_fingerprint text; v_previous pos_private.commands%rowtype;
  v_order public.orders%rowtype; v_item public.order_items%rowtype; v_pending jsonb; v_line jsonb;
  v_submission uuid; v_number integer; v_ordinal integer:=0; v_result jsonb; v_newitem uuid;
begin
  if p_key is null or p_operation not in ('kitchen_send','split_item') then
    raise exception 'Invalid command.' using errcode='P0001',detail='POS_INVALID_INPUT'; end if;
  v_fingerprint:=encode(extensions.digest(jsonb_build_object('operation',p_operation,'order',p_order,
    'expected',p_revision,'item',p_item,'quantity',p_quantity)::text,'sha256'),'hex');
  insert into pos_private.commands(command_key,actor_id,staff_id,operation,fingerprint)
    values(p_key,v_user,v_staff,p_operation,v_fingerprint) on conflict do nothing;
  if not found then
    select * into v_previous from pos_private.commands where command_key=p_key;
    if v_previous.actor_id<>v_user or v_previous.staff_id is distinct from v_staff
      or v_previous.fingerprint<>v_fingerprint then
      raise exception 'Command key mismatch.' using errcode='P0001',detail='POS_KEY_CONFLICT'; end if;
    return v_previous.result;
  end if;
  select * into v_order from public.orders where id=p_order and source='pos' for update;
  if not found then raise exception 'Order unavailable.' using errcode='P0001',detail='POS_NOT_FOUND'; end if;
  if v_order.pos_revision is distinct from p_revision then
    raise exception 'Order changed.' using errcode='P0001',detail='POS_REVISION_CONFLICT'; end if;
  if v_order.status<>'open' then
    raise exception 'Resume the order first.' using errcode='P0001',detail='POS_STATE_INVALID'; end if;
  if p_operation='split_item' then
    select * into v_item from public.order_items where id=p_item and order_id=p_order and pos_removed_at is null for update;
    if not found then raise exception 'Item unavailable.' using errcode='P0001',detail='POS_NOT_FOUND'; end if;
    if p_quantity is null or p_quantity<1 or p_quantity>=v_item.quantity then
      raise exception 'Split fewer than the whole quantity.' using errcode='P0001',detail='POS_INVALID_INPUT'; end if;
    update public.order_items set quantity=quantity-p_quantity,line_total=unit_price*(quantity-p_quantity) where id=p_item;
    insert into public.order_items(order_id,product_id,product_size_id,product_name,category_name,variant_label,
      quantity,unit_price,line_total,options,item_note,sort_order,pos_base_price,pos_option_total)
    values(p_order,v_item.product_id,v_item.product_size_id,v_item.product_name,v_item.category_name,v_item.variant_label,
      p_quantity,v_item.unit_price,v_item.unit_price*p_quantity,v_item.options,v_item.item_note,
      (select coalesce(max(sort_order),-1)+1 from public.order_items where order_id=p_order),v_item.pos_base_price,v_item.pos_option_total)
    returning id into v_newitem;
  else
    v_pending:=pos_private.kitchen_pending(p_order);
    if (v_pending->>'pending_count')::integer=0 then
      raise exception 'No kitchen updates pending.' using errcode='P0001',detail='POS_KITCHEN_NO_CHANGES'; end if;
    v_number:=(v_pending->>'ticket_number')::integer+1;
    insert into public.pos_kitchen_submissions(order_id,ticket_number,source_revision,command_key,actor_id,staff_id,actor_label,header,desired_state)
    values(p_order,v_number,p_revision,p_key,v_user,v_staff,v_actor->>'name',pos_private.kitchen_header(p_order),pos_private.kitchen_desired(p_order))
    returning id into v_submission;
    for v_line in select value from jsonb_array_elements(v_pending->'pending') loop
      v_ordinal:=v_ordinal+1;
      insert into public.pos_kitchen_instructions(submission_id,ordinal,scope,order_item_id,item_version,action,quantity,
        before_snapshot,after_snapshot,prior_instruction_id)
      values(v_submission,v_ordinal,v_line->>'scope',(v_line->>'order_item_id')::uuid,p_revision,v_line->>'action',
        (v_line->>'quantity')::integer,nullif(v_line->'before','null'::jsonb),nullif(v_line->'after','null'::jsonb),
        (v_line->>'prior_instruction_id')::uuid);
    end loop;
  end if;
  update public.orders set pos_revision=pos_revision+1,pos_updated_by=v_user,pos_updated_staff_id=v_staff,
    updated_at=clock_timestamp() where id=p_order;
  v_result:=pos_private.read_order(p_order);
  if v_submission is not null then v_result:=v_result||jsonb_build_object('kitchen_submission',pos_private.kitchen_ticket(v_submission)); end if;
  if v_newitem is not null then v_result:=v_result||jsonb_build_object('split_item_id',v_newitem); end if;
  update pos_private.commands set order_id=p_order,result=v_result where command_key=p_key;
  return v_result;
end $$;
create or replace function public.pos_send_kitchen(p_key uuid,p_order_id uuid,p_revision bigint) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select pos_private.kitchen_command('kitchen_send',p_key,p_order_id,p_revision);
$$;
create or replace function public.pos_split_item(p_key uuid,p_order_id uuid,p_revision bigint,p_item_id uuid,p_quantity integer) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select pos_private.kitchen_command('split_item',p_key,p_order_id,p_revision,p_item_id,p_quantity);
$$;
revoke all on all functions in schema pos_private from public,anon,authenticated;
revoke all on function public.pos_send_kitchen(uuid,uuid,bigint),public.pos_split_item(uuid,uuid,bigint,uuid,integer),
  public.pos_get_kitchen_ticket(uuid) from public,anon,authenticated;
grant execute on function public.pos_send_kitchen(uuid,uuid,bigint),public.pos_split_item(uuid,uuid,bigint,uuid,integer),
  public.pos_get_kitchen_ticket(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
