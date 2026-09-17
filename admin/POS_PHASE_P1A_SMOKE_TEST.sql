-- TEST ONLY. Review first; run the WHOLE file against an approved test database.
-- Ends with ROLLBACK. Fixtures/commands roll back; sequence allocations do NOT
-- roll back (ordinary C-number gaps). Never reset the shared order sequence.
begin;
do $$
declare v_owner uuid; v_cat uuid:=gen_random_uuid(); v_product uuid:=gen_random_uuid();
  v_size uuid:=gen_random_uuid(); v_key uuid:=gen_random_uuid(); v_add_key uuid:=gen_random_uuid();
  v_order jsonb; v_replay jsonb; v_first_id uuid;
begin
  select id into v_owner from public.admin_profiles where role='owner' order by id limit 1;
  if v_owner is null then raise exception 'Smoke requires an existing owner Auth/profile fixture.'; end if;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  insert into public.categories(id,name) values(v_cat,'POS smoke '||v_cat);
  insert into public.products(id,category_id,name,is_published,is_available,is_sold_out)
    values(v_product,v_cat,'POS fixture',false,true,false);
  insert into public.product_sizes(id,product_id,label,price) values(v_size,v_product,'Each',160);
  v_order:=public.pos_create_order(v_key,v_size,'{}',1,'No ice','Smoke','dine_in',null);
  v_replay:=public.pos_create_order(v_key,v_size,'{}',1,'No ice','Smoke','dine_in',null);
  if v_order is distinct from v_replay or (v_order->>'revision')::bigint<>1 then raise exception 'Create/replay failed'; end if;
  v_first_id:=(v_order->'items'->0->>'id')::uuid;
  v_order:=public.pos_add_item(v_add_key,(v_order->>'id')::uuid,1,v_size,'{}',2,'Two more');
  v_replay:=public.pos_add_item(v_add_key,(v_order->>'id')::uuid,1,v_size,'{}',2,'Two more');
  if v_order is distinct from v_replay or jsonb_array_length(v_order->'items')<>2 then raise exception 'Add/replay failed'; end if;
  begin
    perform public.pos_update_item(gen_random_uuid(),(v_order->>'id')::uuid,1,v_first_id,5,null);
    raise exception 'Stale command unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Order changed.' then raise; end if;
  end;
  v_order:=public.pos_hold_order(gen_random_uuid(),(v_order->>'id')::uuid,2);
  if v_order->>'status'<>'held' then raise exception 'Hold failed'; end if;
  v_order:=public.pos_resume_order(gen_random_uuid(),(v_order->>'id')::uuid,3);
  if v_order->>'status'<>'open' then raise exception 'Resume failed'; end if;
  v_order:=public.pos_remove_item(gen_random_uuid(),(v_order->>'id')::uuid,4,v_first_id);
  if jsonb_array_length(v_order->'items')<>1 or (v_order->>'total')::numeric<>320 then raise exception 'Remove/total failed'; end if;
  raise notice 'P1A smoke checks passed; rolling back all fixture data.';
end $$;
rollback;
