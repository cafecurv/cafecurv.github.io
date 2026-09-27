-- C1B smoke test: disposable local/staging DB only. No live execution by agent.
-- Requires O12 website ordering enabled. Uses a guest RPC, then owner assertions.
-- ROLLBACK removes test orders/contacts; order-number sequence may still advance.
begin;
set local role anon;
select public.submit_public_order('{
  "submission_key":"c1b00000-0000-4000-8000-000000000001",
  "customer_name":"C1B Smoke Customer", "customer_phone":"09220000001",
  "fulfillment_type":"pickup", "payment_method":"gcash",
  "subtotal":1,"total":1,
  "items":[{"product_name":"C1B Smoke Item","quantity":1,"unit_price":1,"line_total":1}]
}'::jsonb);
select public.submit_public_order('{
  "submission_key":"c1b00000-0000-4000-8000-000000000001",
  "customer_name":"C1B Smoke Customer", "customer_phone":"09220000001",
  "fulfillment_type":"pickup", "payment_method":"gcash",
  "subtotal":1,"total":1,
  "items":[{"product_name":"C1B Smoke Item","quantity":1,"unit_price":1,"line_total":1}]
}'::jsonb);
reset role;
do $$
begin
  if (select count(*) from public.orders where public_submission_key='c1b00000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'C1B replay duplicated order'; end if;
  if not exists(select 1 from public.orders o join public.customers c on c.id=o.customer_id
    where o.public_submission_key='c1b00000-0000-4000-8000-000000000001'
      and c.normalized_phone='+639220000001' and o.customer_phone='09220000001'
      and o.delivery_address is null) then
    raise exception 'C1B contact linkage/snapshot failure'; end if;
end;
$$;
rollback;
