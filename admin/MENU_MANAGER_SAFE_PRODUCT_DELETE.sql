-- CURV Menu Manager - Safe Product Delete
-- Draft SQL only. Review before running manually in Supabase SQL Editor.

begin;

drop function if exists public.menu_manager_delete_product(uuid);

create function public.menu_manager_delete_product(
  p_product_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
  v_size_count integer := 0;
  v_option_assignment_count integer := 0;
  v_option_default_count integer := 0;
  v_order_item_reference_count integer := 0;
  v_deleted_count integer := 0;
begin
  if v_actor is null then
    raise exception 'Please sign in before deleting a product.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_DELETE_AUTH_REQUIRED',
        hint = 'Sign in with the CURV owner account.';
  end if;

  if not public.is_admin() then
    raise exception 'Only CURV owners can delete products.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_DELETE_ADMIN_REQUIRED',
        hint = 'Use an approved owner account.';
  end if;

  if p_product_id is null then
    raise exception 'Choose a product before deleting it.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_DELETE_PRODUCT_REQUIRED';
  end if;

  select p.*
  into v_product
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'That product was not found.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_DELETE_NOT_FOUND',
        hint = 'Refresh Menu Manager and choose an existing product.';
  end if;

  if v_product.archived_at is not null then
    raise exception 'This legacy archived product needs owner review before deletion.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_ARCHIVED_REVIEW_REQUIRED',
        hint = 'Review archived products separately before restoring or deleting them.';
  end if;

  -- Lock sizes before checking recipes so a recipe cannot be attached between
  -- the dependency check and the product delete.
  perform 1
  from public.product_sizes ps
  where ps.product_id = p_product_id
  order by ps.id
  for update;

  perform 1
  from public.inventory_recipes ir
  join public.product_sizes ps on ps.id = ir.product_size_id
  where ps.product_id = p_product_id
  order by ir.id
  for update of ir;

  if found then
    raise exception 'This item cannot be deleted because one or more of its sizes are used by Inventory Recipes.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_RECIPE_PROTECTED',
        hint = 'Remove or reassign the affected recipes before deleting this product.';
  end if;

  select count(*)::integer into v_size_count
  from public.product_sizes ps
  where ps.product_id = p_product_id;

  select count(*)::integer into v_option_assignment_count
  from public.product_option_groups pog
  where pog.product_id = p_product_id;

  select count(*)::integer into v_option_default_count
  from public.product_option_defaults pod
  where pod.product_id = p_product_id;

  -- order_items keeps immutable display snapshots and intentionally has no
  -- foreign key to the live product or size rows.
  select count(*)::integer into v_order_item_reference_count
  from public.order_items oi
  where oi.product_id = p_product_id
     or oi.product_size_id in (
       select ps.id
       from public.product_sizes ps
       where ps.product_id = p_product_id
     );

  begin
    delete from public.products p
    where p.id = p_product_id;
    get diagnostics v_deleted_count = row_count;
  exception when foreign_key_violation then
    raise exception 'This item cannot be deleted because another protected record still references it.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_REFERENCE_PROTECTED',
        hint = 'Review the remaining dependency before trying again.';
  end;

  if v_deleted_count <> 1 then
    raise exception 'The product changed before deletion completed.'
      using errcode = 'P0001',
        detail = 'MM_PRODUCT_DELETE_NOT_FOUND',
        hint = 'Refresh Menu Manager and try again.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'operation', 'deleted',
    'product_id', v_product.id,
    'product_name', v_product.name,
    'category_id', v_product.category_id,
    'deleted_size_count', v_size_count,
    'deleted_option_assignment_count', v_option_assignment_count,
    'deleted_option_default_count', v_option_default_count,
    'preserved_order_item_reference_count', v_order_item_reference_count
  );
end;
$$;

revoke all on function public.menu_manager_delete_product(uuid) from public;
revoke execute on function public.menu_manager_delete_product(uuid) from anon;
grant execute on function public.menu_manager_delete_product(uuid) to authenticated;

comment on function public.menu_manager_delete_product(uuid) is
  'Owner-only permanent product deletion. Blocks recipe-backed sizes, preserves order-item snapshots, cascades disposable size/option configuration, and never mutates categories.';

commit;
