-- Read-only verification draft. Run manually after MENU_PRODUCT_IMAGES_STORAGE.sql.
-- Does not upload/delete objects or change products. Ends with ROLLBACK.
begin;
set transaction read only;

do $$
declare p record;
begin
  if not exists (
    select 1 from storage.buckets where id = 'menu-images' and name = 'menu-images'
      and public = true and file_size_limit = 5242880
      and allowed_mime_types @> array['image/jpeg','image/png','image/webp']::text[]
      and allowed_mime_types <@ array['image/jpeg','image/png','image/webp']::text[]
  ) then raise exception 'Incorrect menu-images bucket configuration.'; end if;

  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity)
  then raise exception 'storage.objects RLS must be enabled.'; end if;

  for p in select * from (values
    ('curv_menu_images_admin_read', 'SELECT', 'PERMISSIVE', 'authenticated'),
    ('curv_menu_images_admin_insert', 'INSERT', 'PERMISSIVE', 'authenticated'),
    ('curv_menu_images_admin_delete', 'DELETE', 'PERMISSIVE', 'authenticated'),
    ('curv_menu_images_authenticated_guard', 'ALL', 'RESTRICTIVE', 'authenticated'),
    ('curv_menu_images_anon_guard', 'ALL', 'RESTRICTIVE', 'anon'),
    ('curv_menu_images_no_overwrite', 'UPDATE', 'RESTRICTIVE', 'public')
  ) as expected(policyname, cmd, permissive, role_name)
  loop
    if not exists (
      select 1 from pg_policies a where a.schemaname = 'storage' and a.tablename = 'objects'
        and a.policyname = p.policyname and a.cmd = p.cmd and a.permissive = p.permissive
        and a.roles = array[p.role_name::name]
        and coalesce(a.qual, a.with_check, '') like '%menu-images%'
        and (p.role_name <> 'authenticated' or coalesce(a.qual, a.with_check, '') like '%is_admin%')
    ) then raise exception 'Missing/incorrect policy: %', p.policyname; end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='curv_menu_images_anon_guard'
    and qual = '(bucket_id <> ''menu-images''::text)'
    and with_check = '(bucket_id <> ''menu-images''::text)')
  then raise exception 'Anonymous bucket exclusion was changed.'; end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='curv_menu_images_no_overwrite'
    and qual = '(bucket_id <> ''menu-images''::text)'
    and with_check = '(bucket_id <> ''menu-images''::text)')
  then raise exception 'Overwrite exclusion was changed.'; end if;
end $$;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'menu-images';
-- Review all existing policies too, including policies not defined in this repo.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'storage' and tablename = 'objects'
order by policyname;

rollback;

-- Storage API acceptance (manual, not SQL):
-- Owner: upload JPG/PNG/WebP <=5 MB, fetch public URL, remove unattached test object.
-- Anonymous/non-admin: upload, overwrite, delete must fail.
-- Reject files >5 MB or wrong MIME type. Existing repository images stay unchanged.

