begin;

create function public.kiosk_owner_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  perform kiosk_private.owner();

  return jsonb_build_object(
    'mode', (select mode from kiosk_private.settings where id),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'device_id', d.id,
        'principal', d.principal,
        'active', d.active,
        'drain', d.drain,
        'valid_until', d.valid_until,
        'state', case
          when not d.active then 'revoked'
          when d.valid_until <= statement_timestamp() then 'expired'
          when d.drain then 'draining'
          else 'authorized'
        end
      ) order by d.id)
      from kiosk_private.devices d
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.kiosk_owner_status() from public, anon, authenticated;
grant execute on function public.kiosk_owner_status() to authenticated;

commit;
