-- CURV Timekeeping T4A verification
--
-- Run manually in Supabase SQL Editor only after reviewing and applying:
-- admin/TIMEKEEPING_PHASE_T4A_STAFF_MANAGEMENT.sql
--
-- All staff and attendance fixtures are transaction-local. Final ROLLBACK
-- restores every pre-verification staff order and removes all fixture rows.

begin;

-- =========================================================
-- Structure, authorization, grants, and direct-table access
-- =========================================================

do $$
declare
  v_signature text;
  v_function_oid oid;
  v_function_body text;
  v_public_execute boolean;
  v_privilege text;
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.staff'::regclass
      and idx.relname = 'staff_one_active_normalized_name_idx'
      and i.indisunique = true
      and lower(pg_get_expr(i.indpred, i.indrelid)) like '%is_active%true%'
      and lower(pg_get_indexdef(i.indexrelid)) like '%lower(btrim(name))%'
  ) then
    raise exception 'Active normalized staff-name unique index is missing or incorrect.';
  end if;

  foreach v_signature in array array[
    'public.timekeeping_admin_list_staff()',
    'public.timekeeping_admin_create_staff(text,text)',
    'public.timekeeping_admin_rename_staff(uuid,text)',
    'public.timekeeping_admin_reset_staff_pin(uuid,text)',
    'public.timekeeping_admin_set_staff_active(uuid,boolean)',
    'public.timekeeping_admin_move_staff(uuid,text)'
  ]
  loop
    v_function_oid := to_regprocedure(v_signature);
    if v_function_oid is null then
      raise exception 'Required T4A function is missing: %.', v_signature;
    end if;

    select pg_get_functiondef(v_function_oid) into v_function_body;

    if not exists (
      select 1
      from pg_proc p
      where p.oid = v_function_oid
        and p.prosecdef = true
        and p.proconfig @> array['search_path=public, pg_temp']
    ) then
      raise exception 'SECURITY DEFINER/search_path verification failed for %.', v_signature;
    end if;

    if lower(v_function_body) not like '%auth.uid()%'
      or lower(v_function_body) not like '%public.is_admin()%'
      or lower(v_function_body) not like '%timekeeping_forbidden%'
    then
      raise exception 'Internal owner guard is missing from %.', v_signature;
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
      raise exception 'Admin RPC grants are incorrect for %.', v_signature;
    end if;
  end loop;

  if lower(pg_get_function_result('public.timekeeping_admin_list_staff()'::regprocedure)) like '%pin%'
    or lower(pg_get_functiondef('public.timekeeping_admin_list_staff()'::regprocedure)) like '%pin_hash%'
    or lower(pg_get_functiondef('public.timekeeping_admin_list_staff()'::regprocedure)) like '%pin_attempt%'
  then
    raise exception 'Owner staff list exposes or reads PIN-sensitive fields.';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'timekeeping_admin_delete_staff',
        'timekeeping_delete_staff',
        'delete_timekeeping_staff'
      )
  ) then
    raise exception 'A prohibited staff hard-delete RPC exists.';
  end if;

  foreach v_privilege in array array[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]
  loop
    if has_table_privilege('anon', 'public.staff', v_privilege)
      or has_table_privilege('authenticated', 'public.staff', v_privilege)
    then
      raise exception 'Browser roles unexpectedly have direct staff % access.', v_privilege;
    end if;
  end loop;
end;
$$;

-- =========================================================
-- Rollback-only owner and kiosk lifecycle fixtures
-- =========================================================

do $$
declare
  v_owner_id uuid;
  v_nonowner_id uuid := gen_random_uuid();
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_alpha_name text;
  v_beta_name text;
  v_gamma_name text;
  v_alpha_id uuid;
  v_beta_id uuid;
  v_gamma_id uuid;
  v_session_id uuid;
  v_break_id uuid;
  v_result jsonb;
  v_list jsonb;
  v_error_detail text;
  v_hash_before text;
  v_hash_after text;
  v_id_after uuid;
  v_order_before integer;
  v_order_after integer;
  v_staff_count integer;
  v_attempt_count integer;
  v_session_count integer;
  v_break_count integer;
  v_correction_count integer;
  v_loop integer;
  v_nonowner_list_blocked boolean := false;
  v_nonowner_mutation_blocked boolean := false;
begin
  select ap.id
  into v_owner_id
  from public.admin_profiles ap
  where ap.role = 'owner'
  order by ap.created_at nulls last, ap.id
  limit 1;

  if v_owner_id is null then
    raise exception 'T4A verification needs one existing CURV owner profile.';
  end if;

  v_alpha_name := 'T4A Aster ' || v_suffix;
  v_beta_name := 'T4A Beta ' || v_suffix;
  v_gamma_name := 'T4A Gamma ' || v_suffix;

  -- A non-owner cannot list or mutate staff even though authenticated has the
  -- RPC EXECUTE grant needed by the browser client.
  perform set_config('request.jwt.claim.sub', v_nonowner_id::text, true);

  begin
    perform public.timekeeping_admin_list_staff();
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_nonowner_list_blocked := v_error_detail = 'TIMEKEEPING_FORBIDDEN';
  end;

  begin
    perform public.timekeeping_admin_create_staff('Forbidden ' || v_suffix, '1234');
  exception when others then
    get stacked diagnostics v_error_detail = pg_exception_detail;
    v_nonowner_mutation_blocked := v_error_detail = 'TIMEKEEPING_FORBIDDEN';
  end;

  if not v_nonowner_list_blocked or not v_nonowner_mutation_blocked then
    raise exception 'Runtime non-owner Staff Management guard failed.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- Input validation occurs before any fixture creation.
  v_result := public.timekeeping_admin_create_staff('   ', '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_INVALID_STAFF_NAME' then
    raise exception 'Blank staff name was not rejected: %', v_result;
  end if;

  foreach v_beta_name in array array[
    '12',
    '12345',
    '12a4',
    chr(65297) || chr(65298) || chr(65299) || chr(65300)
  ]
  loop
    v_result := public.timekeeping_admin_create_staff('Invalid PIN ' || v_suffix, v_beta_name);
    if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_INVALID_PIN' then
      raise exception 'Malformed PIN was not rejected: %', v_result;
    end if;
  end loop;
  v_beta_name := 'T4A Beta ' || v_suffix;

  -- Create three safe staff fixtures. The returned records and owner list must
  -- never contain a hash or plaintext PIN.
  v_result := public.timekeeping_admin_create_staff(v_alpha_name, '1234');
  v_alpha_id := (v_result #>> '{staff,id}')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true or v_alpha_id is null then
    raise exception 'Create Staff Alpha failed: %', v_result;
  end if;

  v_result := public.timekeeping_admin_create_staff(v_beta_name, '2345');
  v_beta_id := (v_result #>> '{staff,id}')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true or v_beta_id is null then
    raise exception 'Create Staff Beta failed: %', v_result;
  end if;

  v_result := public.timekeeping_admin_create_staff(v_gamma_name, '3456');
  v_gamma_id := (v_result #>> '{staff,id}')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true or v_gamma_id is null then
    raise exception 'Create Staff Gamma failed: %', v_result;
  end if;

  if v_result ? 'pin'
    or v_result ? 'pin_hash'
    or (v_result -> 'staff') ? 'pin'
    or (v_result -> 'staff') ? 'pin_hash'
  then
    raise exception 'Create Staff response exposed PIN-sensitive data.';
  end if;

  select s.pin_hash into v_hash_before
  from public.staff s
  where s.id = v_alpha_id;

  if v_hash_before = '1234'
    or extensions.crypt('1234', v_hash_before) is distinct from v_hash_before
  then
    raise exception 'Created PIN is not stored as a valid bcrypt hash.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(listed)), '[]'::jsonb)
  into v_list
  from public.timekeeping_admin_list_staff() listed;

  if v_list::text like '%pin_hash%'
    or not exists (
      select 1 from public.timekeeping_admin_list_staff() listed where listed.id = v_alpha_id
    )
  then
    raise exception 'Owner list safe-shape/create visibility verification failed.';
  end if;

  if not exists (
    select 1 from public.timekeeping_list_active_staff() kiosk where kiosk.id = v_alpha_id
  ) then
    raise exception 'New active staff did not appear in the kiosk list.';
  end if;

  -- Active names are unique after trim and case normalization.
  v_result := public.timekeeping_admin_create_staff('  ' || upper(v_alpha_name) || '  ', '4567');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_STAFF_NAME_DUPLICATE' then
    raise exception 'Duplicate active Create Staff name was not rejected: %', v_result;
  end if;

  -- Rename preserves identity, PIN hash, active state, and ordering.
  select s.display_order into v_order_before from public.staff s where s.id = v_alpha_id;
  v_alpha_name := 'T4A Alpha Renamed ' || v_suffix;
  v_result := public.timekeeping_admin_rename_staff(v_alpha_id, '  ' || v_alpha_name || '  ');

  select s.id, s.pin_hash, s.display_order
  into v_id_after, v_hash_after, v_order_after
  from public.staff s
  where s.id = v_alpha_id;

  if (v_result ->> 'ok')::boolean is distinct from true
    or v_id_after is distinct from v_alpha_id
    or v_hash_after is distinct from v_hash_before
    or v_order_after is distinct from v_order_before
  then
    raise exception 'Rename identity/PIN/order preservation failed: %', v_result;
  end if;

  if not exists (
    select 1
    from public.timekeeping_list_active_staff() kiosk
    where kiosk.id = v_alpha_id and kiosk.name = v_alpha_name
  ) then
    raise exception 'Renamed staff name did not reach the kiosk list.';
  end if;

  v_result := public.timekeeping_admin_rename_staff(v_beta_id, upper(v_alpha_name));
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_STAFF_NAME_DUPLICATE' then
    raise exception 'Duplicate active Rename Staff was not rejected: %', v_result;
  end if;

  -- Resetting the PIN creates a fresh hash and clears prior throttle rows.
  insert into public.timekeeping_pin_attempts (staff_id, attempted_at)
  values (v_alpha_id, clock_timestamp());

  v_result := public.timekeeping_admin_reset_staff_pin(v_alpha_id, '5678');
  if (v_result ->> 'ok')::boolean is distinct from true
    or (v_result ->> 'staff_id')::uuid is distinct from v_alpha_id
  then
    raise exception 'Reset Staff PIN failed: %', v_result;
  end if;

  select s.pin_hash into v_hash_after from public.staff s where s.id = v_alpha_id;
  select count(*)::integer into v_attempt_count
  from public.timekeeping_pin_attempts a where a.staff_id = v_alpha_id;

  if v_hash_after is not distinct from v_hash_before
    or v_hash_after = '5678'
    or extensions.crypt('5678', v_hash_after) is distinct from v_hash_after
    or v_attempt_count <> 0
    or v_result ? 'pin'
    or v_result ? 'pin_hash'
  then
    raise exception 'PIN reset hash/privacy/attempt cleanup verification failed.';
  end if;

  v_result := public.timekeeping_get_staff_status(v_alpha_id, '1234');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_INVALID_CREDENTIALS' then
    raise exception 'Old PIN still worked after reset: %', v_result;
  end if;

  v_result := public.timekeeping_get_staff_status(v_alpha_id, '5678');
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'New PIN failed after reset: %', v_result;
  end if;

  v_result := public.timekeeping_admin_reset_staff_pin(v_alpha_id, 'abcd');
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_INVALID_PIN' then
    raise exception 'Malformed reset PIN was not rejected: %', v_result;
  end if;

  -- Idle deactivation preserves identity and controls kiosk visibility.
  v_result := public.timekeeping_admin_set_staff_active(v_beta_id, false);
  if (v_result ->> 'ok')::boolean is distinct from true
    or (v_result #>> '{staff,is_active}')::boolean is distinct from false
    or exists (select 1 from public.timekeeping_list_active_staff() kiosk where kiosk.id = v_beta_id)
    or not exists (
      select 1
      from public.timekeeping_admin_list_staff() listed
      where listed.id = v_beta_id and listed.is_active = false
    )
  then
    raise exception 'Idle staff deactivation/kiosk exclusion failed: %', v_result;
  end if;

  v_result := public.timekeeping_admin_set_staff_active(v_beta_id, true);
  if (v_result ->> 'ok')::boolean is distinct from true
    or not exists (select 1 from public.timekeeping_list_active_staff() kiosk where kiosk.id = v_beta_id)
  then
    raise exception 'Staff reactivation/kiosk return failed: %', v_result;
  end if;

  -- An inactive duplicate name is allowed historically, but activation is not.
  v_result := public.timekeeping_admin_set_staff_active(v_gamma_id, false);
  v_result := public.timekeeping_admin_rename_staff(v_gamma_id, upper(v_alpha_name));
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Inactive historical duplicate rename was unexpectedly rejected: %', v_result;
  end if;

  v_result := public.timekeeping_admin_set_staff_active(v_gamma_id, true);
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_STAFF_NAME_DUPLICATE' then
    raise exception 'Duplicate-name reactivation was not rejected: %', v_result;
  end if;

  v_result := public.timekeeping_admin_rename_staff(v_gamma_id, v_gamma_name);
  v_result := public.timekeeping_admin_set_staff_active(v_gamma_id, true);
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Valid reactivation after resolving duplicate failed: %', v_result;
  end if;

  -- Sparse and duplicate order values normalize before an atomic neighbor move.
  update public.staff s
  set display_order = 2147483000
  where s.id in (v_alpha_id, v_beta_id, v_gamma_id);

  select ordered.expected_order into v_order_before
  from (
    select
      s.id,
      (row_number() over (order by s.display_order, lower(btrim(s.name)), s.id) - 1)::integer as expected_order
    from public.staff s
  ) ordered
  where ordered.id = v_beta_id;
  v_result := public.timekeeping_admin_move_staff(v_beta_id, 'up');
  select s.display_order into v_order_after from public.staff s where s.id = v_beta_id;

  if (v_result ->> 'ok')::boolean is distinct from true
    or (v_result ->> 'moved')::boolean is distinct from true
    or v_order_after <> v_order_before - 1
  then
    raise exception 'Up movement failed: %', v_result;
  end if;

  if exists (
    select 1
    from (
      select
        s.display_order,
        (row_number() over (order by s.display_order, lower(btrim(s.name)), s.id) - 1)::integer as expected_order
      from public.staff s
    ) ordered
    where ordered.display_order is distinct from ordered.expected_order
  ) then
    raise exception 'Sparse/duplicate display_order values were not normalized.';
  end if;

  v_order_before := v_order_after;
  v_result := public.timekeeping_admin_move_staff(v_beta_id, 'down');
  select s.display_order into v_order_after from public.staff s where s.id = v_beta_id;
  if (v_result ->> 'ok')::boolean is distinct from true
    or (v_result ->> 'moved')::boolean is distinct from true
    or v_order_after <> v_order_before + 1
  then
    raise exception 'Down movement failed: %', v_result;
  end if;

  select count(*)::integer into v_staff_count from public.staff;

  for v_loop in 1..v_staff_count loop
    perform public.timekeeping_admin_move_staff(v_alpha_id, 'up');
  end loop;
  v_result := public.timekeeping_admin_move_staff(v_alpha_id, 'up');
  if (v_result ->> 'moved')::boolean is distinct from false
    or (select s.display_order from public.staff s where s.id = v_alpha_id) <> 0
  then
    raise exception 'First-item Up was not a no-op: %', v_result;
  end if;

  for v_loop in 1..v_staff_count loop
    perform public.timekeeping_admin_move_staff(v_gamma_id, 'down');
  end loop;
  v_result := public.timekeeping_admin_move_staff(v_gamma_id, 'down');
  if (v_result ->> 'moved')::boolean is distinct from false
    or (select s.display_order from public.staff s where s.id = v_gamma_id) <> v_staff_count - 1
  then
    raise exception 'Last-item Down was not a no-op: %', v_result;
  end if;

  -- Inactive staff remain part of the same canonical management order.
  perform public.timekeeping_admin_set_staff_active(v_gamma_id, false);
  select s.display_order into v_order_before from public.staff s where s.id = v_gamma_id;
  v_result := public.timekeeping_admin_move_staff(v_gamma_id, 'up');
  select s.display_order into v_order_after from public.staff s where s.id = v_gamma_id;
  if (v_result ->> 'moved')::boolean is distinct from true or v_order_after <> v_order_before - 1 then
    raise exception 'Inactive staff could not be reordered: %', v_result;
  end if;
  perform public.timekeeping_admin_set_staff_active(v_gamma_id, true);

  -- Active kiosk ordering must be the active subset of management ordering.
  if (
    select array_agg(kiosk.id order by kiosk.display_order, lower(btrim(kiosk.name)), kiosk.id)
    from public.timekeeping_list_active_staff() kiosk
  ) is distinct from (
    select array_agg(listed.id order by listed.display_order, lower(btrim(listed.name)), listed.id)
    from public.timekeeping_admin_list_staff() listed
    where listed.is_active = true
  ) then
    raise exception 'Kiosk active-staff ordering differs from management order.';
  end if;

  -- Open shift and break state block deactivation without modifying attendance.
  v_result := public.timekeeping_clock_in(v_alpha_id, '5678');
  v_session_id := (v_result ->> 'session_id')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true or v_session_id is null then
    raise exception 'Existing Clock In failed for managed staff: %', v_result;
  end if;

  if not exists (
    select 1
    from public.timekeeping_admin_list_staff() listed
    where listed.id = v_alpha_id
      and listed.is_clocked_in = true
      and listed.is_on_break = false
  ) then
    raise exception 'Owner list did not derive open-shift state.';
  end if;

  v_result := public.timekeeping_admin_set_staff_active(v_alpha_id, false);
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_STAFF_CLOCKED_IN'
    or not exists (
      select 1 from public.attendance_sessions a
      where a.id = v_session_id and a.clocked_out_at is null
    )
  then
    raise exception 'Working-staff deactivation safeguard failed: %', v_result;
  end if;

  v_result := public.timekeeping_start_break(v_alpha_id, '5678');
  v_break_id := (v_result ->> 'break_id')::uuid;
  if (v_result ->> 'ok')::boolean is distinct from true or v_break_id is null then
    raise exception 'Existing Start Break failed for managed staff: %', v_result;
  end if;

  if not exists (
    select 1
    from public.timekeeping_admin_list_staff() listed
    where listed.id = v_alpha_id
      and listed.is_clocked_in = true
      and listed.is_on_break = true
  ) then
    raise exception 'Owner list did not derive active-break state.';
  end if;

  v_result := public.timekeeping_admin_set_staff_active(v_alpha_id, false);
  if v_result ->> 'error_code' is distinct from 'TIMEKEEPING_STAFF_CLOCKED_IN'
    or not exists (
      select 1
      from public.attendance_breaks b
      join public.attendance_sessions a on a.id = b.session_id
      where b.id = v_break_id
        and b.ended_at is null
        and a.clocked_out_at is null
    )
    or not exists (select 1 from public.staff s where s.id = v_alpha_id and s.is_active = true)
  then
    raise exception 'On-break deactivation altered staff/attendance state: %', v_result;
  end if;

  v_result := public.timekeeping_end_break(v_alpha_id, '5678');
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Existing End Break failed for managed staff: %', v_result;
  end if;

  v_result := public.timekeeping_clock_out(v_alpha_id, '5678');
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Existing Clock Out failed for managed staff: %', v_result;
  end if;

  -- Existing correction behavior remains intact before lifecycle toggles.
  v_result := public.timekeeping_correct_session(
    v_session_id,
    (select a.clocked_in_at - interval '1 minute' from public.attendance_sessions a where a.id = v_session_id),
    null,
    'T4A lifecycle preservation verification'
  );
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Existing correction RPC failed for managed staff: %', v_result;
  end if;

  select count(*)::integer into v_session_count
  from public.attendance_sessions a where a.staff_id = v_alpha_id;
  select count(*)::integer into v_break_count
  from public.attendance_breaks b
  join public.attendance_sessions a on a.id = b.session_id
  where a.staff_id = v_alpha_id;
  select count(*)::integer into v_correction_count
  from public.attendance_corrections c
  join public.attendance_sessions a on a.id = c.session_id
  where a.staff_id = v_alpha_id;

  v_result := public.timekeeping_admin_set_staff_active(v_alpha_id, false);
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Closed staff deactivation failed: %', v_result;
  end if;

  v_result := public.timekeeping_admin_set_staff_active(v_alpha_id, true);
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'Historical staff reactivation failed: %', v_result;
  end if;

  if (select count(*) from public.attendance_sessions a where a.staff_id = v_alpha_id) <> v_session_count
    or (
      select count(*)
      from public.attendance_breaks b
      join public.attendance_sessions a on a.id = b.session_id
      where a.staff_id = v_alpha_id
    ) <> v_break_count
    or (
      select count(*)
      from public.attendance_corrections c
      join public.attendance_sessions a on a.id = c.session_id
      where a.staff_id = v_alpha_id
    ) <> v_correction_count
  then
    raise exception 'Deactivate/reactivate changed attendance, break, or correction history.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);

  raise notice 'T4A verification passed: owner authorization, safe listing, staff creation/rename/PIN reset, active lifecycle guards, canonical ordering, kiosk compatibility, and attendance history preservation are correct. Final ROLLBACK follows.';
end;
$$;

rollback;
