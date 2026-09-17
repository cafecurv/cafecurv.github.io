-- LOCAL DRAFT ONLY. Requires accepted P1A schema/backend; apply before P1B backend.
-- No constraints are added to existing orders/items; no historical rows change.
begin;
create table if not exists public.pos_kitchen_submissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  ticket_number integer not null check (ticket_number > 0),
  source_revision bigint not null check (source_revision > 0),
  command_key uuid not null unique references pos_private.commands(command_key) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  staff_id uuid references public.staff(id) on delete restrict,
  actor_label text not null,
  submitted_at timestamptz not null default clock_timestamp(),
  header jsonb not null check (jsonb_typeof(header)='object'),
  desired_state jsonb not null check (jsonb_typeof(desired_state)='array'),
  unique(order_id,ticket_number)
);
create table if not exists public.pos_kitchen_instructions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.pos_kitchen_submissions(id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  scope text not null check (scope in ('ITEM','ORDER')),
  order_item_id uuid references public.order_items(id) on delete restrict,
  item_version bigint not null check (item_version > 0),
  action text not null check (action in ('ADD','CHANGE','CANCEL')),
  quantity integer not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  prior_instruction_id uuid references public.pos_kitchen_instructions(id) on delete restrict,
  check ((scope='ITEM' and order_item_id is not null and quantity>0)
    or (scope='ORDER' and order_item_id is null and quantity=0 and action='CHANGE')),
  unique(submission_id,ordinal)
);
alter table public.pos_kitchen_submissions enable row level security;
alter table public.pos_kitchen_instructions enable row level security;
revoke all on public.pos_kitchen_submissions,public.pos_kitchen_instructions from public,anon,authenticated;

create or replace function pos_private.kitchen_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Kitchen history is immutable.' using errcode='P0001',detail='POS_KITCHEN_IMMUTABLE';
end $$;
revoke all on function pos_private.kitchen_immutable() from public,anon,authenticated;
drop trigger if exists kitchen_submission_immutable on public.pos_kitchen_submissions;
create trigger kitchen_submission_immutable before update or delete on public.pos_kitchen_submissions
  for each row execute function pos_private.kitchen_immutable();
drop trigger if exists kitchen_instruction_immutable on public.pos_kitchen_instructions;
create trigger kitchen_instruction_immutable before update or delete on public.pos_kitchen_instructions
  for each row execute function pos_private.kitchen_immutable();
commit;
