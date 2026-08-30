-- CURV Timekeeping T3C
-- Owner-only administrative closure for forgotten open shifts.
--
-- Draft migration only. Review before running manually in Supabase SQL Editor.

begin;

create table if not exists public.attendance_admin_closures (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,
  closed_at timestamptz not null,
  reason text not null,
  closed_by uuid not null references auth.users(id) on delete restrict,
  had_open_break boolean not null default false,
  open_break_closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_admin_closures_session_unique unique (session_id),
  constraint attendance_admin_closures_reason_valid check (
    reason = btrim(reason)
    and reason <> ''
    and char_length(reason) <= 500
  ),
  constraint attendance_admin_closures_break_state_valid check (
    (had_open_break = false and open_break_closed_at is null)
    or (had_open_break = true and open_break_closed_at is not null and open_break_closed_at <= closed_at)
  )
);

comment on table public.attendance_admin_closures is
  'Append-only owner audit for forgotten open shifts. One row records the operational close and any open-break resolution.';

create or replace function public.timekeeping_admin_close_open_shift(
  p_session_id uuid,
  p_clocked_out_at timestamptz,
  p_reason text,
  p_break_ended_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_session public.attendance_sessions%rowtype;
  v_open_break public.attendance_breaks%rowtype;
  v_staff_name text;
  v_had_open_break boolean := false;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Only a signed-in CURV owner can close an open shift.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_FORBIDDEN',
        hint = 'Sign in with an approved CURV owner account.';
  end if;

  if p_session_id is null
    or p_clocked_out_at is null
    or v_reason = ''
    or char_length(v_reason) > 500
  then
    raise exception 'Session, actual clock-out, and a reason of 500 characters or fewer are required.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
  end if;

  select s.*
  into v_session
  from public.attendance_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'The attendance session no longer exists.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
  end if;

  if v_session.clocked_out_at is not null then
    raise exception 'This shift has already been closed.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_SHIFT_ALREADY_CLOSED';
  end if;

  select st.name
  into v_staff_name
  from public.staff st
  where st.id = v_session.staff_id;

  if not found then
    raise exception 'The staff member for this session no longer exists.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
  end if;

  if p_clocked_out_at < v_session.clocked_in_at or p_clocked_out_at > v_now then
    raise exception 'Actual clock-out must be between clock-in and the current time.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
  end if;

  select b.*
  into v_open_break
  from public.attendance_breaks b
  where b.session_id = v_session.id
    and b.ended_at is null
  order by b.started_at desc, b.id
  limit 1
  for update;

  v_had_open_break := found;

  if v_had_open_break and p_break_ended_at is null then
    raise exception 'This shift still has an open break.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_OPEN_BREAK_ACTIVE',
        hint = 'Enter the actual break end before closing the shift.';
  end if;

  if not v_had_open_break and p_break_ended_at is not null then
    raise exception 'The open break has already been resolved.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
  end if;

  if v_had_open_break and (
    p_break_ended_at < v_open_break.started_at
    or p_break_ended_at > p_clocked_out_at
    or p_break_ended_at > v_now
  ) then
    raise exception 'Actual break end must be between break start and clock-out.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
  end if;

  if v_had_open_break then
    update public.attendance_breaks b
    set ended_at = p_break_ended_at
    where b.id = v_open_break.id
      and b.ended_at is null;

    if not found then
      raise exception 'The open break changed while this shift was being closed.'
        using errcode = 'P0001',
          detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
    end if;
  end if;

  update public.attendance_sessions s
  set clocked_out_at = p_clocked_out_at
  where s.id = v_session.id
    and s.clocked_out_at is null;

  if not found then
    raise exception 'This shift has already been closed.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_SHIFT_ALREADY_CLOSED';
  end if;

  begin
    insert into public.attendance_admin_closures (
      session_id,
      closed_at,
      reason,
      closed_by,
      had_open_break,
      open_break_closed_at,
      created_at
    ) values (
      v_session.id,
      p_clocked_out_at,
      v_reason,
      v_actor,
      v_had_open_break,
      case when v_had_open_break then p_break_ended_at else null end,
      v_now
    );
  exception when unique_violation then
    raise exception 'This shift already has an owner closure record.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_SHIFT_ALREADY_CLOSED';
  end;

  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'staff_id', v_session.staff_id,
    'staff_name', v_staff_name,
    'clocked_in_at', v_session.clocked_in_at,
    'clocked_out_at', p_clocked_out_at,
    'admin_closed', true,
    'break_closed', v_had_open_break,
    'break_ended_at', case when v_had_open_break then p_break_ended_at else null end
  );
end;
$$;

create or replace view public.attendance_effective_sessions
with (security_invoker = true)
as
with effective as (
  select
    s.id as session_id,
    s.staff_id,
    st.name as staff_name,
    st.is_active as staff_is_active,
    s.clocked_in_at as original_clocked_in_at,
    s.clocked_out_at as original_clocked_out_at,
    latest.corrected_clocked_in_at,
    latest.corrected_clocked_out_at,
    coalesce(latest.corrected_clocked_in_at, s.clocked_in_at) as effective_clocked_in_at,
    coalesce(latest.corrected_clocked_out_at, s.clocked_out_at) as effective_clocked_out_at,
    latest.id is not null as has_correction,
    latest.reason as latest_correction_reason,
    latest.corrected_at as latest_corrected_at,
    latest.corrected_by as latest_corrected_by,
    s.created_at as session_created_at,
    coalesce(break_totals.total_break_seconds, 0::bigint)::bigint as total_break_seconds,
    closure.id is not null as was_admin_closed,
    closure.reason as admin_close_reason,
    closure.created_at as admin_closed_at,
    coalesce(closure.had_open_break, false) as admin_had_open_break,
    closure.open_break_closed_at as admin_open_break_closed_at
  from public.attendance_sessions s
  join public.staff st on st.id = s.staff_id
  left join lateral (
    select c.*
    from public.attendance_corrections c
    where c.session_id = s.id
    order by c.corrected_at desc, c.id desc
    limit 1
  ) latest on true
  left join lateral (
    select coalesce(
      sum(greatest(
        0::numeric,
        floor(extract(epoch from (b.ended_at - b.started_at)))
      ))::bigint,
      0::bigint
    )::bigint as total_break_seconds
    from public.attendance_breaks b
    where b.session_id = s.id
      and b.ended_at is not null
  ) break_totals on true
  left join public.attendance_admin_closures closure on closure.session_id = s.id
), measured as (
  select
    effective.*,
    greatest(
      0::numeric,
      floor(extract(epoch from (
        coalesce(effective.effective_clocked_out_at, statement_timestamp())
        - effective.effective_clocked_in_at
      )))
    )::bigint as effective_duration_seconds
  from effective
)
select
  measured.session_id::uuid as session_id,
  measured.staff_id::uuid as staff_id,
  measured.staff_name::text as staff_name,
  measured.staff_is_active::boolean as staff_is_active,
  measured.original_clocked_in_at::timestamptz as original_clocked_in_at,
  measured.original_clocked_out_at::timestamptz as original_clocked_out_at,
  measured.corrected_clocked_in_at::timestamptz as corrected_clocked_in_at,
  measured.corrected_clocked_out_at::timestamptz as corrected_clocked_out_at,
  measured.effective_clocked_in_at::timestamptz as effective_clocked_in_at,
  measured.effective_clocked_out_at::timestamptz as effective_clocked_out_at,
  measured.effective_duration_seconds::bigint as effective_duration_seconds,
  measured.has_correction::boolean as has_correction,
  measured.latest_correction_reason::text as latest_correction_reason,
  measured.latest_corrected_at::timestamptz as latest_corrected_at,
  measured.latest_corrected_by::uuid as latest_corrected_by,
  measured.session_created_at::timestamptz as session_created_at,
  measured.total_break_seconds::bigint as total_break_seconds,
  greatest(
    0::bigint,
    measured.effective_duration_seconds::bigint - measured.total_break_seconds::bigint
  )::bigint as worked_seconds,
  measured.was_admin_closed::boolean as was_admin_closed,
  measured.admin_close_reason::text as admin_close_reason,
  measured.admin_closed_at::timestamptz as admin_closed_at,
  measured.admin_had_open_break::boolean as admin_had_open_break,
  measured.admin_open_break_closed_at::timestamptz as admin_open_break_closed_at
from measured;

comment on view public.attendance_effective_sessions is
  'Owner-only attendance history with break-aware worked time, latest corrections, and preserved owner administrative-closure audit fields.';

alter table public.attendance_admin_closures enable row level security;

drop policy if exists "Owners can read attendance admin closures" on public.attendance_admin_closures;
create policy "Owners can read attendance admin closures"
  on public.attendance_admin_closures
  for select
  to authenticated
  using (public.is_admin());

revoke all on table public.attendance_admin_closures from public, anon, authenticated;
grant select (
  id,
  session_id,
  closed_at,
  reason,
  had_open_break,
  open_break_closed_at,
  created_at
) on public.attendance_admin_closures to authenticated;

revoke all on table public.attendance_effective_sessions from public, anon, authenticated;
grant select on public.attendance_effective_sessions to authenticated;

revoke all on function public.timekeeping_admin_close_open_shift(uuid, timestamptz, text, timestamptz) from public;
revoke execute on function public.timekeeping_admin_close_open_shift(uuid, timestamptz, text, timestamptz) from anon;
grant execute on function public.timekeeping_admin_close_open_shift(uuid, timestamptz, text, timestamptz) to authenticated;

comment on function public.timekeeping_admin_close_open_shift(uuid, timestamptz, text, timestamptz) is
  'Owner-only atomic closure of a forgotten open shift with explicit open-break resolution and an immutable audit row.';

commit;
