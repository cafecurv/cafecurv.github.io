-- Draft only: run before WEBSITE_DINE_IN_TIMING_BACKEND.sql after approval.
-- No backfill. Legacy and unaffected orders retain NULL/NULL.
begin;
do $$
begin
  if exists (select 1 from pg_attribute where attrelid='public.orders'::regclass
    and attname in ('preparation_timing','requested_preparation_at') and not attisdropped)
    and not exists (select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_preparation_pair_check') then
    raise exception 'Unreviewed preparation column collision.' using detail='DINE_TIMING_SCHEMA_COLLISION';
  end if;
  if exists (select 1 from pg_attribute where attrelid='public.orders'::regclass and not attisdropped
    and ((attname='preparation_timing' and atttypid<>'text'::regtype)
      or (attname='requested_preparation_at' and atttypid<>'timestamptz'::regtype))) then
    raise exception 'Unexpected preparation column type.' using detail='DINE_TIMING_SCHEMA_COLLISION';
  end if;
  if exists (select 1 from public.orders o where not (
    ((to_jsonb(o)->>'preparation_timing') is null and (to_jsonb(o)->>'requested_preparation_at') is null)
    or ((to_jsonb(o)->>'preparation_timing')='asap' and (to_jsonb(o)->>'requested_preparation_at') is null)
    or ((to_jsonb(o)->>'preparation_timing')='scheduled' and (to_jsonb(o)->>'requested_preparation_at') is not null)
  ) is true) then
    raise exception 'Existing preparation values are incompatible.' using detail='DINE_TIMING_PREFLIGHT_PAIR';
  end if;
end $$;
alter table public.orders add column if not exists preparation_timing text,
  add column if not exists requested_preparation_at timestamptz;
alter table public.orders drop constraint if exists orders_preparation_pair_check;
alter table public.orders add constraint orders_preparation_pair_check check ((
  (preparation_timing is null and requested_preparation_at is null)
  or (preparation_timing='asap' and requested_preparation_at is null)
  or (preparation_timing='scheduled' and requested_preparation_at is not null)
) is true);
commit;
