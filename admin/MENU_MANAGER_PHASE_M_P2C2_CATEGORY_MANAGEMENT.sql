-- CURV Menu Manager Phase M-P2C.2
-- Atomic category ordering and safe empty-category deletion
--
-- Draft SQL only. Review before running manually in Supabase SQL Editor.

begin;

drop function if exists public.menu_manager_move_category(uuid, text);

create function public.menu_manager_move_category(
  p_category_id uuid,
  p_direction text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_direction text := lower(btrim(coalesce(p_direction, '')));
  v_category_name text;
  v_category_order integer;
  v_neighbor_id uuid;
  v_neighbor_name text;
  v_neighbor_order integer;
  v_categories jsonb;
begin
  if v_actor is null then
    raise exception 'Please sign in before reordering categories.'
      using errcode = 'P0001',
        detail = 'MM_CATEGORY_AUTH_REQUIRED',
        hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can reorder categories.'
      using errcode = 'P0001',
        detail = 'MM_CATEGORY_ADMIN_REQUIRED',
        hint = 'Use an approved owner account.';
  end if;

  if p_category_id is null then
    raise exception 'Choose a category before changing its position.'
      using errcode = 'P0001',
        detail = 'MM_CATEGORY_REQUIRED';
  end if;

  if v_direction not in ('up', 'down') then
    raise exception 'Category direction must be up or down.'
      using errcode = 'P0001',
        detail = 'MM_CATEGORY_DIRECTION_INVALID';
  end if;

  -- Category creation and legacy direct updates use normal table writes. This
  -- small-table lock serializes them with normalization and neighbor swaps.
  lock table public.categories in share row exclusive mode;

  perform 1
  from public.categories c
  order by c.sort_order, lower(c.name), c.id
  for update;

  if not exists (
    select 1
    from public.categories c
    where c.id = p_category_id
  ) then
    raise exception 'That category was not found.'
      using errcode = 'P0001',
        detail = 'MM_CATEGORY_NOT_FOUND',
        hint = 'Refresh Menu Manager and choose an existing category.';
  end if;

  -- Dense deterministic positions make duplicate and sparse legacy values
  -- safe before the immediate neighbor is chosen.
  with ordered as (
    select
      c.id,
      (row_number() over (
        order by c.sort_order, lower(c.name), c.id
      ) - 1)::integer as normalized_order
    from public.categories c
  )
  update public.categories c
  set sort_order = ordered.normalized_order
  from ordered
  where c.id = ordered.id
    and c.sort_order is distinct from ordered.normalized_order;

  select c.name, c.sort_order
  into v_category_name, v_category_order
  from public.categories c
  where c.id = p_category_id;

  if v_direction = 'up' then
    select c.id, c.name, c.sort_order
    into v_neighbor_id, v_neighbor_name, v_neighbor_order
    from public.categories c
    where c.sort_order < v_category_order
    order by c.sort_order desc, lower(c.name) desc, c.id desc
    limit 1;
  else
    select c.id, c.name, c.sort_order
    into v_neighbor_id, v_neighbor_name, v_neighbor_order
    from public.categories c
    where c.sort_order > v_category_order
    order by c.sort_order, lower(c.name), c.id
    limit 1;
  end if;

  if v_neighbor_id is not null then
    update public.categories c
    set sort_order = case
      when c.id = p_category_id then v_neighbor_order
      else v_category_order
    end
    where c.id in (p_category_id, v_neighbor_id);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'sort_order', c.sort_order,
        'is_active', c.is_active
      )
      order by c.sort_order, lower(c.name), c.id
    ),
    '[]'::jsonb
  )
  into v_categories
  from public.categories c;

  return jsonb_build_object(
    'ok', true,
    'operation', case when v_neighbor_id is null then 'no_op' else 'moved' end,
    'category_id', p_category_id,
    'category_name', v_category_name,
    'direction', v_direction,
    'neighbor_id', v_neighbor_id,
    'neighbor_name', v_neighbor_name,
    'categories', v_categories
  );
end;
$$;

drop function if exists public.menu_manager_delete_empty_category(uuid);

create function public.menu_manager_delete_empty_category(
  p_category_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_category_name text;
  v_product_count integer;
  v_deleted_section_count integer := 0;
  v_categories jsonb;
begin
  if v_actor is null then
    raise exception 'Please sign in before deleting a category.'
      using errcode = 'P0001',
        detail = 'MM_CATEGORY_AUTH_REQUIRED',
        hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can delete categories.'
      using errcode = 'P0001',
        detail = 'MM_CATEGORY_ADMIN_REQUIRED',
        hint = 'Use an approved owner account.';
  end if;

  if p_category_id is null then
    raise exception 'Choose a category before deleting it.'
      using errcode = 'P0001',
        detail = 'MM_CATEGORY_REQUIRED';
  end if;

  lock table public.categories in share row exclusive mode;

  perform 1
  from public.categories c
  order by c.sort_order, lower(c.name), c.id
  for update;

  select c.name
  into v_category_name
  from public.categories c
  where c.id = p_category_id;

  if not found then
    raise exception 'That category was not found.'
      using errcode = 'P0001',
        detail = 'MM_CATEGORY_NOT_FOUND',
        hint = 'Refresh Menu Manager and choose an existing category.';
  end if;

  perform 1
  from public.category_sections cs
  where cs.category_id = p_category_id
  order by cs.id
  for update;

  -- Count both direct category membership and any product attached to one of
  -- this category's sections. The second check protects inconsistent legacy
  -- rows instead of clearing their section link through ON DELETE SET NULL.
  perform 1
  from public.products p
  where p.category_id = p_category_id
     or exists (
       select 1
       from public.category_sections cs
       where cs.id = p.category_section_id
         and cs.category_id = p_category_id
     )
  order by p.id
  for update;

  select count(*)::integer
  into v_product_count
  from public.products p
  where p.category_id = p_category_id
     or exists (
       select 1
       from public.category_sections cs
       where cs.id = p.category_section_id
         and cs.category_id = p_category_id
     );

  if v_product_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'This category still contains %s product%s. Move, archive, or remove them before deleting the category.',
        v_product_count,
        case when v_product_count = 1 then '' else 's' end
      ),
      detail = 'MM_CATEGORY_NOT_EMPTY';
  end if;

  delete from public.category_sections cs
  where cs.category_id = p_category_id;
  get diagnostics v_deleted_section_count = row_count;

  delete from public.categories c
  where c.id = p_category_id;

  with ordered as (
    select
      c.id,
      (row_number() over (
        order by c.sort_order, lower(c.name), c.id
      ) - 1)::integer as normalized_order
    from public.categories c
  )
  update public.categories c
  set sort_order = ordered.normalized_order
  from ordered
  where c.id = ordered.id
    and c.sort_order is distinct from ordered.normalized_order;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'sort_order', c.sort_order,
        'is_active', c.is_active
      )
      order by c.sort_order, lower(c.name), c.id
    ),
    '[]'::jsonb
  )
  into v_categories
  from public.categories c;

  return jsonb_build_object(
    'ok', true,
    'operation', 'deleted',
    'category_id', p_category_id,
    'category_name', v_category_name,
    'deleted_section_count', v_deleted_section_count,
    'categories', v_categories
  );
end;
$$;

revoke all on function public.menu_manager_move_category(uuid, text) from public;
revoke execute on function public.menu_manager_move_category(uuid, text) from anon;
grant execute on function public.menu_manager_move_category(uuid, text) to authenticated;

revoke all on function public.menu_manager_delete_empty_category(uuid) from public;
revoke execute on function public.menu_manager_delete_empty_category(uuid) from anon;
grant execute on function public.menu_manager_delete_empty_category(uuid) to authenticated;

comment on function public.menu_manager_move_category(uuid, text) is
  'Owner-only atomic category move. Normalizes duplicate or sparse ordering before swapping the immediate neighbor.';

comment on function public.menu_manager_delete_empty_category(uuid) is
  'Owner-only permanent deletion for product-free categories. Removes empty sections and normalizes remaining ordering.';

commit;
