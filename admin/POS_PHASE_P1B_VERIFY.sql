-- READ ONLY. Owner reviews/runs only in an approved environment after both patches.
select c.relname,c.relrowsecurity,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('pos_kitchen_submissions','pos_kitchen_instructions');
select n.nspname,p.proname,p.prosecdef,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='pos_private' and (p.proname like 'kitchen_%' or p.proname='read_order'))
  or (n.nspname='public' and p.proname in ('pos_send_kitchen','pos_split_item','pos_get_kitchen_ticket')) order by 1,2;
select tgname,pg_get_triggerdef(oid) from pg_trigger
where tgrelid in ('public.pos_kitchen_submissions'::regclass,'public.pos_kitchen_instructions'::regclass) and not tgisinternal;
select has_table_privilege('authenticated','public.pos_kitchen_submissions','INSERT') as direct_insert,
  has_table_privilege('authenticated','public.pos_kitchen_instructions','UPDATE') as direct_update,
  has_table_privilege('authenticated','public.pos_kitchen_submissions','SELECT') as direct_read;
-- Every count below should be zero. No customer/staff snapshots are exposed.
select count(*) as non_pos_tickets from public.pos_kitchen_submissions s join public.orders o on o.id=s.order_id where o.source<>'pos';
select count(*) as invalid_source_revisions from public.pos_kitchen_submissions s join public.orders o on o.id=s.order_id where s.source_revision>=o.pos_revision;
select count(*) as empty_tickets from public.pos_kitchen_submissions s where not exists
  (select 1 from public.pos_kitchen_instructions i where i.submission_id=s.id);
select count(*) as invalid_command_links from public.pos_kitchen_submissions s join pos_private.commands c on c.command_key=s.command_key
where c.result is null or c.operation<>'kitchen_send' or c.order_id<>s.order_id or c.result->'kitchen_submission'->>'id'<>s.id::text;
select count(*) as nonsequential_orders from (
  select order_id from public.pos_kitchen_submissions group by order_id having min(ticket_number)<>1 or max(ticket_number)<>count(*)
) bad;
select count(*) as invalid_item_links from public.pos_kitchen_instructions i
join public.pos_kitchen_submissions s on s.id=i.submission_id join public.order_items oi on oi.id=i.order_item_id
where oi.order_id<>s.order_id;
