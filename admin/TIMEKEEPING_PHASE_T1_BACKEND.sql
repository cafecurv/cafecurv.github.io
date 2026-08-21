-- CURV Timekeeping T1
-- Backend foundation: staff, attendance sessions, audited corrections, PIN
-- throttling, kiosk RPCs, and the owner attendance read model.
--
-- Draft migration only. Review before running manually in Supabase SQL Editor.
-- This migration creates no staff seed and no predictable production PIN.

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- Core tables
-- =========================================================

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin_hash text not null,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint staff_name_valid check (
    name = btrim(name)
    and name <> ''
    and char_length(name) <= 120
  ),
  constraint staff_pin_hash_valid check (
    pin_hash = btrim(pin_hash)
    and pin_hash <> ''
    and char_length(pin_hash) <= 255
  ),
  constraint staff_display_order_nonnegative check (display_order >= 0)
);

comment on table public.staff is
  'Timekeeping staff directory. Staff are not Supabase Auth users; pin_hash is server-generated and never part of a public result.';

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  clocked_in_at timestamptz not null default now(),
  clocked_out_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_sessions_time_order_valid check (
    clocked_out_at is null or clocked_out_at >= clocked_in_at
  )
);

comment on table public.attendance_sessions is
  'Server-timestamped attendance records. Closed original timestamps are immutable; owner corrections are separate audit rows.';

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,
  corrected_clocked_in_at timestamptz,
  corrected_clocked_out_at timestamptz,
  reason text not null,
  corrected_by uuid not null references auth.users(id) on delete restrict,
  corrected_at timestamptz not null default now(),
  constraint attendance_corrections_has_change check (
    corrected_clocked_in_at is not null or corrected_clocked_out_at is not null
  ),
  constraint attendance_corrections_reason_valid check (
    reason = btrim(reason)
    and reason <> ''
    and char_length(reason) <= 500
  )
);

comment on table public.attendance_corrections is
  'Append-only owner correction audit. The latest row per session supplies corrected fields; NULL fields fall back to original session values.';

-- This table stores only the current failed-attempt streak. A successful PIN
-- verification deletes the staff member's failures. Avoiding a success log
-- keeps the throttle small and avoids storing unnecessary kiosk activity.
create table if not exists public.timekeeping_pin_attempts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

comment on table public.timekeeping_pin_attempts is
  'Internal failed-PIN throttle state. No anon or authenticated direct access.';

-- =========================================================
-- Constraints and supporting indexes
-- =========================================================

create unique index if not exists attendance_sessions_one_open_per_staff_idx
  on public.attendance_sessions (staff_id)
  where clocked_out_at is null;

create index if not exists attendance_sessions_staff_clocked_in_idx
  on public.attendance_sessions (staff_id, clocked_in_at desc, id);

create index if not exists attendance_corrections_session_latest_idx
  on public.attendance_corrections (session_id, corrected_at desc, id desc);

create index if not exists timekeeping_pin_attempts_staff_recent_idx
  on public.timekeeping_pin_attempts (staff_id, attempted_at desc, id);

-- PostgreSQL generated columns require immutable expressions. Duration based
-- on timestamptz subtraction is therefore calculated in RPC/view reads rather
-- than forced into a stored generated column.

-- =========================================================
-- Original session immutability
-- =========================================================

create or replace function public.timekeeping_enforce_session_immutability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.staff_id is distinct from old.staff_id
    or new.clocked_in_at is distinct from old.clocked_in_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Original attendance session identity and clock-in time cannot be changed.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_SESSION_IMMUTABLE';
  end if;

  if old.clocked_out_at is not null
    and new.clocked_out_at is distinct from old.clocked_out_at
  then
    raise exception 'Closed attendance session timestamps cannot be changed.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_SESSION_IMMUTABLE';
  end if;

  if old.clocked_out_at is null and new.clocked_out_at is null then
    return new;
  end if;

  if old.clocked_out_at is null and new.clocked_out_at is not null then
    return new;
  end if;

  raise exception 'Attendance sessions cannot be reopened.'
    using errcode = 'P0001',
      detail = 'TIMEKEEPING_SESSION_IMMUTABLE';
end;
$$;

revoke all on function public.timekeeping_enforce_session_immutability() from public;
revoke execute on function public.timekeeping_enforce_session_immutability() from anon;
revoke execute on function public.timekeeping_enforce_session_immutability() from authenticated;

drop trigger if exists enforce_attendance_session_immutability on public.attendance_sessions;
create trigger enforce_attendance_session_immutability
before update on public.attendance_sessions
for each row
execute function public.timekeeping_enforce_session_immutability();

-- =========================================================
-- Internal PIN verifier and throttle
-- =========================================================
-- Kiosk failures are returned as JSON by the four public kiosk RPCs rather
-- than raised as exceptions. Raising after recording a wrong PIN would roll
-- the attempt back with the failed statement and defeat server-side lockout.

create or replace function public.timekeeping_verify_staff_pin(
  p_staff_id uuid,
  p_pin text
) returns table (
  verified_staff_id uuid,
  verified_staff_name text,
  error_code text,
  error_message text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff public.staff%rowtype;
  v_now timestamptz := clock_timestamp();
  v_latest_failure timestamptz;
  v_recent_failures integer := 0;
  v_pin_matches boolean := false;
begin
  if p_staff_id is null then
    return query select
      null::uuid,
      null::text,
      'TIMEKEEPING_STAFF_UNAVAILABLE'::text,
      'That staff selection is unavailable. Refresh and try again.'::text;
    return;
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return query select
      null::uuid,
      null::text,
      'TIMEKEEPING_INVALID_CREDENTIALS'::text,
      'Enter the correct 4-digit PIN.'::text;
    return;
  end if;

  -- The staff row lock serializes status/clock actions and failed-attempt
  -- accounting for one staff member without blocking other staff members.
  select s.*
  into v_staff
  from public.staff s
  where s.id = p_staff_id
    and s.is_active = true
  for update;

  if not found then
    return query select
      null::uuid,
      null::text,
      'TIMEKEEPING_STAFF_UNAVAILABLE'::text,
      'That staff selection is unavailable. Refresh and try again.'::text;
    return;
  end if;

  delete from public.timekeeping_pin_attempts a
  where a.staff_id = v_staff.id
    and a.attempted_at < v_now - interval '30 minutes';

  select max(a.attempted_at)
  into v_latest_failure
  from public.timekeeping_pin_attempts a
  where a.staff_id = v_staff.id;

  if v_latest_failure is not null then
    select count(*)::integer
    into v_recent_failures
    from public.timekeeping_pin_attempts a
    where a.staff_id = v_staff.id
      and a.attempted_at >= v_latest_failure - interval '10 minutes'
      and a.attempted_at <= v_latest_failure;

    if v_recent_failures >= 5
      and v_now < v_latest_failure + interval '15 minutes'
    then
      return query select
        null::uuid,
        null::text,
        'TIMEKEEPING_PIN_LOCKED'::text,
        'Too many incorrect attempts. Try again in 15 minutes.'::text;
      return;
    end if;
  end if;

  begin
    v_pin_matches := coalesce(
      extensions.crypt(p_pin, v_staff.pin_hash) = v_staff.pin_hash,
      false
    );
  exception when others then
    -- A malformed stored hash must fail closed without exposing hash details.
    v_pin_matches := false;
  end;

  if not v_pin_matches then
    insert into public.timekeeping_pin_attempts (staff_id, attempted_at)
    values (v_staff.id, v_now);

    select count(*)::integer
    into v_recent_failures
    from public.timekeeping_pin_attempts a
    where a.staff_id = v_staff.id
      and a.attempted_at >= v_now - interval '10 minutes'
      and a.attempted_at <= v_now;

    if v_recent_failures >= 5 then
      return query select
        null::uuid,
        null::text,
        'TIMEKEEPING_PIN_LOCKED'::text,
        'Too many incorrect attempts. Try again in 15 minutes.'::text;
      return;
    end if;

    return query select
      null::uuid,
      null::text,
      'TIMEKEEPING_INVALID_CREDENTIALS'::text,
      'Enter the correct 4-digit PIN.'::text;
    return;
  end if;

  delete from public.timekeeping_pin_attempts a
  where a.staff_id = v_staff.id;

  return query select
    v_staff.id,
    v_staff.name,
    null::text,
    null::text;
end;
$$;

revoke all on function public.timekeeping_verify_staff_pin(uuid, text) from public;
revoke execute on function public.timekeeping_verify_staff_pin(uuid, text) from anon;
revoke execute on function public.timekeeping_verify_staff_pin(uuid, text) from authenticated;

-- =========================================================
-- Kiosk RPC 1: active staff list
-- =========================================================

create or replace function public.timekeeping_list_active_staff()
returns table (
  id uuid,
  name text,
  display_order integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.name, s.display_order
  from public.staff s
  where s.is_active = true
  order by s.display_order, lower(btrim(s.name)), s.id;
$$;

-- =========================================================
-- Kiosk RPC 2: immediate staff status
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

  return jsonb_build_object(
    'ok', true,
    'staff_id', v_auth.verified_staff_id,
    'staff_name', v_auth.verified_staff_name,
    'is_clocked_in', found,
    'clocked_in_at', case when found then v_session.clocked_in_at else null end,
    'session_id', case when found then v_session.id else null end
  );
end;
$$;

-- =========================================================
-- Kiosk RPC 3: clock in
-- =========================================================

create or replace function public.timekeeping_clock_in(
  p_staff_id uuid,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth record;
  v_existing_session_id uuid;
  v_session public.attendance_sessions%rowtype;
  v_now timestamptz;
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

  select s.id
  into v_existing_session_id
  from public.attendance_sessions s
  where s.staff_id = v_auth.verified_staff_id
    and s.clocked_out_at is null
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_ALREADY_CLOCKED_IN',
      'message', 'You are already clocked in.'
    );
  end if;

  v_now := clock_timestamp();

  begin
    insert into public.attendance_sessions (staff_id, clocked_in_at)
    values (v_auth.verified_staff_id, v_now)
    returning * into v_session;
  exception when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'TIMEKEEPING_ALREADY_CLOCKED_IN',
      'message', 'You are already clocked in.'
    );
  end;

  return jsonb_build_object(
    'ok', true,
    'staff_id', v_auth.verified_staff_id,
    'staff_name', v_auth.verified_staff_name,
    'session_id', v_session.id,
    'clocked_in_at', v_session.clocked_in_at
  );
end;
$$;

-- =========================================================
-- Kiosk RPC 4: clock out
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
-- Owner RPC 5: append a correction to a closed session
-- =========================================================

create or replace function public.timekeeping_correct_session(
  p_session_id uuid,
  p_corrected_in timestamptz,
  p_corrected_out timestamptz,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.attendance_sessions%rowtype;
  v_correction public.attendance_corrections%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_effective_in timestamptz;
  v_effective_out timestamptz;
  v_now timestamptz := clock_timestamp();
  v_duration_seconds bigint;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Only a signed-in CURV owner can correct attendance.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_FORBIDDEN',
        hint = 'Sign in with an approved CURV owner account.';
  end if;

  if p_session_id is null then
    raise exception 'Choose a closed attendance session to correct.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_INVALID_CORRECTION';
  end if;

  if v_reason = '' or char_length(v_reason) > 500 then
    raise exception 'Correction reason is required and must be 500 characters or fewer.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_INVALID_CORRECTION';
  end if;

  if p_corrected_in is null and p_corrected_out is null then
    raise exception 'Correct at least one attendance timestamp.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_INVALID_CORRECTION';
  end if;

  select s.*
  into v_session
  from public.attendance_sessions s
  where s.id = p_session_id
  for update;

  if not found or v_session.clocked_out_at is null then
    raise exception 'Only closed attendance sessions can be corrected in T1.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_INVALID_CORRECTION',
        hint = 'Use the normal clock-out flow for an open attendance session.';
  end if;

  -- Latest correction wins as one complete correction record. A NULL field in
  -- that newest row deliberately falls back to the immutable original field.
  v_effective_in := coalesce(p_corrected_in, v_session.clocked_in_at);
  v_effective_out := coalesce(p_corrected_out, v_session.clocked_out_at);

  if v_effective_in > v_now
    or v_effective_out > v_now
    or v_effective_out < v_effective_in
  then
    raise exception 'Corrected attendance times must be in the past and clock-out cannot precede clock-in.'
      using errcode = 'P0001',
        detail = 'TIMEKEEPING_INVALID_CORRECTION';
  end if;

  insert into public.attendance_corrections (
    session_id,
    corrected_clocked_in_at,
    corrected_clocked_out_at,
    reason,
    corrected_by,
    corrected_at
  ) values (
    v_session.id,
    p_corrected_in,
    p_corrected_out,
    v_reason,
    v_actor,
    v_now
  )
  returning * into v_correction;

  v_duration_seconds := greatest(
    0::numeric,
    floor(extract(epoch from (v_effective_out - v_effective_in)))
  )::bigint;

  return jsonb_build_object(
    'ok', true,
    'correction_id', v_correction.id,
    'session_id', v_session.id,
    'original_clocked_in_at', v_session.clocked_in_at,
    'original_clocked_out_at', v_session.clocked_out_at,
    'effective_clocked_in_at', v_effective_in,
    'effective_clocked_out_at', v_effective_out,
    'duration_seconds', v_duration_seconds,
    'reason', v_correction.reason,
    'corrected_at', v_correction.corrected_at,
    'corrected_by', v_correction.corrected_by
  );
end;
$$;

-- =========================================================
-- Owner read model
-- =========================================================

create or replace view public.attendance_effective_sessions
with (security_invoker = true)
as
select
  effective.session_id,
  effective.staff_id,
  effective.staff_name,
  effective.staff_is_active,
  effective.original_clocked_in_at,
  effective.original_clocked_out_at,
  effective.corrected_clocked_in_at,
  effective.corrected_clocked_out_at,
  effective.effective_clocked_in_at,
  effective.effective_clocked_out_at,
  greatest(
    0::numeric,
    floor(extract(epoch from (
      coalesce(effective.effective_clocked_out_at, statement_timestamp())
      - effective.effective_clocked_in_at
    )))
  )::bigint as effective_duration_seconds,
  effective.has_correction,
  effective.latest_correction_reason,
  effective.latest_corrected_at,
  effective.latest_corrected_by,
  effective.session_created_at
from (
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
    s.created_at as session_created_at
  from public.attendance_sessions s
  join public.staff st on st.id = s.staff_id
  left join lateral (
    select c.*
    from public.attendance_corrections c
    where c.session_id = s.id
    order by c.corrected_at desc, c.id desc
    limit 1
  ) latest on true
) effective;

comment on view public.attendance_effective_sessions is
  'Owner-only attendance history. Latest correction wins; NULL corrected fields fall back to immutable original session timestamps.';

-- =========================================================
-- RLS and direct-table privileges
-- =========================================================

alter table public.staff enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.timekeeping_pin_attempts enable row level security;

drop policy if exists "Owners can read timekeeping staff" on public.staff;
create policy "Owners can read timekeeping staff"
  on public.staff
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can read attendance sessions" on public.attendance_sessions;
create policy "Owners can read attendance sessions"
  on public.attendance_sessions
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Owners can read attendance corrections" on public.attendance_corrections;
create policy "Owners can read attendance corrections"
  on public.attendance_corrections
  for select
  to authenticated
  using (public.is_admin());

-- No policy is created for timekeeping_pin_attempts. It is internal to the
-- SECURITY DEFINER verifier and remains unreadable even to browser admins.

revoke all on table public.staff from public, anon, authenticated;
revoke all on table public.attendance_sessions from public, anon, authenticated;
revoke all on table public.attendance_corrections from public, anon, authenticated;
revoke all on table public.timekeeping_pin_attempts from public, anon, authenticated;

grant select (
  id,
  name,
  is_active,
  display_order,
  created_at,
  created_by
) on public.staff to authenticated;

grant select on public.attendance_sessions to authenticated;
grant select on public.attendance_corrections to authenticated;

revoke all on table public.attendance_effective_sessions from public, anon, authenticated;
grant select on public.attendance_effective_sessions to authenticated;

-- =========================================================
-- RPC grants
-- =========================================================

revoke all on function public.timekeeping_list_active_staff() from public;
grant execute on function public.timekeeping_list_active_staff() to anon, authenticated;

revoke all on function public.timekeeping_get_staff_status(uuid, text) from public;
grant execute on function public.timekeeping_get_staff_status(uuid, text) to anon, authenticated;

revoke all on function public.timekeeping_clock_in(uuid, text) from public;
grant execute on function public.timekeeping_clock_in(uuid, text) to anon, authenticated;

revoke all on function public.timekeeping_clock_out(uuid, text) from public;
grant execute on function public.timekeeping_clock_out(uuid, text) to anon, authenticated;

revoke all on function public.timekeeping_correct_session(uuid, timestamptz, timestamptz, text) from public;
revoke execute on function public.timekeeping_correct_session(uuid, timestamptz, timestamptz, text) from anon;
grant execute on function public.timekeeping_correct_session(uuid, timestamptz, timestamptz, text) to authenticated;

comment on function public.timekeeping_list_active_staff() is
  'Public-safe kiosk staff picker. Returns active staff id, name, and display order only.';

comment on function public.timekeeping_get_staff_status(uuid, text) is
  'PIN-protected immediate status for one active staff member. No persistent staff session is created.';

comment on function public.timekeeping_clock_in(uuid, text) is
  'PIN-protected atomic clock-in using a server timestamp and one-open-session safeguard.';

comment on function public.timekeeping_clock_out(uuid, text) is
  'PIN-protected atomic clock-out using a server timestamp and computed duration.';

comment on function public.timekeeping_correct_session(uuid, timestamptz, timestamptz, text) is
  'Owner-only append-only correction for a closed attendance session. Original timestamps remain unchanged.';

commit;
