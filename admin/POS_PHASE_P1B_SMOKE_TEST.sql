-- LOCAL DRAFT. Whole-file execution only in an approved test environment.
-- Rolls back fixtures/history; shared C-number sequence consumption still leaves gaps.
begin;
do $$
declare v_owner uuid; v_cat uuid:=gen_random_uuid(); v_product uuid:=gen_random_uuid(); v_size uuid:=gen_random_uuid();
  v_key uuid:=gen_random_uuid(); v_order jsonb; v_first jsonb; v_ticket jsonb; v_replay jsonb;
  v_id uuid; v_item uuid; v_revision bigint; v_detail text;
begin
  select id into v_owner from public.admin_profiles where role='owner' order by id limit 1;
  if v_owner is null then raise exception 'Smoke requires an existing owner Auth/profile fixture.'; end if;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  insert into public.categories(id,name) values(v_cat,'Kitchen smoke '||v_cat);
  insert into public.products(id,category_id,name,is_published,is_available,is_sold_out)
    values(v_product,v_cat,'Kitchen fixture',false,true,false);
  insert into public.product_sizes(id,product_id,label,price) values(v_size,v_product,'Each',160);
  v_order:=public.pos_create_order(gen_random_uuid(),v_size,'{}',2,'No sauce','Smoke','dine_in',null);
  v_id:=(v_order->>'id')::uuid;v_item:=(v_order->'items'->0->>'id')::uuid;
  v_first:=public.pos_send_kitchen(v_key,v_id,1);
  v_replay:=public.pos_send_kitchen(v_key,v_id,1);
  if v_first is distinct from v_replay or v_first->'kitchen_submission'->>'ticket_number'<>'1'
    or v_first->'kitchen_submission'->'instructions'->0->>'quantity'<>'2' then raise exception 'Initial send/replay failed'; end if;
  v_ticket:=v_first->'kitchen_submission';
  begin
    perform public.pos_send_kitchen(gen_random_uuid(),v_id,2);
    raise exception 'No-op send unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_detail=pg_exception_detail;
    if v_detail is distinct from 'POS_KITCHEN_NO_CHANGES' then raise; end if;
  end;
  v_order:=public.pos_update_item(gen_random_uuid(),v_id,2,v_item,1,'No sauce');
  v_order:=public.pos_send_kitchen(gen_random_uuid(),v_id,3);
  if v_order->'kitchen_submission'->'instructions'->0->>'action'<>'CANCEL'
    or v_order->'kitchen_submission'->'instructions'->0->>'quantity'<>'1' then raise exception 'Cancellation delta failed'; end if;
  v_revision:=(v_order->>'revision')::bigint;
  v_replay:=public.pos_get_kitchen_ticket((v_ticket->>'id')::uuid);
  if v_replay is distinct from v_ticket or (public.pos_get_order(v_id)->>'revision')::bigint<>v_revision then
    raise exception 'Reprint changed history/order'; end if;
  raise notice 'P1B smoke passed; rolling back fixtures and tickets.';
end $$;
rollback;
