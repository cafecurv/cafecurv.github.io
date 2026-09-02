-- CURV Menu Manager - Takoyaki & Savory Bites category repair inspection
-- READ ONLY. Run this single query in Supabase and paste back the complete JSON result.

with relevant_categories as materialized (
  select
    c.id,
    c.name,
    c.sort_order,
    c.is_active,
    regexp_replace(lower(btrim(c.name)), '\s+', ' ', 'g') as normalized_name
  from public.categories c
  where regexp_replace(lower(btrim(c.name)), '\s+', ' ', 'g') in (
    'bites',
    'curv bites',
    'takoyaki',
    'takoyaki & savory bites',
    'savory',
    'savory bites'
  )
),
relevant_products as materialized (
  select p.*
  from public.products p
  where p.category_id in (select rc.id from relevant_categories rc)
     or p.category_section_id in (
       select cs.id
       from public.category_sections cs
       where cs.category_id in (select rc.id from relevant_categories rc)
     )
),
category_foreign_keys as materialized (
  select
    con.conname as constraint_name,
    con.conrelid::regclass::text as referencing_table,
    pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  where con.contype = 'f'
    and con.confrelid = 'public.categories'::regclass
),
product_foreign_keys as materialized (
  select
    con.conname as constraint_name,
    con.conrelid::regclass::text as referencing_table,
    pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  where con.contype = 'f'
    and con.confrelid = 'public.products'::regclass
),
size_foreign_keys as materialized (
  select
    con.conname as constraint_name,
    con.conrelid::regclass::text as referencing_table,
    pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  where con.contype = 'f'
    and con.confrelid = 'public.product_sizes'::regclass
),
section_foreign_keys as materialized (
  select
    con.conname as constraint_name,
    con.conrelid::regclass::text as referencing_table,
    pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  where con.contype = 'f'
    and con.confrelid = 'public.category_sections'::regclass
)
select jsonb_pretty(jsonb_build_object(
  'relevant_categories', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', rc.id,
      'name', rc.name,
      'normalized_name', rc.normalized_name,
      'is_active', rc.is_active,
      'sort_order', rc.sort_order,
      'public_category_visible', exists (
        select 1 from public.public_menu_categories v where v.id = rc.id
      ),
      'menu_manager_delete_blocked', exists (
        select 1
        from public.products p
        where p.category_id = rc.id
           or p.category_section_id in (
             select cs.id from public.category_sections cs where cs.category_id = rc.id
           )
      ),
      'direct_product_count', (
        select count(*) from public.products p where p.category_id = rc.id
      ),
      'section_count', (
        select count(*) from public.category_sections cs where cs.category_id = rc.id
      ),
      'products_linked_through_sections', (
        select count(*)
        from public.products p
        join public.category_sections cs on cs.id = p.category_section_id
        where cs.category_id = rc.id
      )
    ) order by rc.sort_order, rc.name, rc.id)
    from relevant_categories rc
  ), '[]'::jsonb),
  'normalized_category_collisions', coalesce((
    select jsonb_agg(to_jsonb(collisions) order by collisions.normalized_name)
    from (
      select rc.normalized_name, count(*) as category_count, array_agg(rc.id order by rc.id) as category_ids
      from relevant_categories rc
      group by rc.normalized_name
      having count(*) > 1
    ) collisions
  ), '[]'::jsonb),
  'products', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'category_id', p.category_id,
      'category_name', c.name,
      'category_section_id', p.category_section_id,
      'category_section_name', cs.name,
      'section_owner_category_id', cs.category_id,
      'is_published', p.is_published,
      'is_available', p.is_available,
      'is_sold_out', p.is_sold_out,
      'is_curv_pick', p.is_curv_pick,
      'archived_at', p.archived_at,
      'sort_order', p.sort_order,
      'public_product_visible', exists (
        select 1 from public.public_menu_products v where v.id = p.id
      ),
      'sizes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ps.id,
          'label', ps.label,
          'price', ps.price,
          'sort_order', ps.sort_order,
          'public_size_visible', exists (
            select 1 from public.public_menu_product_sizes vps where vps.id = ps.id
          )
        ) order by ps.sort_order, ps.label, ps.id)
        from public.product_sizes ps
        where ps.product_id = p.id
      ), '[]'::jsonb)
    ) order by c.sort_order, c.name, p.sort_order, p.name, p.id)
    from relevant_products p
    left join public.categories c on c.id = p.category_id
    left join public.category_sections cs on cs.id = p.category_section_id
  ), '[]'::jsonb),
  'og_takoyaki_exact_rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'category_id', p.category_id,
      'category_name', c.name,
      'category_active', c.is_active,
      'category_section_id', p.category_section_id,
      'is_published', p.is_published,
      'is_available', p.is_available,
      'is_sold_out', p.is_sold_out,
      'is_curv_pick', p.is_curv_pick,
      'archived_at', p.archived_at,
      'public_product_visible', exists (
        select 1 from public.public_menu_products v where v.id = p.id
      ),
      'size_ids', coalesce((
        select jsonb_agg(ps.id order by ps.sort_order, ps.label, ps.id)
        from public.product_sizes ps where ps.product_id = p.id
      ), '[]'::jsonb)
    ) order by p.id)
    from public.products p
    left join public.categories c on c.id = p.category_id
    where regexp_replace(lower(btrim(p.name)), '\s+', ' ', 'g') = 'og takoyaki'
  ), '[]'::jsonb),
  'category_sections', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', cs.id,
      'category_id', cs.category_id,
      'category_name', rc.name,
      'name', cs.name,
      'is_active', cs.is_active,
      'sort_order', cs.sort_order,
      'linked_product_ids', coalesce((
        select jsonb_agg(p.id order by p.id)
        from public.products p where p.category_section_id = cs.id
      ), '[]'::jsonb)
    ) order by rc.sort_order, rc.name, cs.sort_order, cs.name, cs.id)
    from public.category_sections cs
    join relevant_categories rc on rc.id = cs.category_id
  ), '[]'::jsonb),
  'category_section_mismatches', coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id', p.id,
      'product_name', p.name,
      'product_category_id', p.category_id,
      'section_id', cs.id,
      'section_category_id', cs.category_id
    ) order by p.name, p.id)
    from relevant_products p
    join public.category_sections cs on cs.id = p.category_section_id
    where cs.category_id <> p.category_id
  ), '[]'::jsonb),
  'curv_picks_in_relevant_categories', coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id', p.id,
      'product_name', p.name,
      'category_id', p.category_id,
      'category_name', c.name,
      'is_published', p.is_published,
      'is_available', p.is_available,
      'is_sold_out', p.is_sold_out,
      'archived_at', p.archived_at
    ) order by p.name, p.id)
    from relevant_products p
    left join public.categories c on c.id = p.category_id
    where p.is_curv_pick = true
  ), '[]'::jsonb),
  'foreign_keys_to_categories', coalesce((select jsonb_agg(to_jsonb(f) order by f.referencing_table, f.constraint_name) from category_foreign_keys f), '[]'::jsonb),
  'foreign_keys_to_products', coalesce((select jsonb_agg(to_jsonb(f) order by f.referencing_table, f.constraint_name) from product_foreign_keys f), '[]'::jsonb),
  'foreign_keys_to_product_sizes', coalesce((select jsonb_agg(to_jsonb(f) order by f.referencing_table, f.constraint_name) from size_foreign_keys f), '[]'::jsonb),
  'foreign_keys_to_category_sections', coalesce((select jsonb_agg(to_jsonb(f) order by f.referencing_table, f.constraint_name) from section_foreign_keys f), '[]'::jsonb)
)) as inspection_report;
