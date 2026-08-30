-- CURV Timekeeping T3C verification
--
-- Run manually only after reviewing and applying:
-- admin/TIMEKEEPING_PHASE_T3C_ADMIN_CLOSE_SHIFT.sql
--
-- All fixtures are transaction-local. The final ROLLBACK is required.

begin;

-- =========================================================
-- Structure, RLS, function security, and grants
-- =========================================================

do $$
declare
  v_function_oid oid := to_regprocedure(
    'public.timekeeping_admin_close_open_shift(uuid,timestamp with time zone,text,timestamp with time zone)'
  );
  v_function_body text;
  v_privilege text;
  v_public_execute boolean;
begin
  if to_regclass('public.attendance_admin_closures') is null then
    raise exception 'public.attendance_admin_closures is missing.';
  end if;

  if not exists (
    select 1 from pg_class c
    where c.oid = 'public.attendance_admin_closures'::regclass and c.relrowsecurity = true
  ) then
    raise exception 'RLS is not enabled on attendance_admin_closures.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.attendance_admin_closures'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) like '%session_id%'
  ) then
    raise exception 'One-admin-closure-per-session constraint is missing.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.attendance_admin_closures'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.attendance_sessions'::regclass
      and c.confdeltype = 'r'
  ) then
    raise exception 'Admin closure session FK must use ON DELETE RESTRICT.';
  end if;

  if v_function_oid is null then
    raise exception 'timekeeping_admin_close_open_shift RPC is missing.';
  end if;

  select pg_get_functiondef(v_function_oid) into v_function_body;
  if not exists (
    select 1 from pg_proc p
    where p.oid = v_function_oid
      and p.prosecdef = true
      and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'T3C RPC must be SECURITY DEFINER with the reviewed search_path.';
  end if;

  if lower(v_function_body) not like '%auth.uid()%'
    or lower(v_function_body) not like '%public.is_admin()%'
    or lower(v_function_body) not like '%for update%'
    or lower(v_function_body) not like '%timekeeping_forbidden%'
    or lower(v_function_body) not like '%timekeeping_shift_already_closed%'
    or lower(v_function_body) not like '%timekeeping_open_break_active%'
  then
    raise exception 'T3C RPC owner guard, locking, or controlled error contract is incomplete.';
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
    or has_function_privilege('anon', v_function_oid, 'EXECUTE')
    or not has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
  then
    raise exception 'T3C RPC execute grants are incorrect.';
  end if;

  foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  loop
    if has_table_privilege('anon', 'public.attendance_admin_closures', v_privilege) then
      raise exception 'anon unexpectedly has % on attendance_admin_closures.', v_privilege;
    end if;
  end loop;

  foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  loop
    if has_table_privilege('authenticated', 'public.attendance_admin_closures', v_privilege) then
      raise exception 'authenticated unexpectedly has direct % on attendance_admin_closures.', v_privilege;
    end if;
  end loop;

  if not has_column_privilege('authenticated', 'public.attendance_admin_closures', 'reason', 'SELECT')
    or not has_column_privilege('authenticated', 'public.attendance_admin_closures', 'session_id', 'SELECT')
    or has_column_privilege('authenticated', 'public.attendance_admin_closures', 'closed_by', 'SELECT')
  then
    raise exception 'Safe owner-read column grants are incorrect on attendance_admin_closures.';
  end if;

  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'attendance_admin_closures'
      and p.cmd = 'SELECT'
      and p.roles @> array['authenticated'::name]
      and lower(p.qual) like '%is_admin()%'
  ) then
    raise exception 'Owner-only admin-closure SELECT policy is missing.';
  end if;

  if to_regclass('public.attendance_effective_sessions') is null
    or not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'attendance_effective_sessions'
        and c.column_name = 'was_admin_closed'
    )
    or not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'attendance_effective_sessions'
        and c.column_name = 'admin_close_reason'
    )
  then
    raise exception 'T3C owner read-model fields are missing.';
  end if;

  if exists (
    with expected(ordinal_position, column_name, udt_name) as (
      values
        (1, 'session_id', 'uuid'),
        (2, 'staff_id', 'uuid'),
        (3, 'staff_name', 'text'),
        (4, 'staff_is_active', 'bool'),
        (5, 'original_clocked_in_at', 'timestamptz'),
        (6, 'original_clocked_out_at', 'timestamptz'),
        (7, 'corrected_clocked_in_at', 'timestamptz'),
        (8, 'corrected_clocked_out_at', 'timestamptz'),
        (9, 'effective_clocked_in_at', 'timestamptz'),
        (10, 'effective_clocked_out_at', 'timestamptz'),
        (11, 'effective_duration_seconds', 'int8'),
        (12, 'has_correction', 'bool'),
        (13, 'latest_correction_reason', 'text'),
        (14, 'latest_corrected_at', 'timestamptz'),
        (15, 'latest_corrected_by', 'uuid'),
        (16, 'session_created_at', 'timestamptz'),
        (17, 'total_break_seconds', 'int8'),
        (18, 'worked_seconds', 'int8'),
        (19, 'was_admin_closed', 'bool'),
        (20, 'admin_close_reason', 'text'),
        (21, 'admin_closed_at', 'timestamptz'),
        (22, 'admin_had_open_break', 'bool'),
        (23, 'admin_open_break_closed_at', 'timestamptz')
    )
    select 1
    from expected e
    left join information_schema.columns c
      on c.table_schema = 'public'
      and c.table_name = 'attendance_effective_sessions'
      and c.ordinal_position = e.ordinal_position
    where c.column_name is distinct from e.column_name
       or c.udt_name is distinct from e.udt_name
  ) or (
    select count(*)
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_effective_sessions'
  ) <> 23
  then
    raise exception 'attendance_effective_sessions column order or SQL type contract changed.';
  end if;

  if has_table_privilege('anon', 'public.attendance_effective_sessions', 'SELECT')
    or not has_table_privilege('authenticated', 'public.attendance_effective_sessions', 'SELECT')
  then
    raise exception 'Attendance effective-view grants are incorrect.';
  end if;
end;
$$;

-- =========================================================
-- Rollback-only owner, closure, break, correction, and kiosk fixtures
-- =========================================================

do $$
declare
  v_owner_id uuid;
  v_nonowner_id uuid := gen_random_uuid();
  v_staff_id uuid := gen_random_uuid();
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_session_id uuid;
  v_break_session_id uuid;
  v_closed_session_id uuid;
  v_normal_session_id uuid;
  v_break_id uuid;
  v_result jsonb;
  v_error_detail text;
  v_out timestamptz;
  v_break_end timestamptz;
  v_blocked boolean;
  v_audit_count integer;
  v_worked bigint;
  v_expected_worked bigint;
begin
  select ap.id into v_owner_id
  from public.admin_profiles ap
  where ap.role = 'owner'
  order by ap.created_at nulls last, ap.id
  limit 1;

  if v_owner_id is null then
    raise exception 'T3C verification needs one existing CURV owner profile.';
  end if;

  insert into public.staff (id, name, pin_hash, is_active, display_order, created_by)
  values (
    v_staff_id,
    'T3C Verify ' || v_suffix,
    extensions.crypt('7391', extensions.gen_salt('bf')),
    true,
    2147483000,
    v_owner_id
  );

  -- Runtime owner guard is authoritative even though authenticated receives EXECUTE.
  perform set_config('request.jwt.claim.sub', v_nonowner_id::text, true);
  v_blocked := false;
  begin
    perform public.timekeeping_admin_close_open_shift(gen_random_uuid(), clock_timestamp(), 'Forbidden test', null);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_blocked := v_error_detail = 'TIMEKEEPING_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'Non-owner T3C RPC call was not blocked.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- Nonexistent sessions return the controlled invalid-state code.
  v_blocked := false;
  begin
    perform public.timekeeping_admin_close_open_shift(gen_random_uuid(), clock_timestamp(), 'Missing session', null);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_blocked := v_error_detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
  end;
  if not v_blocked then raise exception 'Nonexistent session was not rejected safely.'; end if;

  insert into public.attendance_sessions (staff_id, clocked_in_at)
  values (v_staff_id, clock_timestamp() - interval '4 hours')
  returning id into v_session_id;

  foreach v_error_detail in array array['blank_reason', 'future_out', 'before_in']
  loop
    v_blocked := false;
    begin
      if v_error_detail = 'blank_reason' then
        perform public.timekeeping_admin_close_open_shift(v_session_id, clock_timestamp() - interval '1 hour', '   ', null);
      elsif v_error_detail = 'future_out' then
        perform public.timekeeping_admin_close_open_shift(v_session_id, clock_timestamp() + interval '1 hour', 'Future test', null);
      else
        perform public.timekeeping_admin_close_open_shift(v_session_id, clock_timestamp() - interval '5 hours', 'Order test', null);
      end if;
    exception when others then
      get stacked diagnostics v_error_detail = pg_exception_detail;
      v_blocked := v_error_detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
    end;
    if not v_blocked then raise exception 'T3C invalid input case was not rejected.'; end if;
  end loop;

  v_out := clock_timestamp() - interval '1 hour';
  v_result := public.timekeeping_admin_close_open_shift(v_session_id, v_out, 'Forgot to clock out', null);
  if (v_result ->> 'ok')::boolean is distinct from true
    or (v_result ->> 'admin_closed')::boolean is distinct from true
    or (v_result ->> 'break_closed')::boolean is distinct from false
    or v_result ? 'closed_by'
    or (select s.clocked_out_at from public.attendance_sessions s where s.id = v_session_id) is distinct from v_out
  then
    raise exception 'Normal open-shift administrative closure failed: %', v_result;
  end if;

  select count(*)::integer into v_audit_count
  from public.attendance_admin_closures c
  where c.session_id = v_session_id
    and c.closed_by = v_owner_id
    and c.reason = 'Forgot to clock out'
    and c.had_open_break = false;
  if v_audit_count <> 1 then raise exception 'Normal closure audit row is incorrect.'; end if;

  v_blocked := false;
  begin
    perform public.timekeeping_admin_close_open_shift(v_session_id, v_out, 'Duplicate', null);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_blocked := v_error_detail = 'TIMEKEEPING_SHIFT_ALREADY_CLOSED';
  end;
  select count(*)::integer into v_audit_count from public.attendance_admin_closures c where c.session_id = v_session_id;
  if not v_blocked or v_audit_count <> 1 then
    raise exception 'Double administrative closure was not rejected without duplication.';
  end if;

  -- Closing releases the one-open-session constraint so kiosk Clock In works again.
  v_result := public.timekeeping_clock_in(v_staff_id, '7391');
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Staff could not clock in after owner closure: %', v_result;
  end if;
  v_normal_session_id := (v_result ->> 'session_id')::uuid;
  v_result := public.timekeeping_clock_out(v_staff_id, '7391');
  if (v_result ->> 'ok')::boolean is distinct from true
    or exists (select 1 from public.attendance_admin_closures c where c.session_id = v_normal_session_id)
  then
    raise exception 'Normal kiosk clock-out failed or created an owner audit: %', v_result;
  end if;

  -- A pre-closed session is stale and must not gain a closure audit.
  insert into public.attendance_sessions (staff_id, clocked_in_at, clocked_out_at)
  values (v_staff_id, clock_timestamp() - interval '6 hours', clock_timestamp() - interval '5 hours')
  returning id into v_closed_session_id;
  v_blocked := false;
  begin
    perform public.timekeeping_admin_close_open_shift(v_closed_session_id, clock_timestamp() - interval '5 hours', 'Stale form', null);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_blocked := v_error_detail = 'TIMEKEEPING_SHIFT_ALREADY_CLOSED';
  end;
  if not v_blocked or exists (select 1 from public.attendance_admin_closures c where c.session_id = v_closed_session_id) then
    raise exception 'Pre-closed shift stale-state behavior failed.';
  end if;

  -- Open breaks require an explicit factual end timestamp.
  insert into public.attendance_sessions (staff_id, clocked_in_at)
  values (v_staff_id, clock_timestamp() - interval '4 hours')
  returning id into v_break_session_id;
  insert into public.attendance_breaks (session_id, started_at)
  values (v_break_session_id, clock_timestamp() - interval '3 hours')
  returning id into v_break_id;
  v_out := clock_timestamp() - interval '1 hour';
  v_break_end := clock_timestamp() - interval '2 hours';

  v_blocked := false;
  begin
    perform public.timekeeping_admin_close_open_shift(v_break_session_id, v_out, 'Forgot both actions', null);
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_blocked := v_error_detail = 'TIMEKEEPING_OPEN_BREAK_ACTIVE';
  end;
  if not v_blocked
    or (select b.ended_at from public.attendance_breaks b where b.id = v_break_id) is not null
    or (select s.clocked_out_at from public.attendance_sessions s where s.id = v_break_session_id) is not null
  then
    raise exception 'Unresolved open break was not atomically blocked.';
  end if;

  v_blocked := false;
  begin
    perform public.timekeeping_admin_close_open_shift(
      v_break_session_id,
      v_out,
      'Invalid break order',
      v_out + interval '1 minute'
    );
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_blocked := v_error_detail = 'TIMEKEEPING_ADMIN_CLOSE_INVALID';
  end;
  if not v_blocked then raise exception 'Break end after shift out was not rejected.'; end if;

  v_result := public.timekeeping_admin_close_open_shift(
    v_break_session_id,
    v_out,
    'Forgot break and clock out',
    v_break_end
  );
  if (v_result ->> 'break_closed')::boolean is distinct from true
    or (select b.ended_at from public.attendance_breaks b where b.id = v_break_id) is distinct from v_break_end
    or (select s.clocked_out_at from public.attendance_sessions s where s.id = v_break_session_id) is distinct from v_out
  then
    raise exception 'Open-break administrative resolution failed: %', v_result;
  end if;

  select v.worked_seconds into v_worked
  from public.attendance_effective_sessions v
  where v.session_id = v_break_session_id;

  select greatest(
    0::bigint,
    floor(extract(epoch from (s.clocked_out_at - s.clocked_in_at)))::bigint
      - floor(extract(epoch from (b.ended_at - b.started_at)))::bigint
  )
  into v_expected_worked
  from public.attendance_sessions s
  join public.attendance_breaks b on b.session_id = s.id
  where s.id = v_break_session_id and b.id = v_break_id;

  if v_worked is distinct from v_expected_worked
    or not exists (
      select 1 from public.attendance_effective_sessions v
      where v.session_id = v_break_session_id
        and v.was_admin_closed = true
        and v.admin_close_reason = 'Forgot break and clock out'
        and v.admin_had_open_break = true
        and v.admin_open_break_closed_at = v_break_end
    )
  then
    raise exception 'Break duration, worked_seconds, or T3C read model is incorrect: % seconds.', v_worked;
  end if;

  -- T3B correction remains additive and cannot erase the T3C closure audit.
  v_result := public.timekeeping_correct_session(
    v_break_session_id,
    null,
    v_out - interval '5 minutes',
    'Later reporting correction'
  );
  if (v_result ->> 'ok')::boolean is distinct from true
    or not exists (
      select 1 from public.attendance_effective_sessions v
      where v.session_id = v_break_session_id
        and v.was_admin_closed = true
        and v.has_correction = true
        and v.admin_close_reason = 'Forgot break and clock out'
        and v.latest_correction_reason = 'Later reporting correction'
    )
    or (select count(*) from public.attendance_admin_closures c where c.session_id = v_break_session_id) <> 1
  then
    raise exception 'T3B correction and T3C closure audit did not coexist: %', v_result;
  end if;
end;
$$;

-- Required: remove every verification fixture and restore prior data/order.
rollback;
