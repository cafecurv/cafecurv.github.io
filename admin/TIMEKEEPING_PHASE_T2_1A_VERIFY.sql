-- CURV Timekeeping T2.1A verification
--
-- Run manually in Supabase SQL Editor only after reviewing and applying:
-- admin/TIMEKEEPING_PHASE_T2_1A_BREAK_TRACKING.sql
--
-- All fixtures are transaction-local. The final ROLLBACK removes them.

begin;

-- =========================================================
-- Structure, RLS, functions, view, and grants
-- =========================================================

do $$
declare
  v_signature text;
  v_function_oid oid;
  v_public_execute boolean;
  v_privilege text;
begin
  if to_regclass('public.attendance_breaks') is null then
    raise exception 'public.attendance_breaks is missing.';
  end if;

  if not exists (
    select 1
    from pg_class c
    where c.oid = 'public.attendance_breaks'::regclass
      and c.relrowsecurity = true
  ) then
    raise exception 'RLS is not enabled on public.attendance_breaks.';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_breaks'
      and c.column_name = 'id'
      and c.data_type = 'uuid'
      and c.is_nullable = 'NO'
      and lower(coalesce(c.column_default, '')) like '%gen_random_uuid%'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_breaks'
      and c.column_name = 'session_id'
      and c.data_type = 'uuid'
      and c.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_breaks'
      and c.column_name = 'started_at'
      and c.data_type = 'timestamp with time zone'
      and c.is_nullable = 'NO'
      and lower(coalesce(c.column_default, '')) like '%now()%'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_breaks'
      and c.column_name = 'ended_at'
      and c.data_type = 'timestamp with time zone'
      and c.is_nullable = 'YES'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_breaks'
      and c.column_name = 'created_at'
      and c.data_type = 'timestamp with time zone'
      and c.is_nullable = 'NO'
      and lower(coalesce(c.column_default, '')) like '%now()%'
  ) then
    raise exception 'attendance_breaks column/type/default verification failed.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.attendance_breaks'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.attendance_sessions'::regclass
      and c.confdeltype = 'r'
  ) then
    raise exception 'attendance_breaks session FK must use ON DELETE RESTRICT.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.attendance_breaks'::regclass
      and c.contype = 'c'
      and lower(pg_get_constraintdef(c.oid)) like '%ended_at%started_at%'
  ) then
    raise exception 'attendance_breaks time-order constraint is missing.';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.attendance_breaks'::regclass
      and idx.relname = 'attendance_breaks_one_open_per_session_idx'
      and i.indisunique = true
      and lower(pg_get_expr(i.indpred, i.indrelid)) like '%ended_at is null%'
  ) then
    raise exception 'Partial unique open-break index is missing or incorrect.';
  end if;

  foreach v_signature in array array[
    'public.timekeeping_start_break(uuid,text)',
    'public.timekeeping_end_break(uuid,text)',
    'public.timekeeping_get_staff_status(uuid,text)',
    'public.timekeeping_clock_out(uuid,text)'
  ]
  loop
    v_function_oid := to_regprocedure(v_signature);

    if v_function_oid is null then
      raise exception 'Required T2.1A function is missing: %.', v_signature;
    end if;

    if not exists (
      select 1
      from pg_proc p
      where p.oid = v_function_oid
        and p.prosecdef = true
        and p.proconfig @> array['search_path=public, pg_temp']
    ) then
      raise exception 'SECURITY DEFINER/search_path verification failed for %.', v_signature;
    end if;

    select exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where p.oid = v_function_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) into v_public_execute;

    if v_public_execute
      or not has_function_privilege('anon', v_function_oid, 'EXECUTE')
      or not has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
    then
      raise exception 'Kiosk RPC grants are incorrect for %.', v_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'attendance_breaks'
      and p.policyname = 'Owners can read attendance breaks'
      and p.roles @> array['authenticated'::name]
      and lower(coalesce(p.qual, '')) like '%is_admin%'
  ) then
    raise exception 'Owner attendance-break SELECT policy is missing or incorrect.';
  end if;

  foreach v_privilege in array array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]
  loop
    if has_table_privilege('anon', 'public.attendance_breaks', v_privilege) then
      raise exception 'anon unexpectedly has % on public.attendance_breaks.', v_privilege;
    end if;
  end loop;

  foreach v_privilege in array array[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]
  loop
    if has_table_privilege('authenticated', 'public.attendance_breaks', v_privilege) then
      raise exception 'authenticated unexpectedly has % on public.attendance_breaks.', v_privilege;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.attendance_breaks', 'SELECT') then
    raise exception 'authenticated owner-read grant is missing on attendance_breaks.';
  end if;

  if to_regclass('public.attendance_effective_sessions') is null
    or not exists (
      select 1
      from pg_class c
      where c.oid = 'public.attendance_effective_sessions'::regclass
        and c.relkind = 'v'
        and c.reloptions @> array['security_invoker=true']
    )
    or not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'attendance_effective_sessions'
        and c.column_name = 'total_break_seconds'
        and c.data_type = 'bigint'
    )
    or not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'attendance_effective_sessions'
        and c.column_name = 'worked_seconds'
        and c.data_type = 'bigint'
    )
  then
    raise exception 'Break-aware owner attendance read model is missing or insecure.';
  end if;

  if lower(pg_get_functiondef('public.timekeeping_start_break(uuid,text)'::regprocedure)) not like '%clock_timestamp()%'
    or lower(pg_get_functiondef('public.timekeeping_end_break(uuid,text)'::regprocedure)) not like '%clock_timestamp()%'
  then
    raise exception 'Break RPCs are not visibly using database server timestamps.';
  end if;
end;
$$;

-- =========================================================
-- Rollback-only lifecycle fixtures
-- =========================================================

do $$
declare
  v_owner_id uuid;
  v_active_staff_id uuid := gen_random_uuid();
  v_inactive_staff_id uuid := gen_random_uuid();
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_result jsonb;
  v_session_id uuid;
  v_second_session_id uuid;
  v_break_id uuid;
  v_first_break_id uuid;
  v_historical_session_id uuid := gen_random_uuid();
  v_base timestamptz := date_trunc('second', clock_timestamp()) - interval '4 hours';
  v_elapsed_seconds bigint;
  v_break_seconds bigint;
  v_worked_seconds bigint;
  v_completed_breaks integer;
  v_open_sessions integer;
  v_attempt_count integer;
  v_wrong_attempt integer;
  v_unique_blocked boolean := false;
begin
  select ap.id
  into v_owner_id
  from public.admin_profiles ap
  where ap.role = 'owner'
  order by ap.created_at nulls last, ap.id
  limit 1;

  if v_owner_id is null then
    raise exception 'T2.1A verification needs one existing CURV owner profile.';
  end if;

  insert into public.staff (
    id, name, pin_hash, is_active, display_order, created_by
  ) values (
    v_active_staff_id,
    'T2.1A Active ' || v_suffix,
    extensions.crypt('1234', extensions.gen_salt('bf', 8)),
    true,
    9100,
    v_owner_id
  ), (
    v_inactive_staff_id,
    'T2.1A Inactive ' || v_suffix,
    extensions.crypt('1234', extensions.gen_salt('bf', 8)),
    false,
    9101,
    v_owner_id
  );

  -- Inactive staff and wrong PINs are rejected through the shared T1 verifier.
  v_result := public.timekeeping_start_break(v_inactive_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_STAFF_UNAVAILABLE' then
    raise exception 'Inactive staff Start Break was not rejected: %', v_result;
  end if;

  v_result := public.timekeeping_end_break(v_inactive_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_STAFF_UNAVAILABLE' then
    raise exception 'Inactive staff End Break was not rejected: %', v_result;
  end if;

  v_result := public.timekeeping_start_break(v_active_staff_id, '9999');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_INVALID_CREDENTIALS' then
    raise exception 'Wrong Start Break PIN was not rejected: %', v_result;
  end if;

  delete from public.timekeeping_pin_attempts a where a.staff_id = v_active_staff_id;

  -- The existing five-attempt lockout still applies to the new RPC path.
  for v_wrong_attempt in 1..5 loop
    v_result := public.timekeeping_start_break(v_active_staff_id, '9999');
    if v_wrong_attempt < 5
      and v_result ->> 'error_code' is distinct from 'TIMEKEEPING_INVALID_CREDENTIALS'
    then
      raise exception 'PIN lockout started too early through Start Break: %', v_result;
    end if;
  end loop;

  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_PIN_LOCKED' then
    raise exception 'Fifth failed Start Break PIN did not activate lockout: %', v_result;
  end if;

  v_result := public.timekeeping_end_break(v_active_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_PIN_LOCKED' then
    raise exception 'Correct PIN bypassed lockout through End Break: %', v_result;
  end if;

  select count(*)::integer into v_attempt_count
  from public.timekeeping_pin_attempts a
  where a.staff_id = v_active_staff_id;

  if v_attempt_count <> 5 then
    raise exception 'Locked break request unexpectedly changed PIN-attempt rows.';
  end if;

  update public.timekeeping_pin_attempts a
  set attempted_at = clock_timestamp() - interval '16 minutes'
  where a.staff_id = v_active_staff_id;

  -- Break actions require an open attendance session.
  v_result := public.timekeeping_start_break(v_active_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_NOT_CLOCKED_IN' then
    raise exception 'Start Break without Clock In was not rejected: %', v_result;
  end if;

  v_result := public.timekeeping_end_break(v_active_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_NOT_CLOCKED_IN' then
    raise exception 'End Break without Clock In was not rejected: %', v_result;
  end if;

  -- Existing Clock In remains valid.
  v_result := public.timekeeping_clock_in(v_active_staff_id, '1234');
  v_session_id := (v_result ->> 'session_id')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true or v_session_id is null then
    raise exception 'Clock In regression verification failed: %', v_result;
  end if;

  v_result := public.timekeeping_start_break(v_active_staff_id, '1234');
  v_break_id := (v_result ->> 'break_id')::uuid;
  v_first_break_id := v_break_id;
  if (v_result ->> 'ok')::boolean is distinct from true
    or v_break_id is null
    or (v_result ->> 'started_at')::timestamptz is null
  then
    raise exception 'Valid Start Break failed: %', v_result;
  end if;

  v_result := public.timekeeping_get_staff_status(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true
    or (v_result ->> 'is_clocked_in')::boolean is distinct from true
    or (v_result ->> 'is_on_break')::boolean is distinct from true
    or (v_result ->> 'break_started_at')::timestamptz is null
  then
    raise exception 'Status did not expose the active break after valid PIN: %', v_result;
  end if;

  v_result := public.timekeeping_start_break(v_active_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_ALREADY_ON_BREAK' then
    raise exception 'Second Start Break was not rejected: %', v_result;
  end if;

  v_result := public.timekeeping_clock_out(v_active_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_BREAK_ACTIVE'
    or v_result ->> 'message' is distinct from 'End your break before clocking out.'
  then
    raise exception 'Clock Out did not reject an active break correctly: %', v_result;
  end if;

  select count(*)::integer into v_open_sessions
  from public.attendance_sessions s
  where s.id = v_session_id and s.clocked_out_at is null;

  if v_open_sessions <> 1 then
    raise exception 'Rejected Clock Out changed the open attendance session.';
  end if;

  begin
    insert into public.attendance_breaks (session_id)
    values (v_session_id);
  exception when unique_violation then
    v_unique_blocked := true;
  end;

  if not v_unique_blocked then
    raise exception 'Partial unique index allowed two open breaks for one session.';
  end if;

  v_result := public.timekeeping_end_break(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true
    or (v_result ->> 'break_id')::uuid is distinct from v_break_id
    or (v_result ->> 'ended_at')::timestamptz is null
  then
    raise exception 'Valid End Break failed: %', v_result;
  end if;

  if not exists (
    select 1
    from public.attendance_breaks b
    where b.id = v_break_id
      and b.ended_at is not null
      and b.ended_at >= b.started_at
  ) then
    raise exception 'End Break did not close the break row safely.';
  end if;

  v_result := public.timekeeping_get_staff_status(v_active_staff_id, '1234');
  if (v_result ->> 'is_on_break')::boolean is distinct from false
    or v_result ->> 'break_started_at' is not null
  then
    raise exception 'Status still reports a break after End Break: %', v_result;
  end if;

  v_result := public.timekeeping_end_break(v_active_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_NOT_ON_BREAK' then
    raise exception 'Second End Break was not rejected: %', v_result;
  end if;

  -- A second completed break in the same shift is preserved as another row.
  v_result := public.timekeeping_start_break(v_active_staff_id, '1234');
  v_break_id := (v_result ->> 'break_id')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true or v_break_id is null then
    raise exception 'Second break Start failed: %', v_result;
  end if;

  v_result := public.timekeeping_end_break(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Second break End failed: %', v_result;
  end if;

  select count(*)::integer into v_completed_breaks
  from public.attendance_breaks b
  where b.session_id = v_session_id and b.ended_at is not null;

  if v_completed_breaks <> 2 then
    raise exception 'Multiple completed breaks were not preserved.';
  end if;

  v_result := public.timekeeping_clock_out(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Clock Out after End Break failed: %', v_result;
  end if;

  select
    v.effective_duration_seconds,
    v.total_break_seconds,
    v.worked_seconds
  into v_elapsed_seconds, v_break_seconds, v_worked_seconds
  from public.attendance_effective_sessions v
  where v.session_id = v_session_id;

  if v_elapsed_seconds < v_break_seconds
    or v_worked_seconds <> greatest(0::bigint, v_elapsed_seconds - v_break_seconds)
  then
    raise exception 'Lifecycle duration/worked-time calculation failed.';
  end if;

  -- Completed break history remains after a normal second shift.
  v_result := public.timekeeping_clock_in(v_active_staff_id, '1234');
  v_second_session_id := (v_result ->> 'session_id')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true
    or v_second_session_id is null
    or v_second_session_id = v_session_id
  then
    raise exception 'Second-shift Clock In regression verification failed: %', v_result;
  end if;

  v_result := public.timekeeping_clock_out(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Second-shift Clock Out regression verification failed: %', v_result;
  end if;

  if not exists (
    select 1
    from public.attendance_breaks b
    where b.id = v_first_break_id
      and b.session_id = v_session_id
      and b.ended_at is not null
  ) then
    raise exception 'Historical break row was not preserved across shifts.';
  end if;

  -- Exact read-model arithmetic and correction interaction use a historical
  -- closed-session fixture. Break rows stay factual when effective times move.
  insert into public.attendance_sessions (
    id, staff_id, clocked_in_at, clocked_out_at, created_at
  ) values (
    v_historical_session_id,
    v_active_staff_id,
    v_base,
    v_base + interval '2 hours',
    v_base
  );

  insert into public.attendance_breaks (session_id, started_at, ended_at, created_at)
  values
    (v_historical_session_id, v_base + interval '30 minutes', v_base + interval '45 minutes', v_base),
    (v_historical_session_id, v_base + interval '75 minutes', v_base + interval '90 minutes', v_base);

  select
    v.effective_duration_seconds,
    v.total_break_seconds,
    v.worked_seconds
  into v_elapsed_seconds, v_break_seconds, v_worked_seconds
  from public.attendance_effective_sessions v
  where v.session_id = v_historical_session_id;

  if v_elapsed_seconds <> 7200 or v_break_seconds <> 1800 or v_worked_seconds <> 5400 then
    raise exception 'Exact historical break arithmetic failed: elapsed %, break %, worked %.',
      v_elapsed_seconds, v_break_seconds, v_worked_seconds;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  v_result := public.timekeeping_correct_session(
    v_historical_session_id,
    v_base - interval '15 minutes',
    null,
    'T2.1A correction/read-model verification'
  );

  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Existing correction RPC failed during T2.1A verification: %', v_result;
  end if;

  select
    v.effective_duration_seconds,
    v.total_break_seconds,
    v.worked_seconds
  into v_elapsed_seconds, v_break_seconds, v_worked_seconds
  from public.attendance_effective_sessions v
  where v.session_id = v_historical_session_id;

  if v_elapsed_seconds <> 8100 or v_break_seconds <> 1800 or v_worked_seconds <> 6300 then
    raise exception 'Correction/break read-model interaction failed: elapsed %, break %, worked %.',
      v_elapsed_seconds, v_break_seconds, v_worked_seconds;
  end if;

  if (select count(*) from public.attendance_breaks b where b.session_id = v_historical_session_id) <> 2 then
    raise exception 'Correction unexpectedly mutated factual break history.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);

  raise notice 'T2.1A verification passed: break structure, RLS/grants, PIN and lockout behavior, break lifecycle, clock-out safeguard, multiple breaks/shifts, history, duration math, and correction-aware owner reporting are correct. Final ROLLBACK follows.';
end;
$$;

rollback;
