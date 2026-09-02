-- CURV Menu Manager - Existing Archived Products Inspection
-- READ ONLY. This query does not restore, delete, or update anything.

select
  p.id as product_id,
  p.name as product_name,
  p.archived_at,
  p.is_published,
  p.is_available,
  p.is_sold_out,
  p.is_curv_pick,
  c.id as category_id,
  c.name as category_name,
  coalesce(
    jsonb_agg(
      distinct jsonb_build_object(
        'size_id', ps.id,
        'label', ps.label,
        'price', ps.price,
        'sort_order', ps.sort_order
      )
    ) filter (where ps.id is not null),
    '[]'::jsonb
  ) as sizes,
  count(distinct ir.id)::integer as recipe_dependency_count
from public.products p
left join public.categories c on c.id = p.category_id
left join public.product_sizes ps on ps.product_id = p.id
left join public.inventory_recipes ir on ir.product_size_id = ps.id
where p.archived_at is not null
group by
  p.id,
  p.name,
  p.archived_at,
  p.is_published,
  p.is_available,
  p.is_sold_out,
  p.is_curv_pick,
  c.id,
  c.name
order by p.archived_at, lower(p.name), p.id;
