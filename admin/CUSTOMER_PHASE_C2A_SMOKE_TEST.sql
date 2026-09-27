-- C2A optional manual SQL Editor smoke, AFTER reviewed deployment.
-- Read-only; no fabricated orders/customers, no sequence consumption.
-- Run as a privileged operator allowed to SET ROLE. A real owner must exist.
-- Impersonation tests DB authorization only, not an end-to-end Supabase JWT.
-- Only counts are output; do not paste customer PII into diagnostic reports.
begin transaction read only;
select set_config('request.jwt.claim.sub',coalesce((
  select id::text from public.admin_profiles where role='owner' order by id limit 1
),''),true) as test_owner_id;
set local role authenticated;
select jsonb_array_length(public.customer_admin_list()->'customers') as first_page_count;
with first_customer as (
  select (public.customer_admin_list()->'customers'->0->>'customer_id')::uuid id
)
select jsonb_array_length(public.customer_admin_detail(id)->'orders') as order_page_count
from first_customer where id is not null;
with first_customer as (
  select (public.customer_admin_list()->'customers'->0->>'customer_id')::uuid id
), first_order as (
  select id,(public.customer_admin_detail(id)->'orders'->0->>'order_id')::uuid order_id
  from first_customer where id is not null
)
select jsonb_array_length(public.customer_admin_order_items(id,order_id)->'items') as item_count
from first_order where order_id is not null;
-- Zero customers/orders is valid: detail/item smoke returns no rows in that case.
rollback;
