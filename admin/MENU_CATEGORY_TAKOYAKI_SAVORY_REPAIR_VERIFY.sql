-- CURV Menu Manager - Takoyaki & Savory Bites repair verification
-- Rollback-only: this script does not persist changes.

begin;

do $verify$
declare
  v_canonical_category_id constant uuid := '1796cec1-be5f-401b-a9f3-321194f6130c';
  v_redundant_category_id constant uuid := '20ca4bbf-9c7a-435f-a78b-d23f3561b4f2';
  v_og_takoyaki_id constant uuid := '24007d6c-e175-4dcf-9a6f-aab076e07b98';
  v_savory_section_id constant uuid := '323ae7c1-812d-4d38-931a-fbbe7ce4f558';
  v_takoyaki_section_id constant uuid := '7bf4687b-4724-4e8d-9881-e50f26949a5f';
  v_expected_moved_ids constant uuid[] := array[
    '29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5',
    'a33f5d5a-fde1-4eb4-8604-1637b4afbf9a',
    'ffcf04b4-1500-4463-aa25-3703a1e167ed'
  ]::uuid[];
  v_og_size_ids uuid[];
begin
  if (select count(*) from public.categories c where c.id = v_canonical_category_id) <> 1
    or not exists (
      select 1 from public.categories c
      where c.id = v_canonical_category_id
        and c.name = 'Takoyaki & Savory Bites'
        and c.is_active = true
    )
  then
    raise exception 'Canonical Takoyaki & Savory Bites category verification failed.';
  end if;

  if exists (select 1 from public.categories c where c.id = v_redundant_category_id) then
    raise exception 'Redundant Savory Bites category still exists.';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = v_og_takoyaki_id
      and p.category_id = v_canonical_category_id
      and p.is_published = true
      and p.is_available = true
      and p.is_sold_out = false
      and p.archived_at is null
  ) then
    raise exception 'OG Takoyaki row or healthy lifecycle state changed.';
  end if;

  select coalesce(array_agg(ps.id order by ps.id), '{}'::uuid[])
  into v_og_size_ids
  from public.product_sizes ps
  where ps.product_id = v_og_takoyaki_id;

  if cardinality(v_og_size_ids) <> 3 then
    raise exception 'OG Takoyaki does not retain its three size UUIDs.';
  end if;

  if exists (
    select 1
    from unnest(v_expected_moved_ids) as expected(product_id)
    left join public.products p on p.id = expected.product_id
    where p.id is null
      or p.category_id <> v_canonical_category_id
      or p.category_section_id <> v_savory_section_id
  ) then
    raise exception 'One or more inspected Savory products were not moved correctly.';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = '29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5'
      and p.name = 'Chicken Karaage'
      and p.category_id = v_canonical_category_id
  ) or not exists (
    select 1 from public.products p
    where p.id = 'a33f5d5a-fde1-4eb4-8604-1637b4afbf9a'
      and p.name = 'Cream Dory Fillet'
      and p.category_id = v_canonical_category_id
  ) or not exists (
    select 1 from public.products p
    where p.id = 'ffcf04b4-1500-4463-aa25-3703a1e167ed'
      and p.name = 'Shrimp Tempura'
      and p.category_id = v_canonical_category_id
      and p.archived_at is not null
  ) then
    raise exception 'Named Savory product verification failed.';
  end if;

  if not exists (
    select 1 from public.category_sections cs
    where cs.id = v_savory_section_id
      and cs.category_id = v_canonical_category_id
      and cs.name = 'Savory Bites'
  ) or not exists (
    select 1 from public.category_sections cs
    where cs.id = v_takoyaki_section_id
      and cs.category_id = v_canonical_category_id
      and cs.name = 'Takoyaki'
  ) then
    raise exception 'Canonical category-section UUIDs or ownership changed.';
  end if;

  if exists (
    select 1 from public.products p
    where p.category_section_id = v_takoyaki_section_id
      and p.category_id <> v_canonical_category_id
  ) or not exists (
    select 1 from public.products p
    where p.id = v_og_takoyaki_id
      and p.category_id = v_canonical_category_id
  ) then
    raise exception 'Canonical Takoyaki product attachment verification failed.';
  end if;

  if exists (
    select 1
    from public.inventory_recipes r
    left join public.product_sizes ps on ps.id = r.product_size_id
    where ps.id is null
  ) then
    raise exception 'A recipe no longer references an existing product-size UUID.';
  end if;

  if (select count(*)
      from public.public_menu_categories c
      where regexp_replace(lower(btrim(c.name)), '\s+', ' ', 'g') in (
        'bites', 'curv bites', 'takoyaki', 'takoyaki & savory bites', 'savory', 'savory bites'
      )) <> 1
  then
    raise exception 'Public menu still exposes duplicate Takoyaki/Savory category rows.';
  end if;

  if not exists (
    select 1 from public.public_menu_products p where p.id = v_og_takoyaki_id
  ) or exists (
    select 1 from public.public_menu_products p
    where p.id = 'ffcf04b4-1500-4463-aa25-3703a1e167ed'
  ) then
    raise exception 'Public OG Takoyaki or archived Shrimp Tempura visibility is incorrect.';
  end if;

  raise notice 'Takoyaki & Savory Bites repair verification passed. This transaction will now roll back.';
end;
$verify$;

rollback;
