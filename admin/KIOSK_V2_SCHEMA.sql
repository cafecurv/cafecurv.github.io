-- LOCAL REVIEW DRAFT ONLY. Not an activation or production installation command.
-- Apply only to a reviewed disposable fixture until separately approved.
begin;
do $$begin
 if to_regprocedure('public.submit_public_order_v2(jsonb)') is null
  or to_regprocedure('submission_private.lock_submission_key(uuid)') is null
  or to_regprocedure('configuration_private.price_order_configuration(jsonb)') is null
  or to_regclass('auth.sessions') is null or to_regclass('public.pos_staff_access') is null
  or not exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='d0b1_order_pricing_metadata' and convalidated)
  or to_regnamespace('kiosk_private') is not null then raise exception 'Kiosk prerequisite/collision; review installed contracts.';end if;
end $$;
create schema kiosk_private;
revoke all on schema kiosk_private from public,anon,authenticated;
create table kiosk_private.settings(id boolean primary key default true check(id),mode text not null default 'off' check(mode in ('off','on','drain')));
insert into kiosk_private.settings values(true,'off');
create table kiosk_private.devices(id uuid primary key default gen_random_uuid(),principal uuid unique not null references auth.users(id) on delete restrict,
 active boolean not null default false,valid_until timestamptz not null,drain boolean not null default false,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default clock_timestamp());
create table kiosk_private.generations(id uuid primary key default gen_random_uuid(),device uuid not null references kiosk_private.devices,
 created_at timestamptz not null default clock_timestamp(),closed_at timestamptz);
create unique index kiosk_one_open_generation on kiosk_private.generations(device) where closed_at is null;
create table kiosk_private.attempts(key uuid primary key,generation uuid unique not null references kiosk_private.generations,device uuid not null references kiosk_private.devices,
 intent jsonb not null,request jsonb not null,fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 state text not null default 'admitted' check(state in ('admitted','price_changed','accepted')),receipt jsonb,
 admitted_at timestamptz not null default clock_timestamp(),accepted_at timestamptz,
 check((state='accepted')=(receipt is not null and accepted_at is not null)));
create table kiosk_private.provenance(order_id uuid primary key references public.orders(id) on delete restrict,
 key uuid unique not null references kiosk_private.attempts,device uuid not null references kiosk_private.devices,
 generation uuid not null references kiosk_private.generations,fingerprint text not null,contract_version smallint not null check(contract_version=1));
alter table kiosk_private.generations add unique(id,device);
alter table kiosk_private.attempts add foreign key(generation,device) references kiosk_private.generations(id,device),add unique(key,generation,device,fingerprint);
alter table kiosk_private.provenance add foreign key(key,generation,device,fingerprint) references kiosk_private.attempts(key,generation,device,fingerprint);
create table kiosk_private.audit(id bigint generated always as identity primary key,event text not null,actor uuid not null,key uuid,device uuid,stamp timestamptz not null default clock_timestamp());
do $$declare t text;begin foreach t in array array['settings','devices','generations','attempts','provenance','audit'] loop
 execute format('alter table kiosk_private.%I enable row level security',t);end loop;end $$;
revoke all on all tables in schema kiosk_private from public,anon,authenticated;
revoke all on all sequences in schema kiosk_private from public,anon,authenticated;

-- Additive contract widening: no historical row or fingerprint rewrite.
-- Fail if the existing definition is not the reviewed version-1/2 shape.
do $$declare d text;begin
 select pg_get_constraintdef(oid) into d from pg_constraint where conrelid='public.orders'::regclass and conname='d0b1_order_pricing_metadata';
 if position('submission_fingerprint_version = 2' in d)=0 or position('ARRAY[1, 2]' in d)=0 then raise exception 'Unreviewed pricing metadata constraint';end if;
 d:=replace(d,'submission_fingerprint_version = ANY (ARRAY[1, 2])','submission_fingerprint_version = ANY (ARRAY[1, 2, 3])');
 d:=replace(d,'submission_fingerprint_version = 2','submission_fingerprint_version = ANY (ARRAY[2, 3])');
 alter table public.orders drop constraint d0b1_order_pricing_metadata;
 execute 'alter table public.orders add constraint d0b1_order_pricing_metadata '||d;
end $$;
commit;
