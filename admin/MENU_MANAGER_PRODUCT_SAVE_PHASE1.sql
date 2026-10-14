-- LOCAL DRAFT. Review/test before deployment. Apply once, as one transaction.
-- Deploy this boundary before its editor. Old editors fail safely after installation.
-- Shared option changes and product deletion are deliberately gated in Phase 1.
-- No catalog backfill, certification backfill, order writes or public RPC replacement.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare signature text; relation text;
begin
  if to_regnamespace('menu_save_private') is not null or exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('menu_manager_get_product_editor','menu_manager_save_product')) then
    raise exception 'Product save boundary already exists. Review instead of rerunning.';
  end if;
  foreach signature in array array['public.is_admin()','auth.uid()',
    'public.menu_manager_reconcile_product_sizes(uuid,jsonb)',
    'configuration_private.catalog_structure(uuid)','configuration_private.validate_product_coverage(uuid)',
    'configuration_private.certify_product(uuid,jsonb,text)','configuration_private.assert_pricing_ready(uuid)',
    'extensions.digest(bytea,text)'] loop
    if to_regprocedure(signature) is null then raise exception 'Missing prerequisite: %',signature; end if;
  end loop;
  foreach relation in array array['products','product_sizes','categories','category_sections','inventory_recipes',
    'option_groups','option_choices','product_option_groups','product_option_defaults',
    'product_size_option_choice_compatibility','product_option_choice_price_overrides','product_option_choice_override_requirements'] loop
    if to_regclass('public.'||relation) is null then raise exception 'Missing prerequisite: %',relation; end if;
    if (select relowner<>current_user::regrole from pg_class where oid=to_regclass('public.'||relation)) then
      raise exception 'Run as the existing catalog owner; review ownership first.';
    end if;
  end loop;
  if (select proowner<>current_user::regrole from pg_proc where oid='public.menu_manager_reconcile_product_sizes(uuid,jsonb)'::regprocedure)
    or (select relowner<>current_user::regrole from pg_class where oid='configuration_private.product_pricing_certifications'::regclass) then
    raise exception 'Existing helper/certification ownership must match the catalog owner.';
  end if;
  perform badge_labels,category_section_id,variant_group_name,is_sold_out,archived_at from public.products limit 0;
  perform cost from public.product_sizes limit 0;
end $$;

create schema menu_save_private;
revoke all on schema menu_save_private from public,anon,authenticated;
create table menu_save_private.requests (
  actor uuid not null, request_id uuid not null, request jsonb not null, result jsonb not null,
  saved_at timestamptz not null default clock_timestamp(), primary key(actor,request_id)
);
-- Transaction-local capability, inaccessible to API roles (not a forgeable GUC).
create table menu_save_private.active_save (
  backend integer not null, transaction_id bigint not null, product_id uuid not null,
  primary key(backend,transaction_id)
);
alter table menu_save_private.requests enable row level security;
alter table menu_save_private.active_save enable row level security;
revoke all on all tables in schema menu_save_private from public,anon,authenticated;

create function menu_save_private.editor_version(p_id uuid) returns text
language sql stable set search_path=pg_catalog as $$
 select encode(extensions.digest(convert_to(jsonb_build_object(
   'product',to_jsonb(p),'structure',configuration_private.catalog_structure(p.id),
   'category',(select to_jsonb(c) from public.categories c where c.id=p.category_id),
   'section',(select to_jsonb(s) from public.category_sections s where s.id=p.category_section_id),
   'review',(select to_jsonb(r) from configuration_private.product_pricing_certifications r where r.product_id=p.id)
 )::text,'UTF8'),'sha256'),'hex') from public.products p where p.id=p_id;
$$;

create function public.menu_manager_get_product_editor(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then
   raise exception 'Owner access is required to edit products.' using detail='MM_SAVE_AUTH';
 end if;
 return (select jsonb_build_object('product',to_jsonb(p)||jsonb_build_object('product_sizes',
   coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order,s.id) from public.product_sizes s where s.product_id=p.id),'[]'::jsonb)),
   'version',menu_save_private.editor_version(p.id)) from public.products p where p.id=p_product_id and p.archived_at is null);
end $$;

create function menu_save_private.guard_catalog_write() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare target uuid;
begin
 -- Display order is not part of pricing; preserve the existing narrow UI path.
 if TG_TABLE_NAME='products' and TG_OP='UPDATE' then
   if (to_jsonb(NEW)-'sort_order'-'updated_at')=(to_jsonb(OLD)-'sort_order'-'updated_at') then return NEW; end if;
 end if;
 if TG_TABLE_NAME in ('products','product_sizes') and TG_OP<>'DELETE' then
   target:=case when TG_TABLE_NAME='products' then (to_jsonb(NEW)->>'id')::uuid else (to_jsonb(NEW)->>'product_id')::uuid end;
 elsif TG_TABLE_NAME='product_sizes' then target:=OLD.product_id;
 end if;
 if target is not null and exists(select 1 from menu_save_private.active_save
   where backend=pg_backend_pid() and transaction_id=txid_current() and product_id=target) then
   if TG_OP='DELETE' then return OLD; end if; return NEW;
 end if;
 raise exception 'Use the product editor to save. Customer option editing is temporarily read-only.' using detail='MM_SAVE_BOUNDARY';
end $$;

do $$
declare t text;
begin
 foreach t in array array['products','product_sizes','option_groups','option_choices','product_option_groups','product_option_defaults',
   'product_size_option_choice_compatibility','product_option_choice_price_overrides','product_option_choice_override_requirements'] loop
   execute format('create trigger mm_phase1_save_guard before insert or update or delete on public.%I for each row execute function menu_save_private.guard_catalog_write()',t);
 end loop;
end $$;
revoke all on function public.menu_manager_reconcile_product_sizes(uuid,jsonb) from public,anon,authenticated;
revoke insert,update,delete,truncate on public.products,public.product_sizes,public.option_groups,public.option_choices,
 public.product_option_groups,public.product_option_defaults,public.product_size_option_choice_compatibility,
 public.product_option_choice_price_overrides,public.product_option_choice_override_requirements from public,anon,authenticated;
grant update(sort_order) on public.products to authenticated;

create function public.menu_manager_save_product(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog set lock_timeout='3s' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); request_id uuid; pid uuid; old public.products%rowtype;
 fields jsonb; sizes jsonb; action text; old_structure jsonb; reviewed jsonb; result jsonb;
 replay menu_save_private.requests%rowtype; published boolean; live boolean; key text; removed record;
begin
 if actor is null or not coalesce(public.is_admin(),false) then
   raise exception 'Owner access is required to save products.' using detail='MM_SAVE_AUTH';
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Please retry this save in a new session.' using detail='MM_SAVE_INPUT';
 end if;
 if jsonb_typeof(p_request) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_request) k
   where k not in ('request_id','product_id','expected_version','action','product','sizes')) then
   raise exception 'Please reload the editor and try again.' using detail='MM_SAVE_INPUT';
 end if;
 request_id:=(p_request->>'request_id')::uuid;
 pid:=(p_request->>'product_id')::uuid;
 if request_id is null then raise exception 'Please reload the editor and try again.' using detail='MM_SAVE_INPUT'; end if;
 -- Lock all configuration sources before version/review checks. Short serialized
 -- cafe saves avoid phantom option inserts from legacy security-definer writers.
 -- No order table is locked; normal pricing reads continue.
 lock table public.categories,public.category_sections,public.products,public.product_sizes,
   public.option_groups,public.option_choices,public.product_option_groups,public.product_option_defaults,
   public.product_size_option_choice_compatibility,public.product_option_choice_price_overrides,
   public.product_option_choice_override_requirements,configuration_private.product_pricing_certifications
   in share row exclusive mode;
 select * into replay from menu_save_private.requests r where r.actor=actor and r.request_id=request_id;
 if found then
   if replay.request is distinct from p_request then raise exception 'This save request changed. Reload before saving.' using detail='MM_SAVE_KEY_CONFLICT'; end if;
   return replay.result;
 end if;
 fields:=p_request->'product'; sizes:=p_request->'sizes'; action:=p_request->>'action';
 if action is null or action not in ('save','publish','unpublish') or jsonb_typeof(fields) is distinct from 'object' then
   raise exception 'Please reload the editor and try again.' using detail='MM_SAVE_INPUT'; end if;
 if exists(select 1 from jsonb_object_keys(fields) k where k not in ('name','category_id','category_section_id','description','image_url','notes',
   'badge_labels','variant_group_name','is_available','is_sold_out','is_curv_pick','is_seasonal')) then
   raise exception 'Please reload the editor and try again.' using detail='MM_SAVE_INPUT'; end if;
 foreach key in array array['is_available','is_sold_out','is_curv_pick','is_seasonal'] loop
   if jsonb_typeof(fields->key) is distinct from 'boolean' then raise exception 'Please review the product settings.' using detail='MM_SAVE_INPUT'; end if;
 end loop;
 if nullif(btrim(fields->>'name'),'') is null then raise exception 'Enter a product name.' using detail='MM_SAVE_NAME'; end if;
 if jsonb_typeof(sizes) is distinct from 'array' then raise exception 'This product needs at least one size.' using detail='MM_SAVE_SIZES'; end if;
 if jsonb_array_length(sizes)=0 then
   raise exception 'This product needs at least one size.' using detail='MM_SAVE_SIZES'; end if;
 if exists(select 1 from jsonb_array_elements(sizes) x where nullif(x->>'price','') is null or (x->>'price')::numeric not between 0 and 999999.99 or (x->>'price')::numeric<>round((x->>'price')::numeric,2)) then
   raise exception 'Add a valid price before saving.' using detail='MM_SIZE_PRICE_INVALID'; end if;
 if not exists(select 1 from public.categories where id=(fields->>'category_id')::uuid and is_active) then
   raise exception 'Choose an available category.' using detail='MM_SAVE_CATEGORY'; end if;
 if nullif(fields->>'category_section_id','') is not null and not exists(select 1 from public.category_sections
   where id=(fields->>'category_section_id')::uuid and category_id=(fields->>'category_id')::uuid) then
   raise exception 'Choose a section in this category.' using detail='MM_SAVE_CATEGORY'; end if;
 if pid is not null then
   select * into old from public.products where id=pid for update;
   if not found or old.archived_at is not null then raise exception 'This product is no longer editable. Reload before saving.' using detail='MM_SAVE_MISSING'; end if;
   perform 1 from public.product_sizes where product_id=pid for update;
   if p_request->>'expected_version' is distinct from menu_save_private.editor_version(pid) then
     raise exception 'This product changed in another session. Reload before saving.' using detail='MM_SAVE_STALE'; end if;
   old_structure:=configuration_private.catalog_structure(pid);
   select expected_structure into reviewed from configuration_private.product_pricing_certifications where product_id=pid and structure_version=1;
   -- A price edit is not permission to bless unrelated pre-existing option drift.
   if (jsonb_array_length(old_structure->'assignments')>0 or reviewed is not null)
     and reviewed is distinct from old_structure and (action='publish' or (action='save' and old.is_published)) then
     raise exception 'Some customer options need attention. Your live product was not changed.' using detail='MM_SAVE_OPTIONS'; end if;
   -- Coverage validates existing tuples; it cannot infer the intended price for
   -- a NEW contextual size (e.g. cheese per piece count). Never certify that gap.
   if exists(select 1 from jsonb_array_elements(sizes) x where nullif(x->>'id','') is null)
     and (exists(select 1 from public.product_size_option_choice_compatibility where product_id=pid)
       or exists(select 1 from public.product_option_choice_price_overrides where product_id=pid and product_size_id is not null)
       or exists(select 1 from public.product_option_choice_override_requirements where product_id=pid and product_size_id is not null)) then
     raise exception 'New sizes need matching customer options before they can be added to this item.' using detail='MM_SAVE_SIZE_CONFIGURATION'; end if;
   for removed in select s.id from public.product_sizes s where s.product_id=pid and not exists(
     select 1 from jsonb_array_elements(sizes) x where x->>'id'=s.id::text) loop
     if exists(select 1 from pg_constraint where contype='f' and confrelid='public.product_sizes'::regclass
       and conrelid not in ('public.inventory_recipes'::regclass,'public.product_size_option_choice_compatibility'::regclass,
         'public.product_option_choice_price_overrides'::regclass,'public.product_option_choice_override_requirements'::regclass)) then
       raise exception 'This size has another dependency and cannot be removed yet.' using detail='MM_SAVE_SIZE_OPTIONS'; end if;
     if exists(select 1 from public.inventory_recipes where product_size_id=removed.id) then
       raise exception 'This size is used by a recipe and cannot be removed.' using detail='MM_SAVE_RECIPE'; end if;
     if exists(select 1 from public.product_size_option_choice_compatibility where product_size_id=removed.id)
       or exists(select 1 from public.product_option_choice_price_overrides where product_size_id=removed.id)
       or exists(select 1 from public.product_option_choice_override_requirements where product_size_id=removed.id) then
       raise exception 'This size is used by customer options and cannot be removed yet.' using detail='MM_SAVE_SIZE_OPTIONS'; end if;
   end loop;
 else
   if p_request->>'expected_version' is not null then raise exception 'Reload before creating this product.' using detail='MM_SAVE_INPUT'; end if;
   pid:=gen_random_uuid();
 end if;
 published:=case action when 'publish' then true when 'unpublish' then false else coalesce(old.is_published,false) end;
 -- Until public recipe expectations become data-driven, a zero-option product
 -- cannot adopt an existing specialized recipe name. Names frozen from the
 -- reviewed public recipe contract; regression test checks this list stays aligned.
 if published and not exists(select 1 from public.product_option_groups where product_id=pid and is_active)
   and regexp_replace(lower(btrim(fields->>'name')),'\s+',' ','g')=any(array['hojicha banana pudding latte','hojicha brûlée','hojicha latte','sea salt cream hojicha','pink hojicha latte','brown sugar cinnamon cream latte','cloud spanish oat latte','curv latte','curv seasalt latte','iced shaken vanilla jelly','seasalt dark latte','einspanner latte','spanish latte','caramel macchiato','vanilla latte','americano','cafè mocha','white chocolate mocha','white ube latte','cocoa caramel latte','double chocolate chip cream','javachip brownie curvccino','javachip jelly curvccino','strawberries & cream','white caramel curvccino','tropic kiss','tokyo sunrise','hibiscus cream tea','lime cucumber','og takoyaki','aburi salmon','oozie cheese','lava melt','classic veggie','salted egg','caffè mocha']) then
   raise exception 'This item needs customer options before it can be published.' using detail='MM_SAVE_OPTIONS';
 end if;
 insert into menu_save_private.active_save values(pg_backend_pid(),txid_current(),pid);
 if old.id is null then
   insert into public.products(id,category_id,name) values(pid,(fields->>'category_id')::uuid,btrim(fields->>'name'));
 end if;
 update public.products set name=btrim(fields->>'name'),category_id=(fields->>'category_id')::uuid,
   category_section_id=nullif(fields->>'category_section_id','')::uuid,description=fields->>'description',
   image_url=fields->>'image_url',notes=fields->>'notes',variant_group_name=fields->>'variant_group_name',
   badge_labels=coalesce(array(select jsonb_array_elements_text(fields->'badge_labels')),array[]::text[]),
   is_available=(fields->>'is_available')::boolean,is_sold_out=(fields->>'is_sold_out')::boolean,
   is_curv_pick=(fields->>'is_curv_pick')::boolean,is_seasonal=(fields->>'is_seasonal')::boolean,is_published=published where id=pid;
 -- Keep the reviewed reconciler, but ignore caller sort indexes: array order wins.
 select jsonb_agg(x.value||jsonb_build_object('sort_order',x.ordinality-1) order by x.ordinality) into sizes
   from jsonb_array_elements(sizes) with ordinality x;
 perform public.menu_manager_reconcile_product_sizes(pid,sizes);
 live:=published and (fields->>'is_available')::boolean and not (fields->>'is_sold_out')::boolean;
 if published or (reviewed is not null and reviewed=old_structure) then
   perform configuration_private.validate_product_coverage(pid);
   perform configuration_private.certify_product(pid,configuration_private.catalog_structure(pid),'Owner product save; actor '||actor::text||'; request '||request_id::text);
   if live then perform configuration_private.assert_pricing_ready(pid); end if;
 end if;
 delete from menu_save_private.active_save where backend=pg_backend_pid() and transaction_id=txid_current();
 result:=jsonb_build_object('ok',true,'product_id',pid,'is_published',published,'orderable',live,'version',menu_save_private.editor_version(pid));
 insert into menu_save_private.requests values(actor,request_id,p_request,result,clock_timestamp());
 return result;
 -- Exceptions unwind EVERY write above before exposing only safe messages.
exception
 when lock_not_available or deadlock_detected then raise exception 'Another menu change is being saved. Please try again.' using detail='MM_SAVE_BUSY';
 when invalid_text_representation or numeric_value_out_of_range then raise exception 'Please review the product values and try again.' using detail='MM_SAVE_INPUT';
end $$;

revoke all on all functions in schema menu_save_private from public,anon,authenticated;
revoke all on function public.menu_manager_get_product_editor(uuid),public.menu_manager_save_product(jsonb) from public,anon,authenticated;
grant execute on function public.menu_manager_get_product_editor(uuid),public.menu_manager_save_product(jsonb) to authenticated;
commit;
