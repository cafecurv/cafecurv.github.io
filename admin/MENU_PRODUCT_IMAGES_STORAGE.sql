-- DRAFT: manually review and run once in Supabase SQL Editor before deploying the UI.
-- No product/schema changes. Uses the existing public.is_admin() allowlist.
-- Public bucket downloads do not require an anonymous storage.objects SELECT policy.
-- Reference: https://supabase.com/docs/guides/storage/security/access-control
begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'STOP: the existing admin authorization helper is required.';
  end if;
  if exists (
    select 1 from storage.buckets where id = 'menu-images'
      and (name is distinct from 'menu-images' or public is distinct from true
        or file_size_limit is distinct from 5242880::bigint
        or allowed_mime_types is null
        or not (allowed_mime_types @> array['image/jpeg','image/png','image/webp']::text[]
          and allowed_mime_types <@ array['image/jpeg','image/png','image/webp']::text[]))
  ) then
    raise exception 'STOP: menu-images already exists with different settings. Review it manually; no settings were changed.';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists curv_menu_images_admin_read on storage.objects;
create policy curv_menu_images_admin_read on storage.objects
for select to authenticated
using (bucket_id = 'menu-images' and public.is_admin());

drop policy if exists curv_menu_images_admin_insert on storage.objects;
create policy curv_menu_images_admin_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'menu-images' and public.is_admin()
  and name ~ '^(products|drafts)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
);

drop policy if exists curv_menu_images_admin_delete on storage.objects;
create policy curv_menu_images_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'menu-images' and public.is_admin());

-- Restrictive guards prevent unrelated permissive policies from granting writes.
-- Unrelated buckets retain their current policies.
drop policy if exists curv_menu_images_authenticated_guard on storage.objects;
create policy curv_menu_images_authenticated_guard on storage.objects
as restrictive for all to authenticated
using (bucket_id <> 'menu-images' or public.is_admin())
with check (bucket_id <> 'menu-images' or public.is_admin());

drop policy if exists curv_menu_images_anon_guard on storage.objects;
create policy curv_menu_images_anon_guard on storage.objects
as restrictive for all to anon
using (bucket_id <> 'menu-images')
with check (bucket_id <> 'menu-images');

-- Replace uses a new unique path, never an overwrite.
drop policy if exists curv_menu_images_no_overwrite on storage.objects;
create policy curv_menu_images_no_overwrite on storage.objects
as restrictive for update to public
using (bucket_id <> 'menu-images')
with check (bucket_id <> 'menu-images');

commit;

