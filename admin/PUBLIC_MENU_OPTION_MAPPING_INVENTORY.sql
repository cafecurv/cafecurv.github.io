-- CURV public product-option inventory: OWNER-RUN READ-ONLY DIAGNOSTIC.
-- Run the entire file in Supabase SQL Editor using the privileged postgres role.
-- Export EVERY result set, including empty sets, missing-object statuses and errors.
-- No catalog mutations, migrations, admin RPCs, pricing certification or order RPCs.
-- Real UUIDs are read from production; no UUID literals or generated IDs are used.
-- Optional D0A.1 objects are read only when present. A missing table is not an empty table.
-- Core catalog tables must match the local schema; if a core query fails, return the
-- error for review rather than repairing anything or interpreting it as zero rows.
-- READ ONLY protects all statements; REPEATABLE READ gives one consistent snapshot.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- 00: Execution context. Restricted roles can hide rows through RLS.
SELECT '00_CONTEXT' AS section, current_user AS execution_role,
       current_database() AS database_name,
       current_setting('transaction_read_only') AS read_only,
       current_setting('transaction_isolation') AS isolation,
       transaction_timestamp() AS snapshot_at;

-- 01: Object presence and exact deployed column inventory.
WITH objects(schema_name, object_name) AS (VALUES
  ('public','categories'), ('public','products'), ('public','product_sizes'),
  ('public','option_groups'), ('public','option_choices'),
  ('public','product_option_groups'), ('public','product_option_defaults'),
  ('public','product_option_choice_price_overrides'),
  ('public','product_size_option_choice_compatibility'),
  ('public','product_option_choice_override_requirements'),
  ('public','public_menu_option_groups'), ('public','public_menu_option_choices'),
  ('public','public_menu_option_defaults'),
  ('configuration_private','product_pricing_certifications')
)
SELECT '01_OBJECTS' AS section, o.schema_name, o.object_name,
       CASE WHEN c.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS status,
       c.relkind, c.relrowsecurity AS rls_enabled,
       (SELECT jsonb_agg(jsonb_build_object('column', a.attname,
          'type', format_type(a.atttypid,a.atttypmod), 'not_null',a.attnotnull)
          ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
FROM objects o
LEFT JOIN pg_catalog.pg_class c ON c.oid=to_regclass(format('%I.%I',o.schema_name,o.object_name))
ORDER BY o.schema_name,o.object_name;

-- A: All groups, including inactive groups. Names never determine group_key.
SELECT 'A_OPTION_GROUPS' AS section, g.id, g.name, g.group_key,
       g.selection_type, g.sort_order, g.is_active
FROM public.option_groups g
ORDER BY g.sort_order,g.name,g.id;

-- B: All choices, including inactive and unexpectedly orphaned choices.
SELECT 'B_OPTION_CHOICES' AS section, c.id, c.option_group_id,
       g.name AS group_name, g.group_key, g.is_active AS group_active,
       c.label AS choice_label, c.value AS choice_value,
       c.price_delta,c.sort_order,c.is_active
FROM public.option_choices c
LEFT JOIN public.option_groups g ON g.id=c.option_group_id
ORDER BY g.sort_order,g.name,c.sort_order,c.label,c.id;

-- C: All assignments. Optional metadata is read by actual column name from JSON.
SELECT 'C_PRODUCT_ASSIGNMENTS' AS section, a.id AS assignment_id,
       a.product_id,p.name AS product_name,cat.name AS category_name,
       a.option_group_id,g.name AS group_name,g.group_key,g.selection_type,
       g.is_active AS group_active,
       to_jsonb(a)->'is_required' AS is_required,
       to_jsonb(a)->'min_selections' AS min_selections,
       to_jsonb(a)->'max_selections' AS max_selections,
       to_jsonb(a)->'sort_order' AS sort_order,
       to_jsonb(a)->'is_active' AS assignment_active,
       to_jsonb(a) AS exact_assignment_row
FROM public.product_option_groups a
LEFT JOIN public.products p ON p.id=a.product_id
LEFT JOIN public.categories cat ON cat.id=p.category_id
LEFT JOIN public.option_groups g ON g.id=a.option_group_id
ORDER BY cat.sort_order,p.sort_order,p.name,a.product_id,
         (to_jsonb(a)->>'sort_order')::integer,g.name,a.id;

-- D: Defaults with activation/linkage context. No defaults are inferred.
SELECT 'D_PRODUCT_DEFAULTS' AS section, d.id AS default_id,
       d.product_id,p.name AS product_name,d.option_group_id,
       g.name AS group_name,g.group_key,g.is_active AS group_active,
       d.option_choice_id,c.label AS choice_label,c.value AS choice_value,
       c.price_delta AS global_choice_delta,c.is_active AS choice_active,
       c.option_group_id AS choice_actual_group_id,
       a.id AS assignment_id,to_jsonb(a)->'is_active' AS assignment_active
FROM public.product_option_defaults d
LEFT JOIN public.products p ON p.id=d.product_id
LEFT JOIN public.option_groups g ON g.id=d.option_group_id
LEFT JOIN public.option_choices c ON c.id=d.option_choice_id
LEFT JOIN public.product_option_groups a
  ON a.product_id=d.product_id AND a.option_group_id=d.option_group_id
ORDER BY p.name,d.product_id,g.name,c.label,d.id;

-- E: Optional contextual tables. query_to_xml executes ONLY the SELECT below;
-- XMLTABLE decodes each row back into JSON. There are no persistent helper objects.
-- Return both status and exact JSON rows. Inactive rows are deliberately included.
WITH objects(section, schema_name, table_name) AS (VALUES
  ('E1_PRICE_OVERRIDES','public','product_option_choice_price_overrides'),
  ('E2_SIZE_COMPATIBILITY','public','product_size_option_choice_compatibility'),
  ('E3_OVERRIDE_REQUIREMENTS','public','product_option_choice_override_requirements'),
  ('E4_PRICING_CERTIFICATIONS','configuration_private','product_pricing_certifications')
), snapshots AS MATERIALIZED (
  SELECT o.*,to_regclass(format('%I.%I',o.schema_name,o.table_name)) AS object_id,
    CASE WHEN to_regclass(format('%I.%I',o.schema_name,o.table_name)) IS NULL
      THEN XMLPARSE(DOCUMENT '<table/>')
      ELSE pg_catalog.query_to_xml(format(
        'SELECT row_to_json(t)::text AS record FROM %I.%I AS t',
        o.schema_name,o.table_name),false,false,'') END AS document
  FROM objects o
)
SELECT s.section,s.schema_name,s.table_name,
       CASE WHEN s.object_id IS NULL THEN 'MISSING'
            WHEN x.record IS NULL THEN 'PRESENT_EMPTY' ELSE 'PRESENT' END AS status,
       x.record::jsonb AS exact_row,
       p.name AS product_name,sz.label AS size_label,sz.product_id AS size_owner_product_id,
       g.id AS group_id,g.name AS group_name,g.group_key,
       c.label AS choice_label,c.value AS choice_value,c.price_delta AS global_choice_delta
FROM snapshots s
LEFT JOIN LATERAL XMLTABLE('/table/row' PASSING s.document
  COLUMNS record text PATH 'record') x ON true
LEFT JOIN public.products p ON p.id::text=x.record::jsonb->>'product_id'
LEFT JOIN public.product_sizes sz ON sz.id::text=x.record::jsonb->>'product_size_id'
LEFT JOIN public.option_choices c ON c.id::text=x.record::jsonb->>'option_choice_id'
LEFT JOIN public.option_groups g ON g.id=c.option_group_id
ORDER BY s.section,p.name,(x.record::jsonb->>'product_id'),sz.label,c.label,x.record;

-- F: Complete catalog, including excluded products for conflict diagnostics.
-- Every sellable product and every size is included; no price/label identity inference.
-- Products without sizes still appear with NULL size fields.
SELECT 'F_PRODUCT_SIZE_INVENTORY' AS section,p.id AS product_id,p.name AS product_name,
       p.category_id,cat.name AS category_name,cat.sort_order AS category_sort_order,
       to_jsonb(cat)->'is_active' AS category_active,
       p.is_available,p.is_published,
       to_jsonb(p)->'is_sold_out' AS is_sold_out,
       to_jsonb(p)->'archived_at' AS archived_at,
       to_jsonb(p)->'menu_group' AS menu_group,
       to_jsonb(p)->'variant_group_name' AS variant_group_name,
       p.sort_order AS product_sort_order,
       CASE WHEN cat.id IS NULL THEN 'CATEGORY_MISSING'
            WHEN NOT p.is_published THEN 'UNPUBLISHED'
            WHEN NOT p.is_available THEN 'UNAVAILABLE'
            WHEN COALESCE((to_jsonb(cat)->>'is_active')::boolean,false)=false THEN 'CATEGORY_INACTIVE_OR_UNKNOWN'
            WHEN to_jsonb(p)->>'archived_at' IS NOT NULL THEN 'ARCHIVED'
            WHEN COALESCE((to_jsonb(p)->>'is_sold_out')::boolean,false) THEN 'SOLD_OUT'
            WHEN sz.id IS NULL THEN 'NO_SIZE'
            ELSE 'SELLABLE_CANDIDATE' END AS catalog_state,
       sz.id AS product_size_id,sz.product_id AS size_owner_product_id,
       sz.label AS size_label,sz.price,sz.sort_order AS size_sort_order
FROM public.products p
LEFT JOIN public.categories cat ON cat.id=p.category_id
LEFT JOIN public.product_sizes sz ON sz.product_id=p.id
ORDER BY cat.sort_order,cat.name,p.sort_order,p.name,p.id,sz.sort_order,sz.label,sz.id;

-- G: Current LOCAL frontend expectations, NOT desired owner-approved assignments.
-- Name matching is only diagnostic; duplicate names return separate real UUIDs.
-- A missing key here can explain current fail-closed panels. Do NOT automatically
-- assign it: Curvccino Milk / Refresher Sauce conflict with the latest owner rules.
-- Extrapower and spicy may require owner review if their real groups are absent.
WITH local_recipes(product_name, recipe_family, expected_current_frontend_keys) AS (VALUES
    ('Curv Latte', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('Einspanner Latte', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('Spanish Latte', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('Caramel Macchiato', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('Vanilla Latte', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('White Chocolate Mocha', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('Caffè Mocha', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('Americano', 'Espresso', ARRAY['temperature', 'extrashot']::text[]),
    ('Cloud Spanish Oat Latte', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('Cocoa Caramel Latte', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('White Ube Latte', 'Espresso', ARRAY['temperature', 'extrashot', 'milk', 'syrup', 'sauce']::text[]),
    ('Einspanner Matcha', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Kagoshima Matcha Cream', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Banana Fudge Matcha Latte', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Cookie Crumb Matcha Latte', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Sea Salt Cream Matcha Latte', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('CS Matcha Oat Latte', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Strawberry Matcha Latte', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Pure Usucha', 'Matcha/Hojicha', ARRAY['extrapower']::text[]),
    ('Matcha Ube Latte', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Double Matcha Cloud', 'Matcha/Hojicha', ARRAY['sweetener', 'extrapower']::text[]),
    ('Matcha Sunrise', 'Matcha/Hojicha', ARRAY['milk', 'extrapower']::text[]),
    ('Hojicha Latte', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Sea Salt Cream Hojicha', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Pink Hojicha Latte', 'Matcha/Hojicha', ARRAY['milk', 'sweetener', 'extrapower']::text[]),
    ('Double Chocolate Chip Cream', 'Curvccino', ARRAY['milk', 'syrup', 'sauce', 'inclusions']::text[]),
    ('Javachip Brownie Curvccino', 'Curvccino', ARRAY['milk', 'syrup', 'sauce', 'inclusions']::text[]),
    ('Javachip Jelly Curvccino', 'Curvccino', ARRAY['milk', 'syrup', 'sauce', 'inclusions']::text[]),
    ('Strawberries & Cream', 'Curvccino', ARRAY['milk', 'syrup', 'sauce', 'inclusions']::text[]),
    ('White Caramel Curvccino', 'Curvccino', ARRAY['milk', 'syrup', 'sauce', 'inclusions']::text[]),
    ('Dragon Dreams', 'Refreshers', ARRAY['syrup', 'sauce']::text[]),
    ('Tropic Kiss', 'Refreshers', ARRAY['syrup', 'sauce']::text[]),
    ('Tokyo Sunrise', 'Refreshers', ARRAY['syrup', 'sauce']::text[]),
    ('Hibiscus Cream Tea', 'Refreshers', ARRAY['syrup', 'sauce']::text[]),
    ('Lime Cucumber', 'Refreshers', ARRAY['syrup', 'sauce']::text[]),
    ('OG Takoyaki', 'Takoyaki', ARRAY['spicy', 'addons', 'cheese']::text[]),
    ('Aburi Salmon', 'Takoyaki', ARRAY['spicy', 'addons', 'cheese']::text[]),
    ('Oozie Cheese', 'Takoyaki', ARRAY['spicy', 'addons', 'cheese']::text[]),
    ('Lava Melt', 'Takoyaki', ARRAY['spicy', 'addons', 'cheese']::text[]),
    ('Classic Veggie', 'Takoyaki', ARRAY['spicy', 'addons', 'cheese']::text[]),
    ('Salted Egg', 'Takoyaki', ARRAY['spicy', 'addons', 'cheese']::text[]),
    ('Shrimp Tempura', 'Savory', ARRAY['sauce_pref']::text[]),
    ('Chicken Karaage', 'Savory', ARRAY['sauce_pref']::text[]),
    ('Cream Dory Fillet', 'Savory', ARRAY['sauce_pref']::text[])
), mapped AS (
  SELECT r.*,p.id AS product_id,cat.name AS category_name,
         p.is_available,p.is_published,
         ARRAY(SELECT DISTINCT g.group_key
           FROM public.product_option_groups a
           JOIN public.option_groups g ON g.id=a.option_group_id
           WHERE a.product_id=p.id AND g.is_active
             AND COALESCE((to_jsonb(a)->>'is_active')::boolean,false)
           ORDER BY g.group_key) AS current_active_keys
  FROM local_recipes r
  LEFT JOIN public.products p ON lower(btrim(p.name))=lower(btrim(r.product_name))
  LEFT JOIN public.categories cat ON cat.id=p.category_id
)
SELECT 'G_CURRENT_FRONTEND_MAPPING_GAPS' AS section,product_name,recipe_family,
       product_id,category_name,is_available,is_published,
       expected_current_frontend_keys,current_active_keys,
       ARRAY(SELECT k FROM unnest(expected_current_frontend_keys) k
         WHERE NOT k=ANY(current_active_keys) ORDER BY k) AS missing_current_frontend_keys,
       CASE WHEN product_id IS NULL THEN 'PRODUCT_NOT_FOUND_BY_NAME'
            WHEN expected_current_frontend_keys <@ current_active_keys
              THEN 'EXPECTED_KEYS_PRESENT_NOT_FULL_VALIDATION'
            ELSE 'MISSING_CURRENT_FRONTEND_MAPPING_REVIEW_OWNER_RULES' END AS diagnostic_status
FROM mapped
ORDER BY recipe_family,product_name,product_id;

-- H: Exact duplicate signals; semantically different names still require review.
SELECT 'H_DUPLICATE_SIGNALS' AS section,'GROUP_KEY' AS kind,g.group_key AS duplicate_key,
       count(*) AS row_count,jsonb_agg(to_jsonb(g) ORDER BY g.id) AS exact_rows
FROM public.option_groups g GROUP BY g.group_key HAVING count(*)>1
UNION ALL
SELECT 'H_DUPLICATE_SIGNALS','GROUP_NAME_NORMALIZED',lower(btrim(g.name)),
       count(*),jsonb_agg(to_jsonb(g) ORDER BY g.id)
FROM public.option_groups g GROUP BY lower(btrim(g.name)) HAVING count(*)>1
UNION ALL
SELECT 'H_DUPLICATE_SIGNALS','CHOICE_LABEL_IN_GROUP',c.option_group_id::text||':'||lower(btrim(c.label)),
       count(*),jsonb_agg(to_jsonb(c) ORDER BY c.id)
FROM public.option_choices c GROUP BY c.option_group_id,lower(btrim(c.label)) HAVING count(*)>1
UNION ALL
SELECT 'H_DUPLICATE_SIGNALS','CHOICE_VALUE_IN_GROUP',c.option_group_id::text||':'||lower(btrim(c.value)),
       count(*),jsonb_agg(to_jsonb(c) ORDER BY c.id)
FROM public.option_choices c WHERE nullif(btrim(c.value),'') IS NOT NULL
GROUP BY c.option_group_id,lower(btrim(c.value)) HAVING count(*)>1
ORDER BY kind,duplicate_key;

-- I: Capture the deployed public projections; inactive filtering and key exposure
-- must be checked against this definition rather than inferred from admin names.
SELECT 'I_PUBLIC_OPTION_VIEW_DEFINITIONS' AS section,n.nspname AS schema_name,c.relname,
       c.reloptions,pg_catalog.pg_get_viewdef(c.oid,true) AS current_definition
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('v','m')
  AND c.relname IN ('public_menu_option_groups','public_menu_option_choices','public_menu_option_defaults')
ORDER BY c.relname;

COMMIT;
-- STOP: Return all results for review. No assignment/default/override write is approved.
