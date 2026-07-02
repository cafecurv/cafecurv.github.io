-- LOCAL DEV TEST BOOTSTRAP ONLY
--
-- Purpose:
-- Provide the minimal admin helper dependency needed to apply Incoming Orders
-- Phase A policies in a fresh local Supabase database.
--
-- Do not run this file in live Supabase.
-- Do not include this file in production migrations.
-- The real project helper is defined in MENU_MANAGER_PHASE1S_B_ACCESS.sql and
-- checks public.admin_profiles plus auth.uid(). This local stub intentionally
-- returns true so isolated Incoming Orders SQL tests can create and exercise
-- owner/admin RLS policies without bootstrapping Auth/admin profile data.

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select true;
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
