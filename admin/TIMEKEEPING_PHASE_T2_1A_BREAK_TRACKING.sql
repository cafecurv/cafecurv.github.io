-- CURV Timekeeping T2.1A
-- Unpaid break tracking, kiosk break RPCs, and break-aware owner reporting.
--
-- Draft migration only. Review before running manually in Supabase SQL Editor.

begin;

-- =========================================================
-- Break history
-- =========================================================

create table if not exists public.attendance_breaks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_breaks_time_order_valid check (
    ended_at is null or ended_at >= started_at
  )
);

comment on table public.attendance_breaks is
  'Server-timestamped unpaid break history. Multiple completed breaks are allowed, but each attendance session may have only one open break.';

create unique index if not exists attendance_breaks_one_open_per_session_idx
  on public.attendance_breaks (session_id)
  where ended_at is null;

create index if not exists attendance_breaks_session_started_idx
  on public.attendance_breaks (session_id, started_at, id);

-- =========================================================
-- Kiosk status: include current break state after PIN check
-- =========================================================

create or replace function public.timekeeping_get_staff_status(
  p_staff_id uuid,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth record;
  v_session public.attendance_sessions%rowtype;
  v_break public.attendance_breaks%rowtype;
  v_is_clocked_in boolean := false;
  v_is_on_break boolean := false;
begin
  select *
  into v_auth
  from public.timekeeping_verify_staff_pin(p_staff_id, p_pin);

  if v_auth.error_code is not null then
    return jsonb_build_object(
      'ok', false,
      'error_code', v_auth.error_code,
      'message', v_auth.error_message
    );
  end if;

  select s.*
  into v_session
  from public.attendance_sessions s
  where s.staff_id = v_auth.verified_staff_id
    and s.clocked_out_at is null
  order by s.clocked_in_at desc, s.id
  limit 1;

  v_is_clocked_in := found;

  if v_is_clocked_in then
    select b.*
    into v_break
    from public.attendance_breaks b
    where b.session_id = v_session.id
      and b.ended_at is null
    order by b.started_at desc, b.id
    limit 1;

    v_is_on_break := found;
  end if;

  return jsonb_build_object(
    'ok', true,
    'staff_id', v_auth.verified_staff_id,
    'staff_name', v_auth.verified_staff_name,
    'is_clocked_in', v_is_clocked_in,
    'clocked_in_at', case when v_is_clocked_in then v_session.clocked_in_at else null end,
    'session_id', case when v_is_clocked_in then v_session.id else null end,
    'is_on_break', v_is_on_break,
    'break_started_at', case when v_is_on_break then v_break.started_at else null end
  );
end;
$$;

-- =========================================================
-- Start Break
-- =========================================================

create or replace function public.timekeeping_start_break(
  p_staff_id uuid,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth record;
  v_session public.attendance_sessions%rowtype;
  v_existing_break_id uuid;
  v_break public.attendance_breaks%rowtype;
  v_started_at timestamptz;
begin
  select *
  into v_auth
  from public.timekeeping_verify_staff_pin(p_staff_id, p_pin);

  if v_auth.error_code is not null then
    return jsonb_build_object(
      'ok', false,
      'error_code', v_auth.error_code,
      'message', v_auth.error_message
    );
  end if;

  select s.*
  into v_session
  from public.attendance_sessions s
  where s.staff_id = v_auth.verified_staff_id
    and s.clocked_out_at is null
  order by s.clocked_in_at desc, s.id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_NOT_CLOCKED_IN',
      'message', 'You are not currently clocked in.'
    );
  end if;

  select b.id
  into v_existing_break_id
  from public.attendance_breaks b
  where b.session_id = v_session.id
    and b.ended_at is null
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_ALREADY_ON_BREAK',
      'message', 'You are already on break.'
    );
  end if;

  v_started_at := clock_timestamp();

  begin
    insert into public.attendance_breaks (session_id, started_at)
    values (v_session.id, v_started_at)
    returning * into v_break;
  exception when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_ALREADY_ON_BREAK',
      'message', 'You are already on break.'
    );
  end;

  return jsonb_build_object(
    'ok', true,
    'staff_id', v_auth.verified_staff_id,
    'staff_name', v_auth.verified_staff_name,
    'session_id', v_session.id,
    'break_id', v_break.id,
    'started_at', v_break.started_at
  );
end;
$$;

-- =========================================================
-- End Break
-- =========================================================

create or replace function public.timekeeping_end_break(
  p_staff_id uuid,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth record;
  v_session public.attendance_sessions%rowtype;
  v_break public.attendance_breaks%rowtype;
  v_ended_at timestamptz;
  v_duration_seconds bigint;
begin
  select *
  into v_auth
  from public.timekeeping_verify_staff_pin(p_staff_id, p_pin);

  if v_auth.error_code is not null then
    return jsonb_build_object(
      'ok', false,
      'error_code', v_auth.error_code,
      'message', v_auth.error_message
    );
  end if;

  select s.*
  into v_session
  from public.attendance_sessions s
  where s.staff_id = v_auth.verified_staff_id
    and s.clocked_out_at is null
  order by s.clocked_in_at desc, s.id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_NOT_CLOCKED_IN',
      'message', 'You are not currently clocked in.'
    );
  end if;

  select b.*
  into v_break
  from public.attendance_breaks b
  where b.session_id = v_session.id
    and b.ended_at is null
  order by b.started_at desc, b.id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_NOT_ON_BREAK',
      'message', 'You are not currently on break.'
    );
  end if;

  v_ended_at := greatest(clock_timestamp(), v_break.started_at);

  update public.attendance_breaks b
  set ended_at = v_ended_at
  where b.id = v_break.id
  returning * into v_break;

  v_duration_seconds := greatest(
    0::numeric,
    floor(extract(epoch from (v_break.ended_at - v_break.started_at)))
  )::bigint;

  return jsonb_build_object(
    'ok', true,
    'staff_id', v_auth.verified_staff_id,
    'staff_name', v_auth.verified_staff_name,
    'session_id', v_session.id,
    'break_id', v_break.id,
    'started_at', v_break.started_at,
    'ended_at', v_break.ended_at,
    'duration_seconds', v_duration_seconds
  );
end;
$$;

-- =========================================================
-- Clock Out: require an explicit End Break first
-- =========================================================

create or replace function public.timekeeping_clock_out(
  p_staff_id uuid,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth record;
  v_session public.attendance_sessions%rowtype;
  v_open_break_id uuid;
  v_clocked_out_at timestamptz;
  v_duration_seconds bigint;
begin
  select *
  into v_auth
  from public.timekeeping_verify_staff_pin(p_staff_id, p_pin);

  if v_auth.error_code is not null then
    return jsonb_build_object(
      'ok', false,
      'error_code', v_auth.error_code,
      'message', v_auth.error_message
    );
  end if;

  select s.*
  into v_session
  from public.attendance_sessions s
  where s.staff_id = v_auth.verified_staff_id
    and s.clocked_out_at is null
  order by s.clocked_in_at desc, s.id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_NOT_CLOCKED_IN',
      'message', 'You are not currently clocked in.'
    );
  end if;

  select b.id
  into v_open_break_id
  from public.attendance_breaks b
  where b.session_id = v_session.id
    and b.ended_at is null
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_BREAK_ACTIVE',
      'message', 'End your break before clocking out.'
    );
  end if;

  v_clocked_out_at := greatest(clock_timestamp(), v_session.clocked_in_at);

  update public.attendance_sessions s
  set clocked_out_at = v_clocked_out_at
  where s.id = v_session.id
  returning * into v_session;

  v_duration_seconds := greatest(
    0::numeric,
    floor(extract(epoch from (v_session.clocked_out_at - v_session.clocked_in_at)))
  )::bigint;

  return jsonb_build_object(
    'ok', true,
    'staff_id', v_auth.verified_staff_id,
    'staff_name', v_auth.verified_staff_name,
    'session_id', v_session.id,
    'clocked_in_at', v_session.clocked_in_at,
    'clocked_out_at', v_session.clocked_out_at,
    'duration_seconds', v_duration_seconds
  );
end;
$$;

-- =========================================================
-- Owner read model
-- =========================================================

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
    coalesce(break_totals.total_break_seconds, 0::bigint) as total_break_seconds
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
    ) as total_break_seconds
    from public.attendance_breaks b
    where b.session_id = s.id
      and b.ended_at is not null
  ) break_totals on true
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
  measured.session_id,
  measured.staff_id,
  measured.staff_name,
  measured.staff_is_active,
  measured.original_clocked_in_at,
  measured.original_clocked_out_at,
  measured.corrected_clocked_in_at,
  measured.corrected_clocked_out_at,
  measured.effective_clocked_in_at,
  measured.effective_clocked_out_at,
  measured.effective_duration_seconds,
  measured.has_correction,
  measured.latest_correction_reason,
  measured.latest_corrected_at,
  measured.latest_corrected_by,
  measured.session_created_at,
  measured.total_break_seconds,
  greatest(0::bigint, measured.effective_duration_seconds - measured.total_break_seconds) as worked_seconds
from measured;

comment on view public.attendance_effective_sessions is
  'Owner-only attendance history. Effective elapsed time uses the latest correction, completed break rows remain factual, and worked time is effective elapsed minus completed break duration, clamped to zero.';

-- =========================================================
-- RLS and direct-table privileges
-- =========================================================

alter table public.attendance_breaks enable row level security;

drop policy if exists "Owners can read attendance breaks" on public.attendance_breaks;
create policy "Owners can read attendance breaks"
  on public.attendance_breaks
  for select
  to authenticated
  using (public.is_admin());

revoke all on table public.attendance_breaks from public, anon, authenticated;
grant select on public.attendance_breaks to authenticated;

revoke all on table public.attendance_effective_sessions from public, anon, authenticated;
grant select on public.attendance_effective_sessions to authenticated;

-- =========================================================
-- RPC grants
-- =========================================================

revoke all on function public.timekeeping_start_break(uuid, text) from public;
grant execute on function public.timekeeping_start_break(uuid, text) to anon, authenticated;

revoke all on function public.timekeeping_end_break(uuid, text) from public;
grant execute on function public.timekeeping_end_break(uuid, text) to anon, authenticated;

-- Reassert grants on replaced T1 functions.
revoke all on function public.timekeeping_get_staff_status(uuid, text) from public;
grant execute on function public.timekeeping_get_staff_status(uuid, text) to anon, authenticated;

revoke all on function public.timekeeping_clock_out(uuid, text) from public;
grant execute on function public.timekeeping_clock_out(uuid, text) to anon, authenticated;

comment on function public.timekeeping_start_break(uuid, text) is
  'PIN-protected atomic break start using a server timestamp and one-open-break safeguards.';

comment on function public.timekeeping_end_break(uuid, text) is
  'PIN-protected atomic break end using a server timestamp.';

comment on function public.timekeeping_get_staff_status(uuid, text) is
  'PIN-protected immediate clock and break status for one active staff member.';

comment on function public.timekeeping_clock_out(uuid, text) is
  'PIN-protected atomic clock-out that requires any active break to be ended first.';

commit;
