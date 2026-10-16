-- LOCAL PHASE 3B DRAFT. One reviewed installation; never rerun after success.
-- No seed/backfill, order mutation, public checkout replacement or shared-library writes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $preflight$
declare r record;
begin
 if exists(select 1 from pg_proc where pronamespace='menu_save_private'::regnamespace and proname in
 ('options_library','options_library_version','product_options','reconcile_options','validate_recipe','recipe_contract')) then
 raise exception 'Phase 3B collision. Review before retrying.' using detail='MM_3B_COLLISION'; end if;
 if to_regclass('public.product_option_choice_policies') is null or to_regprocedure('configuration_private.effective_product_choices(uuid)') is null then
 raise exception 'Install reviewed Phase 3A first.' using detail='MM_3B_PREREQUISITE'; end if;
 for r in select * from (values
('public.menu_manager_save_product(jsonb)','3e02ac189906159d4e34eafb30711e21'),
('public.menu_manager_get_product_editor(uuid)','d0a25a7f609635abfd30dfedaaa45a06'),
('menu_save_private.guard_catalog_write()','24535a55240c149a7e3b8fb58a40b3f5'),
('menu_save_private.editor_version(uuid)','6f151b9975830c8c10719d9b724ea913'),
('configuration_private.choice_allowed(uuid,uuid)','53ed6fea03e68f9e131a67d82168059f'),
('configuration_private.effective_choice_price(uuid,uuid,uuid)','b38c7b7b6374dfc9ec8b88e972b6dfba'),
('configuration_private.effective_product_choices(uuid)','7f2fa018292bf7648ad683ca0c3e2023'),
('configuration_private.catalog_structure(uuid)','f89c6fca109c3beb58c895d239479f96'),
('configuration_private.validate_product_coverage(uuid)','dfd56bd5984b49fb286a84b6e5378525'),
('configuration_private.price_order_configuration(jsonb)','a102ee368909e66581e0d9d80215cdcd')
 ) v(signature,source_md5) loop
 if not exists(select 1 from pg_proc where oid=to_regprocedure(r.signature) and proowner=current_user::regrole
 and md5(regexp_replace(prosrc,'\s+','','g'))=r.source_md5
 and prosecdef=(r.signature in ('public.menu_manager_save_product(jsonb)','public.menu_manager_get_product_editor(uuid)','menu_save_private.guard_catalog_write()'))
 and provolatile=case when r.signature in ('public.menu_manager_save_product(jsonb)','menu_save_private.guard_catalog_write()') then 'v'::"char" else 's'::"char" end
 and proconfig=case when r.signature='public.menu_manager_save_product(jsonb)' then array['search_path=pg_catalog','lock_timeout=3s'] else array['search_path=pg_catalog'] end) then
 raise exception 'Changed prerequisite: %',r.signature using detail='MM_3B_PREREQUISITE'; end if;
 end loop;
end $preflight$;

-- Stable installation snapshot: readers continue; concurrent catalog writes wait briefly.
lock table public.categories,public.category_sections,public.products,public.product_sizes,public.option_groups,public.option_choices,public.product_option_groups,public.product_option_defaults,public.product_option_choice_policies,public.product_size_option_choice_compatibility,public.product_option_choice_price_overrides,public.product_option_choice_override_requirements,configuration_private.product_pricing_certifications,menu_save_private.requests in share row exclusive mode;
create temporary table mm_3b_install_snapshot on commit drop as select jsonb_build_object('public.categories',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.categories x),
'public.category_sections',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.category_sections x),
'public.products',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.products x),
'public.product_sizes',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_sizes x),
'public.option_groups',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.option_groups x),
'public.option_choices',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.option_choices x),
'public.product_option_groups',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_groups x),
'public.product_option_defaults',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_defaults x),
'public.product_option_choice_policies',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_choice_policies x),
'public.product_size_option_choice_compatibility',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_size_option_choice_compatibility x),
'public.product_option_choice_price_overrides',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_choice_price_overrides x),
'public.product_option_choice_override_requirements',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_choice_override_requirements x),
'configuration_private.product_pricing_certifications',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from configuration_private.product_pricing_certifications x),
'menu_save_private.requests',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from menu_save_private.requests x)) as catalog;
create temporary table mm_3b_security_snapshot on commit drop as select oid,proowner,proacl,prosecdef,proconfig,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.menu_manager_save_product(jsonb)'::regprocedure,'public.menu_manager_get_product_editor(uuid)'::regprocedure,'public.quote_public_cart(jsonb)'::regprocedure,'public.submit_public_order_v2(jsonb)'::regprocedure);


-- Frozen public contract; static tests compare every approved UUID/name and Matcha rule to menu/index.html.
create function menu_save_private.recipe_contract() returns jsonb language sql immutable set search_path=pg_catalog as $$
 select $recipes$[{"id":"93e9a33b-1a37-4edf-9d26-5ddd2d87f87d","name":"hojicha banana pudding latte","keys":["extrapower","milk","sweetener"]},{"id":"e635744c-ed77-4924-a90d-c78440a81603","name":"hojicha brûlée","keys":["extrapower","milk","sweetener"]},{"id":"d053466a-2a52-420c-bc4c-62b5f614a27f","name":"hojicha latte","keys":["extrapower","milk","sweetener"]},{"id":"82417b58-d0c4-4d0d-a0cd-27da42b42627","name":"sea salt cream hojicha","keys":["extrapower","milk","sweetener"]},{"id":"6caefdb6-7daf-4e6d-a034-95fda0b7ecd7","name":"pink hojicha latte","keys":["extrapower","milk","sweetener"]},{"id":"e058ec46-f133-4982-afe6-cc6cf5e6d521","name":"brown sugar cinnamon cream latte","keys":["extrashot","milk","sauce","syrup"]},{"id":"8f072a83-552e-4e97-946d-9c306169415a","name":"cloud spanish oat latte","keys":["extrashot","milk","sauce","syrup"]},{"id":"ec0956f8-8d28-414f-be46-2349e92bef76","name":"curv latte","keys":["extrashot","milk","sauce","syrup","temperature"]},{"id":"7b59829b-b13b-4157-a0e8-ecb85bdbb8e4","name":"curv seasalt latte","keys":["extrashot","milk","sauce","syrup"]},{"id":"31886227-0130-45f7-8fb7-3d84682eed92","name":"iced shaken vanilla jelly","keys":["extrashot","milk","sauce","syrup"]},{"id":"57cd4f38-2e5f-41ba-a117-83f5b2c66819","name":"seasalt dark latte","keys":["extrashot","milk","sauce","syrup"]},{"id":"cbeecaec-e9a5-4faa-b8f3-75b0cae549dd","name":"einspanner latte","keys":["extrashot","milk","sauce","syrup","temperature"]},{"id":"7a258d7e-5b74-44c8-93af-38b1fbd92765","name":"spanish latte","keys":["extrashot","milk","sauce","syrup","temperature"]},{"id":"aa156151-540b-4beb-b924-d97bf210af95","name":"caramel macchiato","keys":["extrashot","milk","sauce","syrup","temperature"]},{"id":"54c6725f-4445-435c-bc1d-b779e5963796","name":"vanilla latte","keys":["extrashot","milk","sauce","syrup","temperature"]},{"id":"e684a6bd-aadc-4117-a018-ae0591c43d41","name":"americano","keys":["extrashot","temperature"]},{"id":"9c0d9e22-8843-4595-b789-7550c29890a4","name":"cafè mocha","keys":["extrashot","milk","sauce","syrup","temperature"]},{"id":"45b1f92c-0daa-4ed2-af55-c5da97315c0a","name":"white chocolate mocha","keys":["extrashot","milk","sauce","syrup","temperature"]},{"id":"3372a8c3-3208-4458-bb71-38c40c454436","name":"white ube latte","keys":["extrashot","milk","sauce","syrup"]},{"id":"c541decb-607c-44b1-8bed-4c19594c4422","name":"cocoa caramel latte","keys":["extrashot","milk","sauce","syrup"]},{"id":"8e1b82c6-8aea-4eb9-b591-184072c4f49e","name":"curv chocolate","keys":[]},{"id":"4ea4643e-5a61-402f-b9c4-8a29ae130c18","name":"ube cloud latte","keys":[]},{"id":"f9e87759-6aa9-4bce-8b8b-3081ec913c01","name":"berry cloud latte","keys":[]},{"id":"c26d3d79-38bf-4687-b3ca-eedfc1ed0e86","name":"double chocolate chip cream","keys":["inclusions","sauce","syrup"]},{"id":"56ca858c-58da-4ee3-9954-d189390cefb8","name":"javachip brownie curvccino","keys":["inclusions","sauce","syrup"]},{"id":"52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6","name":"javachip jelly curvccino","keys":["inclusions","sauce","syrup"]},{"id":"8a078f3e-872d-47e0-a1df-c14f33af64c2","name":"strawberries & cream","keys":["inclusions","sauce","syrup"]},{"id":"dd5face3-df84-47ae-8ce1-9e2b565a91dd","name":"white caramel curvccino","keys":["inclusions","sauce","syrup"]},{"id":"f716d196-47f0-46f4-af7e-bda068b95b2d","name":"tropic kiss","keys":["syrup"]},{"id":"483eed35-dd1d-4a87-90a6-2161b3d1ef86","name":"tokyo sunrise","keys":["syrup"]},{"id":"ab350883-08eb-4b3a-b45a-03bb11f509a3","name":"hibiscus cream tea","keys":["syrup"]},{"id":"9eba0285-c567-4d8d-960a-4f2bed4a6bd7","name":"lime cucumber","keys":["syrup"]},{"id":"24007d6c-e175-4dcf-9a6f-aab076e07b98","name":"og takoyaki","keys":["addons","cheese","spicy"]},{"id":"ff9e0d6f-2a1b-4b6b-a401-e02370224f39","name":"aburi salmon","keys":["addons","cheese","spicy"]},{"id":"29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5","name":"chicken karaage","keys":[]},{"id":"a33f5d5a-fde1-4eb4-8604-1637b4afbf9a","name":"cream dory fillet","keys":[]},{"id":"c027eedc-1807-4574-8f14-79ce07bb544e","name":"oozie cheese","keys":["addons","cheese","spicy"]},{"id":"c1f44003-500d-46aa-9fe6-9bbf35c57415","name":"lava melt","keys":["addons","cheese","spicy"]},{"id":"610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f","name":"classic veggie","keys":["addons","cheese","spicy"]},{"id":"2c218e48-9871-41a3-bb12-19ced7b38321","name":"salted egg","keys":["addons","cheese","spicy"]},{"id":"5498a571-8404-4a4f-a380-9cc0eaefc67c","name":"cheese katsu bowl","keys":[]},{"id":"f4253ada-f15f-4fee-abea-c7678cd1fc06","name":"pork katsu bowl","keys":[]},{"id":"5f5de117-2b8f-42d5-8b66-78f20339f544","name":"chicken bowl","keys":[]},{"id":null,"name":"einspanner matcha","keys":["extrapower","milk","sweetener"]},{"id":null,"name":"kagoshima matcha cream","keys":["extrapower","milk","sweetener"]},{"id":null,"name":"banana fudge matcha latte","keys":["extrapower","milk","sweetener"]},{"id":null,"name":"cookie crumb matcha latte","keys":["extrapower","milk","sweetener"]},{"id":null,"name":"sea salt cream matcha latte","keys":["extrapower","milk","sweetener"]},{"id":null,"name":"cs matcha oat latte","keys":["extrapower","milk","sweetener"]},{"id":null,"name":"strawberry matcha latte","keys":["extrapower","milk","sweetener"]},{"id":null,"name":"pure usucha","keys":["extrapower"]},{"id":null,"name":"matcha ube latte","keys":["extrapower","milk","sweetener"]},{"id":null,"name":"double matcha cloud","keys":["extrapower","sweetener"]},{"id":null,"name":"matcha sunrise","keys":["extrapower","milk"]},{"id":null,"name":"caffè mocha","keys":["extrashot","milk","sauce","syrup","temperature"]},{"id":null,"name":"shrimp tempura","keys":[]}]$recipes$::jsonb;
$$;
create function menu_save_private.validate_recipe(p_id uuid) returns void language plpgsql stable set search_path=pg_catalog as $$
declare expected jsonb; actual jsonb; product_name text;
begin
 select regexp_replace(lower(btrim(name)),'\s+',' ','g') into product_name from public.products where id=p_id;
 select x->'keys' into expected from jsonb_array_elements(menu_save_private.recipe_contract()) x
 where x->>'id'=p_id::text or x->>'name'=product_name order by (x->>'id'=p_id::text) desc nulls last limit 1;
 select coalesce(jsonb_agg(k order by k),'[]'::jsonb) into actual from (
 select case g.group_key when 'beverage_temperature' then 'temperature' when 'extra_shot' then 'extrashot'
 when 'sinkers' then 'inclusions' when 'sauce_beverage' then 'sauce' when 'garnish' then 'addons' when 'add_cheese' then 'cheese' else g.group_key end k
 from public.product_option_groups a join public.option_groups g on g.id=a.option_group_id where a.product_id=p_id and a.is_active) q;
 if exists(select 1 from jsonb_array_elements_text(actual) k where k in ('size','pieces','note'))
 or (select count(*)<>count(distinct k) from jsonb_array_elements_text(actual) k) then
 raise exception 'Use each customer option once, separate from sizes and special requests.' using detail='MM_OPTIONS_RECIPE'; end if;
 if exists(select 1 from public.product_option_groups a join public.option_groups g on g.id=a.option_group_id
 join public.option_choices c on c.option_group_id=g.id where a.product_id=p_id and a.is_active
 and g.group_key='temperature' and configuration_private.choice_allowed(p_id,c.id) and not exists(
 select 1 from public.product_size_option_choice_compatibility t where t.product_id=p_id and t.option_choice_id=c.id and t.is_active)) then
 raise exception 'Every available temperature needs a serving size.' using detail='MM_OPTIONS_TEMPERATURE_SIZE'; end if;
 if expected is null then return; end if;
 if actual is distinct from expected then raise exception 'This option setup does not match this menu item.' using detail='MM_OPTIONS_RECIPE'; end if;
end $$;
create function menu_save_private.options_library() returns jsonb language sql stable set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('choices',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.id)
 from public.option_choices c where c.option_group_id=g.id and c.is_active),'[]'::jsonb),'used_by',
 (select count(*) from public.product_option_groups a where a.option_group_id=g.id and a.is_active)) order by g.sort_order,g.name,g.id),'[]'::jsonb)
 from public.option_groups g where g.is_active;
$$;
create function menu_save_private.options_library_version() returns text language sql stable set search_path=pg_catalog as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('groups',(select jsonb_agg(to_jsonb(g) order by id) from public.option_groups g),
 'choices',(select jsonb_agg(to_jsonb(c) order by id) from public.option_choices c))::text,'UTF8'),'sha256'),'hex');
$$;
create function menu_save_private.product_options(p_id uuid) returns jsonb language sql stable set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('option_group_id',a.option_group_id,'is_required',a.is_required,
 'min_selections',a.min_selections,'max_selections',a.max_selections,'choices',coalesce((
 select jsonb_agg(jsonb_build_object('option_choice_id',c.id,'enabled',configuration_private.choice_allowed(p_id,c.id),
 'default',exists(select 1 from public.product_option_defaults d where d.product_id=p_id and d.option_choice_id=c.id),
 'product_price_delta',(select o.price_delta from public.product_option_choice_price_overrides o where o.product_id=p_id and o.option_choice_id=c.id and o.product_size_id is null and o.is_active),
 'price_by_size',coalesce((select jsonb_object_agg(o.product_size_id,o.price_delta) from public.product_option_choice_price_overrides o where o.product_id=p_id and o.option_choice_id=c.id and o.product_size_id is not null and o.is_active),'{}'::jsonb)) order by c.sort_order,c.id)
 from public.option_choices c where c.option_group_id=a.option_group_id and c.is_active),'[]'::jsonb),
 'compatibility',coalesce((select jsonb_object_agg(t.product_size_id,t.ids) from (select t.product_size_id,jsonb_agg(t.option_choice_id order by t.option_choice_id) ids
 from public.product_size_option_choice_compatibility t join public.option_choices c on c.id=t.option_choice_id where t.product_id=p_id and c.option_group_id=a.option_group_id and t.is_active group by t.product_size_id) t),'{}'::jsonb)) order by a.sort_order,a.option_group_id),'[]'::jsonb)
 from public.product_option_groups a where a.product_id=p_id and a.is_active;
$$;

create or replace function menu_save_private.editor_version(p_id uuid) returns text
language sql stable set search_path=pg_catalog as $$
 select encode(extensions.digest(convert_to(jsonb_build_object(
   'options_library',menu_save_private.options_library_version(),'product',to_jsonb(p),'structure',configuration_private.catalog_structure(p.id),
   'category',(select to_jsonb(c) from public.categories c where c.id=p.category_id),
   'section',(select to_jsonb(s) from public.category_sections s where s.id=p.category_section_id),
   'review',(select to_jsonb(r) from configuration_private.product_pricing_certifications r where r.product_id=p.id)
 )::text,'UTF8'),'sha256'),'hex') from public.products p where p.id=p_id;
$$;
create or replace function menu_save_private.guard_catalog_write() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare target uuid;
begin
 -- Display order is not part of pricing; preserve the existing narrow UI path.
 if TG_TABLE_NAME='products' and TG_OP='UPDATE' then
   if (to_jsonb(NEW)-'sort_order'-'updated_at')=(to_jsonb(OLD)-'sort_order'-'updated_at') then return NEW; end if;
 end if;
 if TG_TABLE_NAME in ('products','product_sizes','product_option_groups','product_option_defaults','product_option_choice_policies',
 'product_size_option_choice_compatibility','product_option_choice_price_overrides','product_option_choice_override_requirements') then
 if TG_OP='DELETE' then target:=(to_jsonb(OLD)->>case when TG_TABLE_NAME='products' then 'id' else 'product_id' end)::uuid;
 else target:=(to_jsonb(NEW)->>case when TG_TABLE_NAME='products' then 'id' else 'product_id' end)::uuid;
 if TG_OP='UPDATE' and (to_jsonb(OLD)->>case when TG_TABLE_NAME='products' then 'id' else 'product_id' end)::uuid is distinct from target then
 raise exception 'Reload the product before saving.' using detail='MM_SAVE_BOUNDARY'; end if;
 end if;
 end if;
 if target is not null and exists(select 1 from menu_save_private.active_save
   where backend=pg_backend_pid() and transaction_id=txid_current() and product_id=target) then
   if TG_OP='DELETE' then return OLD; end if; return NEW;
 end if;
 raise exception 'Use the product editor to save. Customer option editing is temporarily read-only.' using detail='MM_SAVE_BOUNDARY';
end $$;

create function menu_save_private.reconcile_options(p_id uuid,p_options jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare item jsonb; choice jsonb; g public.option_groups%rowtype; gid uuid; cid uuid; sid uuid;
 member record; amount numeric; row_id uuid; n integer; minimum integer; maximum integer;
begin
 if jsonb_typeof(p_options) is distinct from 'array' or octet_length(p_options::text)>262144 then
 raise exception 'Please reload the option sets and try again.' using detail='MM_OPTIONS_INPUT'; end if;
 if jsonb_array_length(p_options)>32 or (select count(*)<>count(distinct x->>'option_group_id') from jsonb_array_elements(p_options) x) then
 raise exception 'Use each option set once.' using detail='MM_OPTIONS_INPUT'; end if;
 for item in select value from jsonb_array_elements(p_options) loop
 if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in
 ('option_group_id','is_required','min_selections','max_selections','choices','compatibility')) then
 raise exception 'Please review this option set.' using detail='MM_OPTIONS_INPUT'; end if;
 gid:=(item->>'option_group_id')::uuid;
 select * into g from public.option_groups where id=gid and is_active;
 if not found then raise exception 'This option set is no longer available. Reload before saving.' using detail='MM_OPTIONS_INPUT'; end if;
 if jsonb_typeof(item->'is_required') is distinct from 'boolean' or jsonb_typeof(item->'min_selections') is distinct from 'number'
 or not (jsonb_typeof(item->'max_selections') in ('number','null')) is true
 or jsonb_typeof(item->'choices') is distinct from 'array' or jsonb_typeof(item->'compatibility') is distinct from 'object' then
 raise exception 'Please review this option set.' using detail='MM_OPTIONS_INPUT'; end if;
 minimum:=(item->>'min_selections')::integer; maximum:=(item->>'max_selections')::integer;
 if (item->>'min_selections')::numeric<>minimum or (maximum is not null and (item->>'max_selections')::numeric<>maximum)
 or minimum<0 or minimum>64 or (maximum is not null and (maximum<minimum or maximum>64))
 or (g.selection_type='single' and (minimum>1 or coalesce(maximum,1)<>1)) then
 raise exception 'Please review how many choices customers can select.' using detail='MM_OPTIONS_INPUT'; end if;
 select count(*) into n from public.option_choices where option_group_id=gid and is_active;
 if n=0 or n>64 or jsonb_array_length(item->'choices')<>n
 or (select count(*)<>count(distinct c->>'option_choice_id') from jsonb_array_elements(item->'choices') c) then
 raise exception 'The available choices changed. Reload before saving.' using detail='MM_OPTIONS_INPUT'; end if;
 if g.group_key<>'temperature' and item->'compatibility'<>'{}'::jsonb then
 raise exception 'Size availability is supported for Temperature only.' using detail='MM_OPTIONS_INPUT'; end if;
 -- Validate maps before casts/mutations; exact same-product sizes only.
 for member in select * from jsonb_each(item->'compatibility') loop
 sid:=member.key::uuid;
 if not exists(select 1 from public.product_sizes where id=sid and product_id=p_id) or jsonb_typeof(member.value) is distinct from 'array' then
 raise exception 'Choose sizes belonging to this product.' using detail='MM_OPTIONS_INPUT'; end if;
 if (select count(*)<>count(distinct x) from jsonb_array_elements_text(member.value) x) then
 raise exception 'Use each temperature once for a size.' using detail='MM_OPTIONS_INPUT'; end if;
 if exists(select 1 from jsonb_array_elements_text(member.value) x where not exists(select 1 from jsonb_array_elements(item->'choices') c
 where c->>'option_choice_id'=x and c->'enabled'='true'::jsonb)) then
 raise exception 'Only available choices can be used for a size.' using detail='MM_OPTIONS_INPUT'; end if;
 end loop;
 insert into public.product_option_groups(product_id,option_group_id,is_required,min_selections,max_selections,sort_order,is_active)
 values(p_id,gid,(item->>'is_required')::boolean,minimum,maximum,
 (select ordinality-1 from jsonb_array_elements(p_options) with ordinality x where x.value=item),true)
 on conflict(product_id,option_group_id) do update set is_required=excluded.is_required,min_selections=excluded.min_selections,
 max_selections=excluded.max_selections,sort_order=excluded.sort_order,is_active=true;
 for choice in select value from jsonb_array_elements(item->'choices') loop
 if jsonb_typeof(choice) is distinct from 'object' or exists(select 1 from jsonb_object_keys(choice) k where k not in
 ('option_choice_id','enabled','default','product_price_delta','price_by_size'))
 or jsonb_typeof(choice->'enabled') is distinct from 'boolean' or jsonb_typeof(choice->'default') is distinct from 'boolean'
 or jsonb_typeof(choice->'price_by_size') is distinct from 'object' or not (choice ? 'product_price_delta') then
 raise exception 'Please review the choices and additional charges.' using detail='MM_OPTIONS_INPUT'; end if;
 cid:=(choice->>'option_choice_id')::uuid;
 if not exists(select 1 from public.option_choices where id=cid and option_group_id=gid and is_active) then
 raise exception 'A choice no longer belongs to this option set. Reload before saving.' using detail='MM_OPTIONS_INPUT'; end if;
 if not (choice->>'enabled')::boolean and ((choice->>'default')::boolean or choice->'product_price_delta'<>'null'::jsonb or choice->'price_by_size'<>'{}'::jsonb) then
 raise exception 'Remove the default and additional charges before disabling this choice.' using detail='MM_OPTIONS_INPUT'; end if;
 -- Existing required contextual coverage cannot disappear through an incomplete payload.
 if (choice->>'enabled')::boolean and exists(select 1 from public.product_option_choice_override_requirements r
 where r.product_id=p_id and r.option_choice_id=cid and
 ((r.product_size_id is null and choice->'product_price_delta'='null'::jsonb)
 or (r.product_size_id is not null and not (choice->'price_by_size' ? r.product_size_id::text)))) then
 raise exception 'Add a price for every required size before saving.' using detail='MM_OPTIONS_PRICE'; end if;
 if (choice->>'enabled')::boolean and g.group_key in ('cheese','add_cheese')
 and exists(select 1 from public.option_choices where id=cid and value='yes')
 and exists(select 1 from menu_save_private.recipe_contract() r, jsonb_array_elements(r) x
 join public.products p on p.id=p_id where (x->>'id'=p.id::text or x->>'name'=lower(btrim(p.name))) and x->'keys' ? 'cheese')
 and choice->'price_by_size'='{}'::jsonb then
 raise exception 'Add a cheese charge for every size before saving.' using detail='MM_OPTIONS_PRICE'; end if;
 if choice->'price_by_size'<>'{}'::jsonb and (select count(*) from jsonb_object_keys(choice->'price_by_size'))<>(select count(*) from public.product_sizes where product_id=p_id) then
 raise exception 'Add a price for every size before saving.' using detail='MM_OPTIONS_PRICE'; end if;
 for member in select key,value from jsonb_each(choice->'price_by_size') union all select '',choice->'product_price_delta' loop
 if member.key<>'' and not exists(select 1 from public.product_sizes where id=member.key::uuid and product_id=p_id) then
 raise exception 'Choose sizes belonging to this product.' using detail='MM_OPTIONS_INPUT'; end if;
 if member.value='null'::jsonb and member.key='' then continue; end if;
 if jsonb_typeof(member.value) not in ('number','string') then raise exception 'Enter a valid additional charge.' using detail='MM_OPTIONS_PRICE'; end if;
 amount:=(member.value#>>'{}')::numeric;
 if not (amount>=0 and amount<=999999.99 and amount=round(amount,2)) then raise exception 'Enter a valid additional charge.' using detail='MM_OPTIONS_PRICE'; end if;
 end loop;
 if not (choice->>'enabled')::boolean or exists(select 1 from public.product_option_choice_policies where product_id=p_id and option_choice_id=cid) then
 insert into public.product_option_choice_policies values(p_id,gid,cid,(choice->>'enabled')::boolean)
 on conflict(product_id,option_choice_id) do update set is_enabled_for_product=excluded.is_enabled_for_product;
 end if;
 delete from public.product_option_defaults where product_id=p_id and option_choice_id=cid and not (choice->>'default')::boolean;
 if (choice->>'default')::boolean then insert into public.product_option_defaults(product_id,option_group_id,option_choice_id)
 values(p_id,gid,cid) on conflict(product_id,option_group_id,option_choice_id) do nothing; end if;
 update public.product_option_choice_price_overrides set is_active=false where product_id=p_id and option_choice_id=cid and is_active and
 (not (choice->>'enabled')::boolean or (product_size_id is null and choice->'product_price_delta'='null'::jsonb)
 or (product_size_id is not null and not (choice->'price_by_size' ? product_size_id::text)));
 update public.product_option_choice_override_requirements set is_active=false where product_id=p_id and option_choice_id=cid and is_active and
 (not (choice->>'enabled')::boolean or (product_size_id is null and choice->'product_price_delta'='null'::jsonb)
 or (product_size_id is not null and not (choice->'price_by_size' ? product_size_id::text)));
 for member in select key,value from jsonb_each(choice->'price_by_size') union all select '',choice->'product_price_delta' where choice->'product_price_delta'<>'null'::jsonb loop
 sid:=nullif(member.key,'')::uuid; amount:=(member.value#>>'{}')::numeric;
 select id into row_id from public.product_option_choice_price_overrides where product_id=p_id and option_choice_id=cid and product_size_id is not distinct from sid order by is_active desc,id limit 1;
 if found then update public.product_option_choice_price_overrides set price_delta=amount,is_active=true where id=row_id;
 else insert into public.product_option_choice_price_overrides(product_id,option_choice_id,product_size_id,price_delta) values(p_id,cid,sid,amount); end if;
 if sid is null then
 update public.product_option_choice_override_requirements set is_active=true where product_id=p_id and option_choice_id=cid and product_size_id is null;
 else
 select id into row_id from public.product_option_choice_override_requirements where product_id=p_id and option_choice_id=cid and product_size_id=sid order by is_active desc,id limit 1;
 if found then update public.product_option_choice_override_requirements set is_active=true where id=row_id;
 else insert into public.product_option_choice_override_requirements(product_id,option_choice_id,product_size_id,specificity) values(p_id,cid,sid,'size'); end if;
 end if;
 end loop;
 end loop;
 update public.product_size_option_choice_compatibility t set is_active=false where t.product_id=p_id and exists(select 1 from public.option_choices c where c.id=t.option_choice_id and c.option_group_id=gid)
 and not coalesce((item->'compatibility'->t.product_size_id::text) ? t.option_choice_id::text,false);
 for member in select * from jsonb_each(item->'compatibility') loop
 for cid in select value::uuid from jsonb_array_elements_text(member.value) loop
 insert into public.product_size_option_choice_compatibility values(p_id,member.key::uuid,cid,true)
 on conflict(product_id,product_size_id,option_choice_id) do update set is_active=true;
 end loop;
 end loop;
 end loop;
 -- Retire removed attachments and all active dependents; never delete shared data.
 for gid in select option_group_id from public.product_option_groups a where a.product_id=p_id and not exists(select 1 from jsonb_array_elements(p_options) x where x->>'option_group_id'=a.option_group_id::text) loop
 delete from public.product_option_defaults where product_id=p_id and option_group_id=gid;
 update public.product_size_option_choice_compatibility t set is_active=false where product_id=p_id and exists(select 1 from public.option_choices c where c.id=t.option_choice_id and c.option_group_id=gid);
 update public.product_option_choice_price_overrides t set is_active=false where product_id=p_id and exists(select 1 from public.option_choices c where c.id=t.option_choice_id and c.option_group_id=gid);
 update public.product_option_choice_override_requirements t set is_active=false where product_id=p_id and exists(select 1 from public.option_choices c where c.id=t.option_choice_id and c.option_group_id=gid);
 update public.product_option_groups set is_active=false where product_id=p_id and option_group_id=gid;
 end loop;
end $$;

create or replace function public.menu_manager_save_product(p_request jsonb) returns jsonb
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
   where k not in ('request_id','product_id','expected_version','action','product','sizes','options')) then
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
   public.product_option_choice_override_requirements,public.product_option_choice_policies,configuration_private.product_pricing_certifications
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
   if (p_request ? 'options' and p_request->>'expected_version' is distinct from menu_save_private.options_library_version()) or (not (p_request ? 'options') and p_request->>'expected_version' is not null) then raise exception 'Reload before creating this product.' using detail='MM_SAVE_INPUT'; end if;
   pid:=gen_random_uuid();
 end if;
 published:=case action when 'publish' then true when 'unpublish' then false else coalesce(old.is_published,false) end;
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
 if p_request ? 'options' then perform menu_save_private.reconcile_options(pid,p_request->'options'); end if;
 if published or p_request ? 'options' then perform menu_save_private.validate_recipe(pid); end if;
 live:=published and (fields->>'is_available')::boolean and not (fields->>'is_sold_out')::boolean;
 if p_request ? 'options' then perform configuration_private.validate_product_coverage(pid); end if;
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
 when check_violation or foreign_key_violation or unique_violation then raise exception 'Please review the option choices, defaults and prices.' using detail='MM_OPTIONS_INPUT';
 when lock_not_available or deadlock_detected then raise exception 'Another menu change is being saved. Please try again.' using detail='MM_SAVE_BUSY';
 when raise_exception then
   if SQLERRM in ('Group/choice coverage invalid','Default coverage invalid','Temperature coverage invalid','Default has no active assignment','Invalid temperature tuple','Contextual price coverage missing','Override has no active assignment') then
     raise exception 'Please review available choices, defaults, sizes and prices.' using detail='MM_OPTIONS_INPUT';
   end if; raise;
 when invalid_text_representation or numeric_value_out_of_range then raise exception 'Please review the product values and try again.' using detail='MM_SAVE_INPUT';
end $$;
create or replace function public.menu_manager_get_product_editor(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then
   raise exception 'Owner access is required to edit products.' using detail='MM_SAVE_AUTH';
 end if;
 if p_product_id is null then return jsonb_build_object('product',null,'version',menu_save_private.options_library_version(),'options_version',1,'options','[]'::jsonb,'options_library',menu_save_private.options_library(),'option_recipes',menu_save_private.recipe_contract()); end if;
 return (select jsonb_build_object('product',to_jsonb(p)||jsonb_build_object('product_sizes',
   coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order,s.id) from public.product_sizes s where s.product_id=p.id),'[]'::jsonb)),
   'option_recipes',menu_save_private.recipe_contract(),'options_version',1,'options',menu_save_private.product_options(p.id),'options_library',menu_save_private.options_library(),'version',menu_save_private.editor_version(p.id),
   'option_configuration',jsonb_build_object('structure',configuration_private.catalog_structure(p.id),
     'choices',coalesce((select jsonb_agg(to_jsonb(e) order by e.option_group_id,e.sort_order,e.option_choice_id)
       from configuration_private.effective_product_choices(p.id) e),'[]'::jsonb))) from public.products p where p.id=p_product_id and p.archived_at is null);
end $$;
revoke all on function menu_save_private.recipe_contract(),menu_save_private.validate_recipe(uuid),menu_save_private.options_library(),
 menu_save_private.options_library_version(),menu_save_private.product_options(uuid),menu_save_private.reconcile_options(uuid,jsonb) from public,anon,authenticated;
do $postflight$
begin
 if (select catalog from mm_3b_install_snapshot) is distinct from jsonb_build_object('public.categories',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.categories x),
'public.category_sections',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.category_sections x),
'public.products',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.products x),
'public.product_sizes',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_sizes x),
'public.option_groups',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.option_groups x),
'public.option_choices',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.option_choices x),
'public.product_option_groups',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_groups x),
'public.product_option_defaults',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_defaults x),
'public.product_option_choice_policies',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_choice_policies x),
'public.product_size_option_choice_compatibility',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_size_option_choice_compatibility x),
'public.product_option_choice_price_overrides',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_choice_price_overrides x),
'public.product_option_choice_override_requirements',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.product_option_choice_override_requirements x),
'configuration_private.product_pricing_certifications',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from configuration_private.product_pricing_certifications x),
'menu_save_private.requests',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from menu_save_private.requests x)) then
 raise exception 'Phase 3B installation changed catalog data.' using detail='MM_3B_PRESERVATION'; end if;
 if exists(select 1 from mm_3b_security_snapshot b left join pg_proc p on p.oid=b.oid
 where p.oid is null or p.proowner<>b.proowner or p.proacl is distinct from b.proacl or p.prosecdef is distinct from b.prosecdef
 or p.proconfig is distinct from b.proconfig or (p.proname in ('quote_public_cart','submit_public_order_v2') and pg_get_functiondef(p.oid)<>b.definition)) then
 raise exception 'Phase 3B installation changed security or checkout contracts.' using detail='MM_3B_PRESERVATION'; end if;
end $postflight$;
commit;
