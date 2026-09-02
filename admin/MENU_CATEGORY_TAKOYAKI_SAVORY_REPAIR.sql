-- CURV Menu Manager - final Takoyaki & Savory Bites category repair
-- Review, then run manually in Supabase before the rollback-only verifier.

begin;

do $repair$
declare
  v_canonical_category_id constant uuid := '1796cec1-be5f-401b-a9f3-321194f6130c';
  v_redundant_category_id constant uuid := '20ca4bbf-9c7a-435f-a78b-d23f3561b4f2';
  v_og_takoyaki_id constant uuid := '24007d6c-e175-4dcf-9a6f-aab076e07b98';
  v_savory_section_id constant uuid := '323ae7c1-812d-4d38-931a-fbbe7ce4f558';
  v_takoyaki_section_id constant uuid := '7bf4687b-4724-4e8d-9881-e50f26949a5f';
  v_expected_redundant_product_ids constant uuid[] := array[
    '29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5',
    'a33f5d5a-fde1-4eb4-8604-1637b4afbf9a',
    'ffcf04b4-1500-4463-aa25-3703a1e167ed'
  ]::uuid[];
  v_affected_product_ids uuid[];
  v_actual_redundant_product_ids uuid[];
  v_original_canonical_product_ids uuid[];
  v_og_size_ids_before uuid[];
  v_og_size_ids_after uuid[];
  v_product_state_before jsonb;
  v_product_state_after jsonb;
  v_size_state_before jsonb;
  v_size_state_after jsonb;
  v_recipe_state_before jsonb;
  v_recipe_state_after jsonb;
  v_recipe_line_state_before jsonb;
  v_recipe_line_state_after jsonb;
  v_option_group_state_before jsonb;
  v_option_group_state_after jsonb;
  v_option_default_state_before jsonb;
  v_option_default_state_after jsonb;
  v_order_item_state_before jsonb;
  v_order_item_state_after jsonb;
begin
  v_affected_product_ids := array_prepend(v_og_takoyaki_id, v_expected_redundant_product_ids);

  lock table public.categories in share row exclusive mode;
  lock table public.category_sections in share row exclusive mode;
  lock table public.products in share row exclusive mode;
  lock table public.product_sizes in share row exclusive mode;

  if not exists (
    select 1 from public.categories c
    where c.id = v_canonical_category_id
      and regexp_replace(lower(btrim(c.name)), '\s+', ' ', 'g') = 'curv bites'
      and c.is_active = true
  ) then
    raise exception 'STOP: canonical Curv Bites category is missing, renamed, or inactive.';
  end if;

  if not exists (
    select 1 from public.categories c
    where c.id = v_redundant_category_id
      and regexp_replace(lower(btrim(c.name)), '\s+', ' ', 'g') = 'savory bites'
      and c.is_active = true
  ) then
    raise exception 'STOP: redundant Savory Bites category is missing, renamed, or inactive.';
  end if;

  if exists (
    select 1 from public.categories c
    where regexp_replace(lower(btrim(c.name)), '\s+', ' ', 'g') = 'takoyaki & savory bites'
      and c.id not in (v_canonical_category_id, v_redundant_category_id)
  ) then
    raise exception 'STOP: another Takoyaki & Savory Bites category now exists.';
  end if;

  if not exists (
    select 1 from public.category_sections cs
    where cs.id = v_savory_section_id
      and cs.category_id = v_canonical_category_id
      and regexp_replace(lower(btrim(cs.name)), '\s+', ' ', 'g') = 'savory bites'
  ) or not exists (
    select 1 from public.category_sections cs
    where cs.id = v_takoyaki_section_id
      and cs.category_id = v_canonical_category_id
      and regexp_replace(lower(btrim(cs.name)), '\s+', ' ', 'g') = 'takoyaki'
  ) then
    raise exception 'STOP: one or both confirmed canonical category sections changed.';
  end if;

  if exists (
    select 1 from public.category_sections cs where cs.category_id = v_redundant_category_id
  ) or exists (
    select 1
    from public.products p
    join public.category_sections cs on cs.id = p.category_section_id
    where cs.category_id = v_redundant_category_id
  ) then
    raise exception 'STOP: redundant Savory Bites has a category-section blocker.';
  end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into v_actual_redundant_product_ids
  from public.products p
  where p.category_id = v_redundant_category_id;

  if v_actual_redundant_product_ids is distinct from v_expected_redundant_product_ids then
    raise exception 'STOP: redundant category products changed since inspection. Found: %', v_actual_redundant_product_ids;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = '29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5'
      and p.category_id = v_redundant_category_id
      and p.name = 'Chicken Karaage'
  ) or not exists (
    select 1 from public.products p
    where p.id = 'a33f5d5a-fde1-4eb4-8604-1637b4afbf9a'
      and p.category_id = v_redundant_category_id
      and p.name = 'Cream Dory Fillet'
  ) or not exists (
    select 1 from public.products p
    where p.id = 'ffcf04b4-1500-4463-aa25-3703a1e167ed'
      and p.category_id = v_redundant_category_id
      and p.name = 'Shrimp Tempura'
      and p.archived_at is not null
  ) then
    raise exception 'STOP: an inspected Savory product identity or Shrimp Tempura archive state changed.';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = v_og_takoyaki_id
      and p.category_id = v_canonical_category_id
      and regexp_replace(lower(btrim(p.name)), '\s+', ' ', 'g') = 'og takoyaki'
      and p.is_published = true
      and p.is_available = true
      and p.is_sold_out = false
      and p.archived_at is null
  ) then
    raise exception 'STOP: confirmed healthy OG Takoyaki state changed.';
  end if;

  select coalesce(array_agg(ps.id order by ps.id), '{}'::uuid[])
  into v_og_size_ids_before
  from public.product_sizes ps
  where ps.product_id = v_og_takoyaki_id;

  if cardinality(v_og_size_ids_before) <> 3 then
    raise exception 'STOP: OG Takoyaki no longer has exactly three existing size UUIDs.';
  end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into v_original_canonical_product_ids
  from public.products p
  where p.category_id = v_canonical_category_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'image_url', p.image_url,
    'is_available', p.is_available, 'is_published', p.is_published,
    'is_curv_pick', p.is_curv_pick, 'is_seasonal', p.is_seasonal,
    'is_sold_out', p.is_sold_out, 'archived_at', p.archived_at,
    'sort_order', p.sort_order, 'notes', p.notes,
    'variant_group_name', p.variant_group_name, 'menu_group', p.menu_group,
    'badge_labels', p.badge_labels
  ) order by p.id), '[]'::jsonb)
  into v_product_state_before
  from public.products p
  where p.id = any(v_affected_product_ids);

  select coalesce(jsonb_agg(to_jsonb(ps) order by ps.id), '[]'::jsonb)
  into v_size_state_before
  from public.product_sizes ps
  where ps.product_id = any(v_affected_product_ids);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
  into v_recipe_state_before
  from public.inventory_recipes r
  where r.product_size_id in (
    select ps.id from public.product_sizes ps where ps.product_id = any(v_affected_product_ids)
  );

  select coalesce(jsonb_agg(to_jsonb(rl) order by rl.id), '[]'::jsonb)
  into v_recipe_line_state_before
  from public.inventory_recipe_lines rl
  where rl.recipe_id in (
    select r.id from public.inventory_recipes r
    where r.product_size_id in (
      select ps.id from public.product_sizes ps where ps.product_id = any(v_affected_product_ids)
    )
  );

  select coalesce(jsonb_agg(to_jsonb(pog) order by pog.id), '[]'::jsonb)
  into v_option_group_state_before
  from public.product_option_groups pog
  where pog.product_id = any(v_affected_product_ids);

  select coalesce(jsonb_agg(to_jsonb(pod) order by pod.id), '[]'::jsonb)
  into v_option_default_state_before
  from public.product_option_defaults pod
  where pod.product_id = any(v_affected_product_ids);

  select coalesce(jsonb_agg(to_jsonb(oi) order by oi.id), '[]'::jsonb)
  into v_order_item_state_before
  from public.order_items oi
  where oi.product_id = any(v_affected_product_ids)
     or oi.product_size_id in (
       select ps.id from public.product_sizes ps where ps.product_id = any(v_affected_product_ids)
     );

  update public.products p
  set category_id = v_canonical_category_id,
      category_section_id = v_savory_section_id
  where p.id = any(v_expected_redundant_product_ids)
    and p.category_id = v_redundant_category_id;

  if (select count(*) from public.products p where p.category_id = v_redundant_category_id) <> 0
    or (select count(*) from public.category_sections cs where cs.category_id = v_redundant_category_id) <> 0
  then
    raise exception 'STOP: redundant category is not empty after the guarded product move.';
  end if;

  delete from public.categories c where c.id = v_redundant_category_id;
  if not found then
    raise exception 'STOP: redundant category deletion did not affect the expected row.';
  end if;

  update public.categories c
  set name = 'Takoyaki & Savory Bites'
  where c.id = v_canonical_category_id
    and regexp_replace(lower(btrim(c.name)), '\s+', ' ', 'g') = 'curv bites';
  if not found then
    raise exception 'STOP: canonical category rename did not affect the expected row.';
  end if;

  if exists (
    select 1
    from unnest(v_original_canonical_product_ids) as original(product_id)
    left join public.products p on p.id = original.product_id
    where p.id is null or p.category_id <> v_canonical_category_id
  ) then
    raise exception 'STOP: an original canonical Takoyaki product moved or disappeared.';
  end if;

  select coalesce(array_agg(ps.id order by ps.id), '{}'::uuid[])
  into v_og_size_ids_after
  from public.product_sizes ps
  where ps.product_id = v_og_takoyaki_id;

  if v_og_size_ids_after is distinct from v_og_size_ids_before then
    raise exception 'STOP: OG Takoyaki size UUIDs changed during repair.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'image_url', p.image_url,
    'is_available', p.is_available, 'is_published', p.is_published,
    'is_curv_pick', p.is_curv_pick, 'is_seasonal', p.is_seasonal,
    'is_sold_out', p.is_sold_out, 'archived_at', p.archived_at,
    'sort_order', p.sort_order, 'notes', p.notes,
    'variant_group_name', p.variant_group_name, 'menu_group', p.menu_group,
    'badge_labels', p.badge_labels
  ) order by p.id), '[]'::jsonb)
  into v_product_state_after
  from public.products p
  where p.id = any(v_affected_product_ids);

  select coalesce(jsonb_agg(to_jsonb(ps) order by ps.id), '[]'::jsonb)
  into v_size_state_after
  from public.product_sizes ps
  where ps.product_id = any(v_affected_product_ids);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
  into v_recipe_state_after
  from public.inventory_recipes r
  where r.product_size_id in (
    select ps.id from public.product_sizes ps where ps.product_id = any(v_affected_product_ids)
  );

  select coalesce(jsonb_agg(to_jsonb(rl) order by rl.id), '[]'::jsonb)
  into v_recipe_line_state_after
  from public.inventory_recipe_lines rl
  where rl.recipe_id in (
    select r.id from public.inventory_recipes r
    where r.product_size_id in (
      select ps.id from public.product_sizes ps where ps.product_id = any(v_affected_product_ids)
    )
  );

  select coalesce(jsonb_agg(to_jsonb(pog) order by pog.id), '[]'::jsonb)
  into v_option_group_state_after
  from public.product_option_groups pog
  where pog.product_id = any(v_affected_product_ids);

  select coalesce(jsonb_agg(to_jsonb(pod) order by pod.id), '[]'::jsonb)
  into v_option_default_state_after
  from public.product_option_defaults pod
  where pod.product_id = any(v_affected_product_ids);

  select coalesce(jsonb_agg(to_jsonb(oi) order by oi.id), '[]'::jsonb)
  into v_order_item_state_after
  from public.order_items oi
  where oi.product_id = any(v_affected_product_ids)
     or oi.product_size_id in (
       select ps.id from public.product_sizes ps where ps.product_id = any(v_affected_product_ids)
     );

  if v_product_state_after is distinct from v_product_state_before
    or v_size_state_after is distinct from v_size_state_before
    or v_recipe_state_after is distinct from v_recipe_state_before
    or v_recipe_line_state_after is distinct from v_recipe_line_state_before
    or v_option_group_state_after is distinct from v_option_group_state_before
    or v_option_default_state_after is distinct from v_option_default_state_before
    or v_order_item_state_after is distinct from v_order_item_state_before
  then
    raise exception 'STOP: protected product, size, recipe, option, or historical-order state changed.';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = 'ffcf04b4-1500-4463-aa25-3703a1e167ed'
      and p.category_id = v_canonical_category_id
      and p.category_section_id = v_savory_section_id
      and p.archived_at is not null
  ) then
    raise exception 'STOP: archived Shrimp Tempura final state is incorrect.';
  end if;

  if (select count(*) from public.categories c
      where c.id = v_canonical_category_id and c.name = 'Takoyaki & Savory Bites') <> 1
    or exists (select 1 from public.categories c where c.id = v_redundant_category_id)
  then
    raise exception 'STOP: final category state verification failed.';
  end if;
end;
$repair$;

commit;
