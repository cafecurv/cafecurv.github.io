-- CURV Timekeeping T1 verification
--
-- Run manually in Supabase SQL Editor only after reviewing and applying:
-- admin/TIMEKEEPING_PHASE_T1_BACKEND.sql
--
-- Every staff, PIN-attempt, session, and correction fixture is created inside
-- this transaction. The final ROLLBACK removes all fixture rows.

begin;

-- =========================================================
-- Structure, RLS, functions, and view
-- =========================================================

do $$
declare
  v_table_name text;
  v_signature text;
  v_function_oid oid;
begin
  if not exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto'
      and n.nspname = 'extensions'
  ) then
    raise exception 'pgcrypto extension is missing from the extensions schema.';
  end if;

  foreach v_table_name in array array[
    'staff',
    'attendance_sessions',
    'attendance_corrections',
    'timekeeping_pin_attempts'
  ]
  loop
    if to_regclass('public.' || v_table_name) is null then
      raise exception 'Required T1 table is missing: %.', v_table_name;
    end if;

    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table_name
        and c.relrowsecurity = true
    ) then
      raise exception 'RLS is not enabled on public.%.', v_table_name;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'staff'
      and c.column_name = 'id'
      and c.data_type = 'uuid'
      and c.is_nullable = 'NO'
      and lower(coalesce(c.column_default, '')) like '%gen_random_uuid%'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'staff'
      and c.column_name = 'pin_hash'
      and c.data_type = 'text'
      and c.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'staff'
      and c.column_name = 'is_active'
      and c.data_type = 'boolean'
      and c.is_nullable = 'NO'
      and lower(coalesce(c.column_default, '')) like '%true%'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'staff'
      and c.column_name = 'display_order'
      and c.data_type = 'integer'
      and c.is_nullable = 'NO'
      and coalesce(c.column_default, '') like '%0%'
  ) then
    raise exception 'staff column/type/default verification failed.';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_sessions'
      and c.column_name = 'staff_id'
      and c.data_type = 'uuid'
      and c.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_sessions'
      and c.column_name = 'clocked_in_at'
      and c.data_type = 'timestamp with time zone'
      and c.is_nullable = 'NO'
      and lower(coalesce(c.column_default, '')) like '%now()%'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_sessions'
      and c.column_name = 'clocked_out_at'
      and c.data_type = 'timestamp with time zone'
      and c.is_nullable = 'YES'
  ) then
    raise exception 'attendance_sessions column/type/default verification failed.';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_corrections'
      and c.column_name = 'corrected_by'
      and c.data_type = 'uuid'
      and c.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'attendance_corrections'
      and c.column_name = 'reason'
      and c.data_type = 'text'
      and c.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'timekeeping_pin_attempts'
      and c.column_name = 'attempted_at'
      and c.data_type = 'timestamp with time zone'
      and c.is_nullable = 'NO'
      and lower(coalesce(c.column_default, '')) like '%now()%'
  ) then
    raise exception 'Correction/PIN-attempt column verification failed.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.attendance_sessions'::regclass
      and c.conname = 'attendance_sessions_time_order_valid'
      and c.contype = 'c'
  ) or not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.attendance_corrections'::regclass
      and c.conname = 'attendance_corrections_has_change'
      and c.contype = 'c'
  ) then
    raise exception 'Attendance time/correction constraints are missing.';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.attendance_sessions'::regclass
      and idx.relname = 'attendance_sessions_one_open_per_staff_idx'
      and i.indisunique = true
      and lower(pg_get_expr(i.indpred, i.indrelid)) like '%clocked_out_at is null%'
  ) then
    raise exception 'One-open-session partial unique index is missing or incorrect.';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.attendance_sessions'::regclass
      and t.tgname = 'enforce_attendance_session_immutability'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'Attendance session immutability trigger is missing.';
  end if;

  foreach v_signature in array array[
    'public.timekeeping_list_active_staff()',
    'public.timekeeping_get_staff_status(uuid,text)',
    'public.timekeeping_clock_in(uuid,text)',
    'public.timekeeping_clock_out(uuid,text)',
    'public.timekeeping_correct_session(uuid,timestamptz,timestamptz,text)',
    'public.timekeeping_verify_staff_pin(uuid,text)'
  ]
  loop
    v_function_oid := to_regprocedure(v_signature);
    if v_function_oid is null then
      raise exception 'Required T1 function is missing: %.', v_signature;
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
  end loop;

  if position(
    'pin_hash' in lower(pg_get_function_result('public.timekeeping_list_active_staff()'::regprocedure))
  ) > 0 then
    raise exception 'Active staff RPC exposes pin_hash.';
  end if;

  if to_regclass('public.attendance_effective_sessions') is null
    or not exists (
      select 1
      from pg_class c
      where c.oid = 'public.attendance_effective_sessions'::regclass
        and c.relkind = 'v'
        and c.reloptions @> array['security_invoker=true']
    )
    or exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'attendance_effective_sessions'
        and c.column_name = 'pin_hash'
    )
  then
    raise exception 'Owner attendance read-model security verification failed.';
  end if;

  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'staff'
      and p.policyname = 'Owners can read timekeeping staff'
      and p.roles @> array['authenticated'::name]
      and lower(coalesce(p.qual, '')) like '%is_admin%'
  ) or not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'attendance_sessions'
      and p.policyname = 'Owners can read attendance sessions'
      and p.roles @> array['authenticated'::name]
      and lower(coalesce(p.qual, '')) like '%is_admin%'
  ) or not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'attendance_corrections'
      and p.policyname = 'Owners can read attendance corrections'
      and p.roles @> array['authenticated'::name]
      and lower(coalesce(p.qual, '')) like '%is_admin%'
  ) or exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'timekeeping_pin_attempts'
  ) then
    raise exception 'Owner-read/internal-attempt RLS policy verification failed.';
  end if;
end;
$$;

-- =========================================================
-- Function and table grants
-- =========================================================

do $$
declare
  v_signature text;
  v_function_oid oid;
  v_privilege text;
  v_table_name text;
  v_public_execute boolean;
begin
  foreach v_signature in array array[
    'public.timekeeping_list_active_staff()',
    'public.timekeeping_get_staff_status(uuid,text)',
    'public.timekeeping_clock_in(uuid,text)',
    'public.timekeeping_clock_out(uuid,text)'
  ]
  loop
    v_function_oid := to_regprocedure(v_signature);

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

  v_function_oid := 'public.timekeeping_correct_session(uuid,timestamptz,timestamptz,text)'::regprocedure;
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
    raise exception 'Owner correction RPC grants are incorrect.';
  end if;

  v_function_oid := 'public.timekeeping_verify_staff_pin(uuid,text)'::regprocedure;
  if has_function_privilege('anon', v_function_oid, 'EXECUTE')
    or has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
  then
    raise exception 'Internal PIN verifier is directly executable.';
  end if;

  foreach v_table_name in array array[
    'staff',
    'attendance_sessions',
    'attendance_corrections',
    'timekeeping_pin_attempts'
  ]
  loop
    foreach v_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    loop
      if has_table_privilege('anon', 'public.' || v_table_name, v_privilege) then
        raise exception 'anon unexpectedly has % on public.%.', v_privilege, v_table_name;
      end if;

      if v_privilege <> 'SELECT'
        and has_table_privilege('authenticated', 'public.' || v_table_name, v_privilege)
      then
        raise exception 'authenticated unexpectedly has % on public.%.', v_privilege, v_table_name;
      end if;
    end loop;
  end loop;

  if has_column_privilege('authenticated', 'public.staff', 'pin_hash', 'SELECT')
    or has_table_privilege('authenticated', 'public.timekeeping_pin_attempts', 'SELECT')
    or not has_column_privilege('authenticated', 'public.staff', 'name', 'SELECT')
    or not has_table_privilege('authenticated', 'public.attendance_sessions', 'SELECT')
    or not has_table_privilege('authenticated', 'public.attendance_corrections', 'SELECT')
  then
    raise exception 'Authenticated owner-read/private-PIN grants are incorrect.';
  end if;

  if has_table_privilege('anon', 'public.attendance_effective_sessions', 'SELECT')
    or not has_table_privilege('authenticated', 'public.attendance_effective_sessions', 'SELECT')
  then
    raise exception 'Owner read-model grants are incorrect.';
  end if;
end;
$$;

-- =========================================================
-- Transactional behavior fixtures
-- =========================================================

do $$
declare
  v_owner_id uuid;
  v_active_staff_id uuid := gen_random_uuid();
  v_inactive_staff_id uuid := gen_random_uuid();
  v_missing_staff_id uuid := gen_random_uuid();
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_result jsonb;
  v_session_id uuid;
  v_second_session_id uuid;
  v_open_session_id uuid;
  v_original_in timestamptz;
  v_original_out timestamptz;
  v_after_in timestamptz;
  v_after_out timestamptz;
  v_view_in timestamptz;
  v_view_out timestamptz;
  v_view_reason text;
  v_before timestamptz;
  v_after timestamptz;
  v_error_detail text;
  v_attempt_count integer;
  v_closed_count integer;
  v_correction_count integer;
  v_wrong_attempt integer;
  v_unique_blocked boolean := false;
  v_anon_correction_blocked boolean := false;
  v_nonadmin_correction_blocked boolean := false;
  v_blank_reason_blocked boolean := false;
  v_empty_correction_blocked boolean := false;
  v_time_order_blocked boolean := false;
  v_future_blocked boolean := false;
  v_open_correction_blocked boolean := false;
  v_original_update_blocked boolean := false;
begin
  select ap.id
  into v_owner_id
  from public.admin_profiles ap
  where ap.role = 'owner'
  order by ap.created_at nulls last, ap.id
  limit 1;

  if v_owner_id is null then
    raise exception 'T1 verification needs one existing CURV owner profile.';
  end if;

  insert into public.staff (
    id,
    name,
    pin_hash,
    is_active,
    display_order,
    created_by
  ) values (
    v_active_staff_id,
    'T1 Active ' || v_suffix,
    extensions.crypt('1234', extensions.gen_salt('bf', 8)),
    true,
    9000,
    v_owner_id
  ), (
    v_inactive_staff_id,
    'T1 Inactive ' || v_suffix,
    extensions.crypt('1234', extensions.gen_salt('bf', 8)),
    false,
    9001,
    v_owner_id
  );

  if not exists (
    select 1
    from public.staff s
    where s.id = v_active_staff_id
      and extensions.crypt('1234', s.pin_hash) = s.pin_hash
  ) then
    raise exception 'Fixture bcrypt round-trip verification failed.';
  end if;

  -- Public-safe list: active appears, inactive does not, and the function's
  -- declared result was structurally checked above for pin_hash exclusion.
  if not exists (
    select 1
    from public.timekeeping_list_active_staff() s
    where s.id = v_active_staff_id
      and s.name = 'T1 Active ' || v_suffix
      and s.display_order = 9000
  ) or exists (
    select 1
    from public.timekeeping_list_active_staff() s
    where s.id = v_inactive_staff_id
  ) then
    raise exception 'Active/inactive staff-list verification failed.';
  end if;

  -- Wrong PIN persists one failure. Invalid formatting is rejected without
  -- adding another attempt. Correct PIN succeeds and clears the streak.
  v_result := public.timekeeping_get_staff_status(v_active_staff_id, '9999');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_INVALID_CREDENTIALS' then
    raise exception 'Wrong-PIN error contract verification failed: %', v_result;
  end if;

  select count(*)::integer into v_attempt_count
  from public.timekeeping_pin_attempts a
  where a.staff_id = v_active_staff_id;

  if v_attempt_count <> 1 then
    raise exception 'Wrong PIN attempt was not recorded.';
  end if;

  v_result := public.timekeeping_get_staff_status(v_active_staff_id, '12 34');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_INVALID_CREDENTIALS' then
    raise exception 'Strict four-digit PIN format verification failed: %', v_result;
  end if;

  select count(*)::integer into v_attempt_count
  from public.timekeeping_pin_attempts a
  where a.staff_id = v_active_staff_id;

  if v_attempt_count <> 1 then
    raise exception 'Invalid-format PIN unexpectedly changed the failure streak.';
  end if;

  v_result := public.timekeeping_get_staff_status(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true
    or (v_result ->> 'is_clocked_in')::boolean is distinct from false
  then
    raise exception 'Initial correct-PIN status verification failed: %', v_result;
  end if;

  if exists (
    select 1 from public.timekeeping_pin_attempts a where a.staff_id = v_active_staff_id
  ) then
    raise exception 'Successful PIN verification did not clear the failure streak.';
  end if;

  v_result := public.timekeeping_get_staff_status(v_inactive_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_STAFF_UNAVAILABLE' then
    raise exception 'Inactive staff action was not rejected generically: %', v_result;
  end if;

  v_result := public.timekeeping_get_staff_status(v_missing_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_STAFF_UNAVAILABLE' then
    raise exception 'Unknown staff action was not rejected generically: %', v_result;
  end if;

  -- Clock in uses a server timestamp and creates exactly one open session.
  v_before := clock_timestamp();
  v_result := public.timekeeping_clock_in(v_active_staff_id, '1234');
  v_after := clock_timestamp();

  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Clock-in verification failed: %', v_result;
  end if;

  v_session_id := (v_result ->> 'session_id')::uuid;
  select s.clocked_in_at
  into v_after_in
  from public.attendance_sessions s
  where s.id = v_session_id
    and s.staff_id = v_active_staff_id
    and s.clocked_out_at is null;

  if not found or v_after_in < v_before or v_after_in > v_after then
    raise exception 'Clock-in server timestamp/open-session verification failed.';
  end if;

  v_result := public.timekeeping_clock_in(v_active_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_ALREADY_CLOCKED_IN' then
    raise exception 'Second clock-in was not rejected correctly: %', v_result;
  end if;

  begin
    insert into public.attendance_sessions (staff_id)
    values (v_active_staff_id);
  exception when unique_violation then
    v_unique_blocked := true;
  end;

  if not v_unique_blocked then
    raise exception 'Partial unique index did not block a second open session.';
  end if;

  v_result := public.timekeeping_get_staff_status(v_active_staff_id, '1234');
  if (v_result ->> 'is_clocked_in')::boolean is distinct from true
    or (v_result ->> 'session_id')::uuid is distinct from v_session_id
  then
    raise exception 'Status-after-clock-in verification failed: %', v_result;
  end if;

  -- Clock out closes the open row with a nonnegative server duration.
  v_result := public.timekeeping_clock_out(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true
    or (v_result ->> 'session_id')::uuid is distinct from v_session_id
    or (v_result ->> 'duration_seconds')::bigint < 0
  then
    raise exception 'Clock-out verification failed: %', v_result;
  end if;

  select s.clocked_in_at, s.clocked_out_at
  into v_original_in, v_original_out
  from public.attendance_sessions s
  where s.id = v_session_id;

  if v_original_out is null or v_original_out < v_original_in then
    raise exception 'Clock-out did not close the original attendance session safely.';
  end if;

  v_result := public.timekeeping_clock_out(v_active_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_NOT_CLOCKED_IN' then
    raise exception 'Second clock-out was not rejected correctly: %', v_result;
  end if;

  v_result := public.timekeeping_get_staff_status(v_active_staff_id, '1234');
  if (v_result ->> 'is_clocked_in')::boolean is distinct from false then
    raise exception 'Status-after-clock-out verification failed: %', v_result;
  end if;

  -- A second complete shift is allowed and the first closed shift remains.
  v_result := public.timekeeping_clock_in(v_active_staff_id, '1234');
  v_second_session_id := (v_result ->> 'session_id')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true
    or v_second_session_id is null
    or v_second_session_id = v_session_id
  then
    raise exception 'Second-shift clock-in verification failed: %', v_result;
  end if;

  v_result := public.timekeeping_clock_out(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Second-shift clock-out verification failed: %', v_result;
  end if;

  select count(*)::integer
  into v_closed_count
  from public.attendance_sessions s
  where s.staff_id = v_active_staff_id
    and s.clocked_out_at is not null;

  if v_closed_count <> 2 then
    raise exception 'Multiple-shift history verification failed.';
  end if;

  -- Five failures within ten minutes lock the staff member for fifteen
  -- minutes. Transactional timestamp adjustment verifies deterministic expiry.
  for v_wrong_attempt in 1..5 loop
    v_result := public.timekeeping_get_staff_status(v_active_staff_id, '9999');
    if v_wrong_attempt < 5
      and v_result ->> 'error_code' is distinct from 'TIMEKEEPING_INVALID_CREDENTIALS'
    then
      raise exception 'PIN lockout started before five failures: %', v_result;
    end if;
  end loop;

  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_PIN_LOCKED' then
    raise exception 'Fifth failed PIN did not activate lockout: %', v_result;
  end if;

  v_result := public.timekeeping_get_staff_status(v_active_staff_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_PIN_LOCKED' then
    raise exception 'Correct PIN bypassed active lockout: %', v_result;
  end if;

  select count(*)::integer into v_attempt_count
  from public.timekeeping_pin_attempts a
  where a.staff_id = v_active_staff_id;

  if v_attempt_count <> 5 then
    raise exception 'Locked requests unexpectedly added PIN-attempt rows.';
  end if;

  update public.timekeeping_pin_attempts a
  set attempted_at = clock_timestamp() - interval '16 minutes'
  where a.staff_id = v_active_staff_id;

  v_result := public.timekeeping_get_staff_status(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true
    or exists (
      select 1 from public.timekeeping_pin_attempts a where a.staff_id = v_active_staff_id
    )
  then
    raise exception 'PIN lock expiry/reset verification failed: %', v_result;
  end if;

  -- Correction guards use the existing CURV exception-detail convention.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.timekeeping_correct_session(
      v_session_id,
      v_original_in - interval '5 minutes',
      null,
      'Anonymous correction test'
    );
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_anon_correction_blocked := v_error_detail = 'TIMEKEEPING_FORBIDDEN';
  end;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.timekeeping_correct_session(
      v_session_id,
      v_original_in - interval '5 minutes',
      null,
      'Non-admin correction test'
    );
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_nonadmin_correction_blocked := v_error_detail = 'TIMEKEEPING_FORBIDDEN';
  end;

  if not v_anon_correction_blocked or not v_nonadmin_correction_blocked then
    raise exception 'Correction authentication/admin guard verification failed.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  begin
    perform public.timekeeping_correct_session(
      v_session_id,
      v_original_in - interval '5 minutes',
      null,
      '   '
    );
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_blank_reason_blocked := v_error_detail = 'TIMEKEEPING_INVALID_CORRECTION';
  end;

  begin
    perform public.timekeeping_correct_session(
      v_session_id,
      null,
      null,
      'No changed fields'
    );
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_empty_correction_blocked := v_error_detail = 'TIMEKEEPING_INVALID_CORRECTION';
  end;

  begin
    perform public.timekeeping_correct_session(
      v_session_id,
      v_original_in,
      v_original_in - interval '1 second',
      'Invalid time order'
    );
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_time_order_blocked := v_error_detail = 'TIMEKEEPING_INVALID_CORRECTION';
  end;

  begin
    perform public.timekeeping_correct_session(
      v_session_id,
      clock_timestamp() + interval '1 hour',
      null,
      'Future correction'
    );
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_future_blocked := v_error_detail = 'TIMEKEEPING_INVALID_CORRECTION';
  end;

  if not v_blank_reason_blocked
    or not v_empty_correction_blocked
    or not v_time_order_blocked
    or not v_future_blocked
  then
    raise exception 'Correction input-validation verification failed.';
  end if;

  -- Valid corrections append audit rows. Latest correction wins, while a NULL
  -- field in that row falls back to the immutable original session value.
  v_result := public.timekeeping_correct_session(
    v_session_id,
    v_original_in - interval '5 minutes',
    null,
    'First correction'
  );

  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Valid correction verification failed: %', v_result;
  end if;

  perform pg_sleep(0.001);

  v_result := public.timekeeping_correct_session(
    v_session_id,
    v_original_in - interval '2 minutes',
    null,
    'Second correction'
  );

  select
    v.effective_clocked_in_at,
    v.effective_clocked_out_at,
    v.latest_correction_reason
  into v_view_in, v_view_out, v_view_reason
  from public.attendance_effective_sessions v
  where v.session_id = v_session_id;

  select count(*)::integer
  into v_correction_count
  from public.attendance_corrections c
  where c.session_id = v_session_id;

  select s.clocked_in_at, s.clocked_out_at
  into v_after_in, v_after_out
  from public.attendance_sessions s
  where s.id = v_session_id;

  if v_correction_count <> 2
    or v_view_in is distinct from v_original_in - interval '2 minutes'
    or v_view_out is distinct from v_original_out
    or v_view_reason is distinct from 'Second correction'
    or v_after_in is distinct from v_original_in
    or v_after_out is distinct from v_original_out
  then
    raise exception 'Correction audit/latest-effective/original-immutability verification failed.';
  end if;

  -- Closed originals cannot be rewritten directly, even by a privileged SQL
  -- caller. Open sessions also cannot be logically closed by a correction.
  begin
    update public.attendance_sessions s
    set clocked_in_at = s.clocked_in_at - interval '1 minute'
    where s.id = v_session_id;
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_original_update_blocked := v_error_detail = 'TIMEKEEPING_SESSION_IMMUTABLE';
  end;

  v_result := public.timekeeping_clock_in(v_active_staff_id, '1234');
  v_open_session_id := (v_result ->> 'session_id')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true or v_open_session_id is null then
    raise exception 'Open-session correction fixture clock-in failed: %', v_result;
  end if;

  begin
    perform public.timekeeping_correct_session(
      v_open_session_id,
      clock_timestamp() - interval '1 minute',
      null,
      'Open session correction'
    );
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_open_correction_blocked := v_error_detail = 'TIMEKEEPING_INVALID_CORRECTION';
  end;

  if not v_original_update_blocked or not v_open_correction_blocked then
    raise exception 'Original-session/open-correction invariant verification failed.';
  end if;

  v_result := public.timekeeping_clock_out(v_active_staff_id, '1234');
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Final fixture clock-out failed: %', v_result;
  end if;

  perform set_config('request.jwt.claim.sub', '', true);

  raise notice 'T1 verification passed: structure, RLS, grants, staff list, PIN validation/lockout, clock lifecycle, multiple shifts, correction audit, effective view, and immutable originals are correct.';
end;
$$;

rollback;
