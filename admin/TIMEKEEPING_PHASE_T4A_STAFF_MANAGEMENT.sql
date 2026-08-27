-- CURV Timekeeping T4A
-- Owner-only staff management backend.
--
-- Draft migration only. Review before running manually in Supabase SQL Editor.

begin;

-- Active kiosk names must be unambiguous. Inactive historical staff may share
-- a name, but only one case-insensitive trimmed form may be active at a time.
do $$
begin
  if exists (
    select 1
    from public.staff s
    where s.is_active = true
    group by lower(btrim(s.name))
    having count(*) > 1
  ) then
    raise exception 'Resolve duplicate active staff names before applying T4A.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_STAFF_NAME_DUPLICATE';
  end if;
end;
$$;

create unique index if not exists staff_one_active_normalized_name_idx
  on public.staff (lower(btrim(name)))
  where is_active = true;

-- =========================================================
-- Owner list
-- =========================================================

create or replace function public.timekeeping_admin_list_staff()
returns table (
  id uuid,
  name text,
  is_active boolean,
  display_order integer,
  created_at timestamptz,
  is_clocked_in boolean,
  is_on_break boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Owner access is required.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_FORBIDDEN';
  end if;

  return query
  select
    s.id,
    s.name,
    s.is_active,
    s.display_order,
    s.created_at,
    open_session.id is not null as is_clocked_in,
    open_break.id is not null as is_on_break
  from public.staff s
  left join lateral (
    select a.id
    from public.attendance_sessions a
    where a.staff_id = s.id
      and a.clocked_out_at is null
    order by a.clocked_in_at desc, a.id
    limit 1
  ) open_session on true
  left join lateral (
    select b.id
    from public.attendance_breaks b
    where b.session_id = open_session.id
      and b.ended_at is null
    order by b.started_at desc, b.id
    limit 1
  ) open_break on true
  order by s.display_order, lower(btrim(s.name)), s.id;
end;
$$;

-- =========================================================
-- Create staff
-- =========================================================

create or replace function public.timekeeping_admin_create_staff(
  p_name text,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_staff public.staff%rowtype;
  v_next_order integer;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Owner access is required.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_FORBIDDEN';
  end if;

  if v_name = '' or char_length(v_name) > 120 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_INVALID_STAFF_NAME',
      'message', 'Enter a staff name between 1 and 120 characters.'
    );
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_INVALID_PIN',
      'message', 'Enter exactly four digits for the PIN.'
    );
  end if;

  lock table public.staff in share row exclusive mode;

  if exists (
    select 1
    from public.staff s
    where s.is_active = true
      and lower(btrim(s.name)) = lower(v_name)
  ) then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NAME_DUPLICATE',
      'message', 'A team member with this name already exists.'
    );
  end if;

  -- Keep the management order canonical before appending the new staff row.
  with ordered as (
    select
      s.id,
      (row_number() over (order by s.display_order, lower(btrim(s.name)), s.id) - 1)::integer as new_order
    from public.staff s
  )
  update public.staff s
  set display_order = ordered.new_order
  from ordered
  where s.id = ordered.id
    and s.display_order is distinct from ordered.new_order;

  select count(*)::integer into v_next_order from public.staff;

  begin
    insert into public.staff (
      name,
      pin_hash,
      is_active,
      display_order,
      created_by
    ) values (
      v_name,
      extensions.crypt(p_pin, extensions.gen_salt('bf', 8)),
      true,
      v_next_order,
      v_actor
    )
    returning * into v_staff;
  exception when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NAME_DUPLICATE',
      'message', 'A team member with this name already exists.'
    );
  end;

  return jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object(
      'id', v_staff.id,
      'name', v_staff.name,
      'is_active', v_staff.is_active,
      'display_order', v_staff.display_order,
      'created_at', v_staff.created_at,
      'is_clocked_in', false,
      'is_on_break', false
    )
  );
end;
$$;

-- =========================================================
-- Rename staff
-- =========================================================

create or replace function public.timekeeping_admin_rename_staff(
  p_staff_id uuid,
  p_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_staff public.staff%rowtype;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Owner access is required.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_FORBIDDEN';
  end if;

  if p_staff_id is null then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NOT_FOUND',
      'message', 'That team member no longer exists.'
    );
  end if;

  if v_name = '' or char_length(v_name) > 120 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_INVALID_STAFF_NAME',
      'message', 'Enter a staff name between 1 and 120 characters.'
    );
  end if;

  lock table public.staff in share row exclusive mode;

  select s.* into v_staff
  from public.staff s
  where s.id = p_staff_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NOT_FOUND',
      'message', 'That team member no longer exists.'
    );
  end if;

  if v_staff.is_active and exists (
    select 1
    from public.staff other_staff
    where other_staff.id <> v_staff.id
      and other_staff.is_active = true
      and lower(btrim(other_staff.name)) = lower(v_name)
  ) then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NAME_DUPLICATE',
      'message', 'A team member with this name already exists.'
    );
  end if;

  begin
    update public.staff s
    set name = v_name
    where s.id = v_staff.id
    returning * into v_staff;
  exception when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NAME_DUPLICATE',
      'message', 'A team member with this name already exists.'
    );
  end;

  return jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object(
      'id', v_staff.id,
      'name', v_staff.name,
      'is_active', v_staff.is_active,
      'display_order', v_staff.display_order,
      'created_at', v_staff.created_at
    )
  );
end;
$$;

-- =========================================================
-- Reset staff PIN
-- =========================================================

create or replace function public.timekeeping_admin_reset_staff_pin(
  p_staff_id uuid,
  p_new_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_staff_id uuid;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Owner access is required.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_FORBIDDEN';
  end if;

  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_INVALID_PIN',
      'message', 'Enter exactly four digits for the PIN.'
    );
  end if;

  lock table public.staff in share row exclusive mode;

  select s.id into v_staff_id
  from public.staff s
  where s.id = p_staff_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NOT_FOUND',
      'message', 'That team member no longer exists.'
    );
  end if;

  update public.staff s
  set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8))
  where s.id = v_staff_id;

  delete from public.timekeeping_pin_attempts a
  where a.staff_id = v_staff_id;

  return jsonb_build_object(
    'ok', true,
    'staff_id', v_staff_id
  );
end;
$$;

-- =========================================================
-- Activate/deactivate staff
-- =========================================================

create or replace function public.timekeeping_admin_set_staff_active(
  p_staff_id uuid,
  p_is_active boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_staff public.staff%rowtype;
  v_open_session_id uuid;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Owner access is required.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_FORBIDDEN';
  end if;

  if p_staff_id is null then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NOT_FOUND',
      'message', 'That team member no longer exists.'
    );
  end if;

  if p_is_active is null then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_INVALID_ACTIVE_STATE',
      'message', 'Choose whether this team member is active.'
    );
  end if;

  lock table public.staff in share row exclusive mode;

  select s.* into v_staff
  from public.staff s
  where s.id = p_staff_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NOT_FOUND',
      'message', 'That team member no longer exists.'
    );
  end if;

  if v_staff.is_active = p_is_active then
    return jsonb_build_object(
      'ok', true,
      'staff', jsonb_build_object(
        'id', v_staff.id,
        'name', v_staff.name,
        'is_active', v_staff.is_active,
        'display_order', v_staff.display_order,
        'created_at', v_staff.created_at
      )
    );
  end if;

  if p_is_active then
    if exists (
      select 1
      from public.staff other_staff
      where other_staff.id <> v_staff.id
        and other_staff.is_active = true
        and lower(btrim(other_staff.name)) = lower(btrim(v_staff.name))
    ) then
      return jsonb_build_object(
        'ok', false,
        'error_code', 'TIMEKEEPING_STAFF_NAME_DUPLICATE',
        'message', 'A team member with this name already exists.'
      );
    end if;
  else
    select a.id into v_open_session_id
    from public.attendance_sessions a
    where a.staff_id = v_staff.id
      and a.clocked_out_at is null
    order by a.clocked_in_at desc, a.id
    limit 1
    for update;

    if found then
      return jsonb_build_object(
        'ok', false,
        'error_code', 'TIMEKEEPING_STAFF_CLOCKED_IN',
        'message', 'Clock this team member out before deactivating them.'
      );
    end if;
  end if;

  begin
    update public.staff s
    set is_active = p_is_active
    where s.id = v_staff.id
    returning * into v_staff;
  exception when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NAME_DUPLICATE',
      'message', 'A team member with this name already exists.'
    );
  end;

  return jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object(
      'id', v_staff.id,
      'name', v_staff.name,
      'is_active', v_staff.is_active,
      'display_order', v_staff.display_order,
      'created_at', v_staff.created_at
    )
  );
end;
$$;

-- =========================================================
-- Move staff in canonical management order
-- =========================================================

create or replace function public.timekeeping_admin_move_staff(
  p_staff_id uuid,
  p_direction text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_direction text := lower(btrim(coalesce(p_direction, '')));
  v_current_order integer;
  v_neighbor_order integer;
  v_neighbor_id uuid;
  v_staff_list jsonb;
  v_moved boolean := false;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Owner access is required.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_FORBIDDEN';
  end if;

  if v_direction not in ('up', 'down') then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_INVALID_MOVE_DIRECTION',
      'message', 'Move direction must be up or down.'
    );
  end if;

  lock table public.staff in share row exclusive mode;

  if not exists (select 1 from public.staff s where s.id = p_staff_id) then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_STAFF_NOT_FOUND',
      'message', 'That team member no longer exists.'
    );
  end if;

  -- Normalize sparse and duplicate values deterministically before moving.
  with ordered as (
    select
      s.id,
      (row_number() over (order by s.display_order, lower(btrim(s.name)), s.id) - 1)::integer as new_order
    from public.staff s
  )
  update public.staff s
  set display_order = ordered.new_order
  from ordered
  where s.id = ordered.id
    and s.display_order is distinct from ordered.new_order;

  select s.display_order into v_current_order
  from public.staff s
  where s.id = p_staff_id
  for update;

  v_neighbor_order := v_current_order + case when v_direction = 'up' then -1 else 1 end;

  select s.id into v_neighbor_id
  from public.staff s
  where s.display_order = v_neighbor_order
  limit 1
  for update;

  if found then
    update public.staff s
    set display_order = case
      when s.id = p_staff_id then v_neighbor_order
      when s.id = v_neighbor_id then v_current_order
      else s.display_order
    end
    where s.id in (p_staff_id, v_neighbor_id);
    v_moved := true;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'is_active', s.is_active,
        'display_order', s.display_order,
        'created_at', s.created_at,
        'is_clocked_in', open_session.id is not null,
        'is_on_break', open_break.id is not null
      ) order by s.display_order, lower(btrim(s.name)), s.id
    ),
    '[]'::jsonb
  ) into v_staff_list
  from public.staff s
  left join lateral (
    select a.id
    from public.attendance_sessions a
    where a.staff_id = s.id
      and a.clocked_out_at is null
    order by a.clocked_in_at desc, a.id
    limit 1
  ) open_session on true
  left join lateral (
    select b.id
    from public.attendance_breaks b
    where b.session_id = open_session.id
      and b.ended_at is null
    order by b.started_at desc, b.id
    limit 1
  ) open_break on true;

  return jsonb_build_object(
    'ok', true,
    'staff_id', p_staff_id,
    'direction', v_direction,
    'moved', v_moved,
    'staff', v_staff_list
  );
end;
$$;

-- =========================================================
-- Privileges
-- =========================================================

revoke all on function public.timekeeping_admin_list_staff() from public;
revoke execute on function public.timekeeping_admin_list_staff() from anon;
grant execute on function public.timekeeping_admin_list_staff() to authenticated;

revoke all on function public.timekeeping_admin_create_staff(text, text) from public;
revoke execute on function public.timekeeping_admin_create_staff(text, text) from anon;
grant execute on function public.timekeeping_admin_create_staff(text, text) to authenticated;

revoke all on function public.timekeeping_admin_rename_staff(uuid, text) from public;
revoke execute on function public.timekeeping_admin_rename_staff(uuid, text) from anon;
grant execute on function public.timekeeping_admin_rename_staff(uuid, text) to authenticated;

revoke all on function public.timekeeping_admin_reset_staff_pin(uuid, text) from public;
revoke execute on function public.timekeeping_admin_reset_staff_pin(uuid, text) from anon;
grant execute on function public.timekeeping_admin_reset_staff_pin(uuid, text) to authenticated;

revoke all on function public.timekeeping_admin_set_staff_active(uuid, boolean) from public;
revoke execute on function public.timekeeping_admin_set_staff_active(uuid, boolean) from anon;
grant execute on function public.timekeeping_admin_set_staff_active(uuid, boolean) to authenticated;

revoke all on function public.timekeeping_admin_move_staff(uuid, text) from public;
revoke execute on function public.timekeeping_admin_move_staff(uuid, text) from anon;
grant execute on function public.timekeeping_admin_move_staff(uuid, text) to authenticated;

comment on function public.timekeeping_admin_list_staff() is
  'Owner-only safe staff list with current shift and break state. PIN hashes and attempt details are never returned.';

comment on function public.timekeeping_admin_create_staff(text, text) is
  'Owner-only staff creation with a server-generated bcrypt PIN hash and canonical kiosk order.';

comment on function public.timekeeping_admin_rename_staff(uuid, text) is
  'Owner-only staff rename preserving identity, PIN hash, lifecycle state, order, and attendance history.';

comment on function public.timekeeping_admin_reset_staff_pin(uuid, text) is
  'Owner-only PIN reset that creates a new bcrypt hash and clears prior failed-PIN throttle rows.';

comment on function public.timekeeping_admin_set_staff_active(uuid, boolean) is
  'Owner-only lifecycle control. Open attendance sessions block deactivation; history is never changed.';

comment on function public.timekeeping_admin_move_staff(uuid, text) is
  'Owner-only atomic staff ordering across active and inactive staff after deterministic normalization.';

commit;
