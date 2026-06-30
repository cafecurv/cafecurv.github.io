-- Incoming Orders Phase O6A: Supabase Realtime publication setup
--
-- This enables Supabase Realtime INSERT events for Incoming Orders by adding
-- public.orders to the supabase_realtime publication.
--
-- admin/admin.js listens for new order inserts and refreshes the Incoming Orders
-- queue and summary cards for signed-in admin users.
--
-- RLS still controls what signed-in admin users can read. This does not grant
-- raw public table access, and it does not affect customer submission.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;