BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';

WITH
expected_functions(
  phase, schema_name, function_name, identity_args, input_names,
  return_type, returns_set, language_name, volatility,
  security_definer, strict, expected_config, body_md5, public_rpc
) AS (
  VALUES
  ('D0B2','submission_private','reject','text',ARRAY['p_code'],
   'void',false,'plpgsql','v',false,false,ARRAY['search_path=pg_catalog'],
   'a3c353401ba2f3cd28fe7e1f7e3c3fab',false),
  ('D0B2','submission_private','text_value','jsonb, integer',ARRAY['p_value','p_limit'],
   'text',false,'plpgsql','i',false,false,ARRAY['search_path=pg_catalog'],
   '949adbdf08db41a22147ea6dfb238529',false),
  ('D0B2','submission_private','uuid_value','jsonb',ARRAY['p_value'],
   'uuid',false,'plpgsql','i',false,false,ARRAY['search_path=pg_catalog'],
   '0fc1edc677bb44ae4b13e5e4012629b3',false),
  ('D0B2','submission_private','normalize_phone_v2','text',ARRAY['p_phone'],
   'text',false,'sql','i',false,true,ARRAY['search_path=pg_catalog'],
   '222da931a6da26bc42a3ada3d2c92639',false),
  ('D0B2','submission_private','canonicalize_v2_intent','jsonb',ARRAY['p_payload'],
   'jsonb',false,'plpgsql','s',false,false,
   ARRAY['search_path=pg_catalog','timezone=utc','datestyle=iso, ymd'],
   '31b396fe48384a1ef865882387a391fb',false),
  ('D0B2','submission_private','fingerprint_v2_intent','jsonb',ARRAY['p_payload'],
   'text',false,'sql','s',false,false,ARRAY['search_path=pg_catalog'],
   '14f23258f6e702446275be352a0f7d2f',false),
  ('D0B2','submission_private','fingerprint_v1_payload','jsonb',ARRAY['p_payload'],
   'text',false,'plpgsql','i',false,false,ARRAY['search_path=pg_catalog'],
   '12a6f5ee3be12e84e287b425f5b50c2c',false),
  ('D0B2','submission_private','lock_submission_key','uuid',ARRAY['p_key'],
   'void',false,'plpgsql','v',false,false,ARRAY['search_path=pg_catalog'],
   'fd592fe062a82f75301424d38d75d7f4',false),
  ('D0B2','submission_private','replay_or_prepare','jsonb',ARRAY['p_request'],
   'jsonb',false,'plpgsql','v',false,false,ARRAY['search_path=pg_catalog'],
   '555b7db925131e10905ad05f5ea3dfde',false),

  ('D0B3','configuration_private','pricing_error','text',ARRAY['p_code'],
   'void',false,'plpgsql','i',false,false,ARRAY['search_path=pg_catalog'],
   'ef85b7c32a33b5b3d25e845eb8ce57ce',false),
  ('D0B3','configuration_private','pricing_input_lines','jsonb',ARRAY['p_items'],
   'record',true,'plpgsql','i',false,false,ARRAY['search_path=pg_catalog'],
   '1d57631dc4b57e43d60c582ef466d619',false),
  ('D0B3','configuration_private','price_order_configuration','jsonb',ARRAY['p_items'],
   'jsonb',false,'plpgsql','s',false,false,ARRAY['search_path=pg_catalog'],
   '77afaf26d3ca4223dcb735fff1ca823d',false),

  ('D0B4','configuration_private','customer_pricing_review','jsonb',ARRAY['p_pricing'],
   'jsonb',false,'sql','i',false,false,ARRAY['search_path=pg_catalog'],
   '83d5c59c387583ed2f2d0148c0589506',false),
  ('D0B4','public','quote_public_cart','jsonb',ARRAY['p_request'],
   'jsonb',false,'plpgsql','s',true,false,ARRAY['search_path=pg_catalog'],
   'c5b2ccb4f7b87117b8826596eea257eb',true),

  ('D0B5','submission_private','validate_current_order','jsonb',ARRAY['p_intent'],
   'void',false,'plpgsql','v',false,false,ARRAY['search_path=pg_catalog'],
   '2fe970ca99737d0487298551c877208e',false),
  ('D0B5','public','submit_public_order_v2','jsonb',ARRAY['p_request'],
   'jsonb',false,'plpgsql','v',true,false,ARRAY['search_path=pg_catalog'],
   'd4161272b05e3a9449a82ae1f93ce123',true)
),
baseline AS (
  SELECT p.oid, p.proowner, p.prosecdef,
         pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.submit_public_order(jsonb)')
),
function_catalog AS (
  SELECT e.*,
         to_regprocedure(format(
           '%I.%I(%s)',e.schema_name,e.function_name,e.identity_args
         )) AS expected_oid,
         (
           SELECT count(*)
           FROM pg_proc x
           JOIN pg_namespace n ON n.oid=x.pronamespace
           WHERE n.nspname=e.schema_name AND x.proname=e.function_name
         ) AS same_name_count
  FROM expected_functions e
),
function_inspection AS (
  SELECT e.*, p.oid AS actual_oid,
         pg_get_userbyid(p.proowner) AS owner,
         p.proowner,
         l.lanname AS actual_language,
         p.provolatile::text AS actual_volatility,
         p.prosecdef AS actual_security_definer,
         p.proisstrict AS actual_strict,
         p.proretset AS actual_returns_set,
         format_type(p.prorettype,NULL) AS actual_return_type,
         p.proargnames,
         p.proallargtypes,
         p.proargmodes,
         p.prorows,
         p.proconfig,
         p.proacl::text AS acl,
         md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))
           AS actual_body_md5,
         ARRAY(
           SELECT lower(v)
           FROM unnest(p.proconfig) v ORDER BY lower(v)
         ) AS normalized_config,
         ARRAY(
           SELECT lower(v)
           FROM unnest(e.expected_config) v ORDER BY lower(v)
         ) AS normalized_expected_config,
         CASE WHEN p.oid IS NOT NULL THEN
           EXISTS (
             SELECT 1
             FROM aclexplode(
               coalesce(p.proacl,acldefault('f',p.proowner))
             ) a
             WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
           )
         END AS public_execute,
         CASE WHEN p.oid IS NOT NULL AND
                   EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')
           THEN has_function_privilege('anon',p.oid,'EXECUTE')
         END AS anon_execute,
         CASE WHEN p.oid IS NOT NULL AND
                   EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
           THEN has_function_privilege('authenticated',p.oid,'EXECUTE')
         END AS authenticated_execute,
         CASE WHEN p.oid IS NOT NULL THEN pg_get_functiondef(p.oid) END
           AS definition
  FROM function_catalog e
  LEFT JOIN pg_proc p ON p.oid=e.expected_oid
  LEFT JOIN pg_language l ON l.oid=p.prolang
),
function_checks AS (
  SELECT f.*,
         array_remove(ARRAY[
           CASE WHEN same_name_count>1
             THEN 'Unexpected overload/name collision' END,
           CASE WHEN actual_oid IS NULL AND same_name_count>0
             THEN 'Expected signature missing; different signature exists' END,
           CASE WHEN actual_oid IS NOT NULL
                 AND proowner IS DISTINCT FROM (SELECT proowner FROM baseline)
             THEN 'Owner differs from existing public submission owner' END,
           CASE WHEN actual_oid IS NOT NULL
                 AND actual_language IS DISTINCT FROM language_name
             THEN 'Language mismatch' END,
           CASE WHEN actual_oid IS NOT NULL
                 AND actual_volatility IS DISTINCT FROM volatility
             THEN 'Volatility mismatch' END,
           CASE WHEN actual_oid IS NOT NULL
                 AND actual_security_definer IS DISTINCT FROM security_definer
             THEN 'Security mode mismatch' END,
           CASE WHEN actual_oid IS NOT NULL
                 AND actual_strict IS DISTINCT FROM strict
             THEN 'STRICT mismatch' END,
           CASE WHEN actual_oid IS NOT NULL
                 AND (actual_return_type IS DISTINCT FROM return_type
                   OR actual_returns_set IS DISTINCT FROM returns_set)
             THEN 'Return contract mismatch' END,
           CASE WHEN actual_oid IS NOT NULL
                 AND proargnames[1:cardinality(input_names)]
                     IS DISTINCT FROM input_names
             THEN 'Input parameter names mismatch' END,
           CASE WHEN actual_oid IS NOT NULL
                 AND normalized_config IS DISTINCT FROM normalized_expected_config
             THEN 'Function configuration/search_path mismatch' END,
           CASE WHEN actual_oid IS NOT NULL
                 AND actual_body_md5 IS DISTINCT FROM body_md5
             THEN 'Function body differs from reviewed local SQL' END,
           CASE WHEN actual_oid IS NOT NULL AND public_execute
             THEN 'PUBLIC has EXECUTE' END,
           CASE WHEN actual_oid IS NOT NULL AND public_rpc
                 AND (anon_execute IS DISTINCT FROM true
                   OR authenticated_execute IS DISTINCT FROM true)
             THEN 'Required public-role EXECUTE missing' END,
           CASE WHEN actual_oid IS NOT NULL AND NOT public_rpc
                 AND (anon_execute OR authenticated_execute)
             THEN 'Public role can execute private helper' END,
           CASE WHEN function_name='pricing_input_lines'
                 AND actual_oid IS NOT NULL
                 AND (
                   prorows IS DISTINCT FROM 30::real
                   OR proargnames IS DISTINCT FROM
                     ARRAY['p_items','product_id','product_size_id',
                           'option_choice_ids','quantity','item_note']
                   OR proargmodes IS DISTINCT FROM
                     ARRAY['i','t','t','t','t','t']::"char"[]
                   OR proallargtypes IS DISTINCT FROM ARRAY[
                     'jsonb'::regtype::oid,'uuid'::regtype::oid,
                     'uuid'::regtype::oid,'uuid[]'::regtype::oid,
                     'integer'::regtype::oid,'text'::regtype::oid
                   ]
                 )
             THEN 'Pricing input TABLE/ROWS contract mismatch' END
         ],NULL) AS problems
  FROM function_inspection f
),
column_specs(relation_name, specs) AS (
  VALUES
  ('public.products',
   'id:uuid,name:text,category_id:uuid,is_published:boolean,is_available:boolean,is_sold_out:boolean,archived_at:timestamp with time zone'),
  ('public.categories','id:uuid,name:text'),
  ('public.product_sizes','id:uuid,product_id:uuid,price:numeric,label:text'),
  ('public.option_groups',
   'id:uuid,name:text,group_key:text,selection_type:text,is_active:boolean'),
  ('public.option_choices',
   'id:uuid,option_group_id:uuid,label:text,value:text,price_delta:numeric,is_active:boolean'),
  ('public.product_option_groups',
   'product_id:uuid,option_group_id:uuid,is_active:boolean,is_required:boolean,min_selections:integer,max_selections:integer'),
  ('public.product_option_defaults',
   'product_id:uuid,option_group_id:uuid,option_choice_id:uuid'),
  ('public.product_option_choice_price_overrides',
   'product_id:uuid,product_size_id:uuid,option_choice_id:uuid,price_delta:numeric,is_active:boolean'),
  ('public.product_option_choice_override_requirements',
   'product_id:uuid,product_size_id:uuid,option_choice_id:uuid,specificity:text,is_active:boolean'),
  ('public.product_size_option_choice_compatibility',
   'product_id:uuid,product_size_id:uuid,option_choice_id:uuid,is_active:boolean'),
  ('configuration_private.product_pricing_certifications',
   'product_id:uuid,expected_structure:jsonb,structure_version:smallint'),
  ('public.orders',
   'public_submission_key:uuid,public_submission_fingerprint:text,submission_fingerprint_version:smallint,pricing_contract_version:smallint,order_number:text,tracking_token:uuid,source:text,preparation_timing:text,requested_preparation_at:timestamp with time zone,pricing_policy_version:text,pricing_fingerprint_version:smallint,accepted_review_fingerprint:text,priced_at:timestamp with time zone'),
  ('public.order_items','pricing_configuration_snapshot:jsonb')
),
column_checks AS (
  SELECT s.relation_name,
         split_part(v,':',1) AS column_name,
         split_part(v,':',2) AS expected_type,
         c.data_type AS actual_type,
         c.data_type IS NOT DISTINCT FROM split_part(v,':',2) AS matches
  FROM column_specs s
  CROSS JOIN LATERAL unnest(string_to_array(s.specs,',')) v
  LEFT JOIN information_schema.columns c
    ON c.table_schema=split_part(s.relation_name,'.',1)
   AND c.table_name=split_part(s.relation_name,'.',2)
   AND c.column_name=split_part(v,':',1)
),
required_functions(signature) AS (
  VALUES
    ('extensions.digest(bytea,text)'),
    ('extensions.digest(text,text)'),
    ('customer_private.normalize_phone(text)'),
    ('customer_private.link_website_order(uuid)'),
    ('configuration_private.catalog_structure(uuid)'),
    ('configuration_private.assert_pricing_ready(uuid)'),
    ('configuration_private.valid_pricing_snapshot(jsonb)'),
    ('public.submit_public_order(jsonb)')
),
dependency_checks AS (
  SELECT signature, to_regprocedure(signature) AS object_oid
  FROM required_functions
),
index_names(index_name) AS (
  VALUES
    ('public.d0a1_override_product_choice'),
    ('public.d0a1_override_size_choice'),
    ('public.d0a1_requirement_product_choice'),
    ('public.d0a1_requirement_size_choice'),
    ('public.orders_public_submission_key_idx')
),
index_checks AS (
  SELECT n.index_name,
         i.indisunique, i.indisvalid, i.indisready,
         CASE WHEN i.indexrelid IS NOT NULL
           THEN pg_get_indexdef(i.indexrelid) END AS definition,
         CASE WHEN i.indexrelid IS NOT NULL
           THEN pg_get_expr(i.indpred,i.indrelid) END AS predicate,
         coalesce(i.indisunique AND i.indisvalid AND i.indisready
           AND (
             n.index_name<>'public.orders_public_submission_key_idx'
             OR (
               i.indrelid=to_regclass('public.orders')
               AND i.indnkeyatts=1
               AND pg_get_indexdef(i.indexrelid,1,true)='public_submission_key'
               AND pg_get_expr(i.indpred,i.indrelid)=
                   '(public_submission_key IS NOT NULL)'
             )
           ),false) AS matches
  FROM index_names n
  LEFT JOIN pg_index i ON i.indexrelid=to_regclass(n.index_name)
),
schema_checks AS (
  SELECT n.nspname,
         pg_get_userbyid(n.nspowner) AS owner,
         n.nspacl::text AS acl,
         CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')
           THEN has_schema_privilege('anon',n.oid,'USAGE') END AS anon_usage,
         CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
           THEN has_schema_privilege('authenticated',n.oid,'USAGE') END
           AS authenticated_usage
  FROM pg_namespace n
  WHERE n.nspname IN ('submission_private','configuration_private')
),
baseline_checks AS (
  SELECT
    EXISTS(SELECT 1 FROM baseline WHERE prosecdef) AS security_definer,
    EXISTS(SELECT 1 FROM baseline WHERE
      position('CURV_ORDERING_CLOSED' IN definition)>0
      AND position('-- Structured dine-in timing:' IN definition)>0
      AND position('perform customer_private.link_website_order(v_order_id);'
                   IN definition)>0
    ) AS expected_submission_baseline,
    EXISTS(SELECT 1 FROM baseline WHERE proowner=(
      SELECT oid FROM pg_roles WHERE rolname=current_user
    )) AS current_user_matches_submission_owner,
    EXISTS(
      SELECT 1 FROM pg_constraint
      WHERE conrelid=to_regclass('public.orders')
        AND conname='d0b1_order_pricing_metadata' AND convalidated
    ) AS validated_pricing_metadata_constraint
),
global_blockers AS (
  SELECT issue
  FROM (
    SELECT 'Required role missing: '||r AS issue
    FROM unnest(ARRAY['anon','authenticated']) r
    WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r)
    UNION ALL
    SELECT 'Missing dependency: '||signature
    FROM dependency_checks WHERE object_oid IS NULL
    UNION ALL
    SELECT 'Missing/incompatible column: '||relation_name||'.'||column_name
    FROM column_checks WHERE NOT matches
    UNION ALL
    SELECT 'Invalid/missing prerequisite index: '||index_name
    FROM index_checks WHERE NOT matches
    UNION ALL
    SELECT 'configuration_private schema missing'
    WHERE to_regnamespace('configuration_private') IS NULL
    UNION ALL
    SELECT 'Public-role USAGE on private schema: '||nspname
    FROM schema_checks WHERE anon_usage OR authenticated_usage
    UNION ALL
    SELECT 'Submission baseline/security/metadata prerequisite failed'
    FROM baseline_checks
    WHERE NOT security_definer OR NOT expected_submission_baseline
       OR NOT validated_pricing_metadata_constraint
    UNION ALL
    SELECT 'Run deployment as the reviewed existing submission-function owner'
    FROM baseline_checks WHERE NOT current_user_matches_submission_owner
  ) issues
),
phase_counts AS (
  SELECT phase, count(*) AS expected_functions,
         count(actual_oid) AS present_functions,
         bool_or(cardinality(problems)>0) AS drift
  FROM function_checks GROUP BY phase
),
phase_status AS (
  SELECT *,
    CASE
      WHEN drift THEN 'COLLISION_OR_DRIFT'
      WHEN present_functions=expected_functions THEN 'INSTALLED_MATCHING'
      WHEN present_functions=0
        AND NOT (
          phase='D0B2'
          AND to_regnamespace('submission_private') IS NOT NULL
        ) THEN 'MISSING'
      ELSE 'PARTIAL'
    END AS status
  FROM phase_counts
)
SELECT jsonb_build_object(
  'execution_role', current_user,
  'phase_statuses', (
    SELECT jsonb_agg(to_jsonb(s) ORDER BY phase) FROM phase_status s
  ),
  'function_details', (
    SELECT jsonb_agg(jsonb_build_object(
      'phase',phase,
      'signature',schema_name||'.'||function_name||'('||identity_args||')',
      'present',actual_oid IS NOT NULL,
      'same_name_count',same_name_count,
      'owner',owner,
      'security_definer',actual_security_definer,
      'volatility',actual_volatility,
      'config',proconfig,
      'acl',acl,
      'public_execute',public_execute,
      'anon_execute',anon_execute,
      'authenticated_execute',authenticated_execute,
      'expected_body_md5',body_md5,
      'actual_body_md5',actual_body_md5,
      'problems',problems,
      'definition',definition,
      'other_same_name_definitions',(
        SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=f.schema_name AND p.proname=f.function_name
          AND p.oid IS DISTINCT FROM f.actual_oid
      )
    ) ORDER BY phase,schema_name,function_name)
    FROM function_checks f
  ),
  'private_schema_details',(
    SELECT jsonb_agg(to_jsonb(s) ORDER BY nspname) FROM schema_checks s
  ),
  'column_details',(
    SELECT jsonb_agg(to_jsonb(c) ORDER BY relation_name,column_name)
    FROM column_checks c
  ),
  'index_details',(
    SELECT jsonb_agg(to_jsonb(i) ORDER BY index_name) FROM index_checks i
  ),
  'dependency_details',(
    SELECT jsonb_agg(jsonb_build_object(
      'signature',signature,'present',object_oid IS NOT NULL
    ) ORDER BY signature) FROM dependency_checks
  ),
  'baseline_details',(SELECT to_jsonb(b) FROM baseline_checks b),
  'baseline_blockers',coalesce((
    SELECT jsonb_agg(issue ORDER BY issue) FROM global_blockers
  ),'[]'::jsonb),
  'missing_phase_installation_order',coalesce((
    SELECT jsonb_agg(phase ORDER BY phase)
    FROM phase_status WHERE status='MISSING'
  ),'[]'::jsonb),
  'installation_recommendation',
    CASE
      WHEN EXISTS(SELECT 1 FROM global_blockers)
        OR EXISTS(SELECT 1 FROM phase_status
                  WHERE status IN ('PARTIAL','COLLISION_OR_DRIFT'))
      THEN 'STOP_FOR_OBJECT_LEVEL_REVIEW'
      WHEN EXISTS(
        SELECT 1 FROM phase_status later
        JOIN phase_status earlier ON earlier.phase<later.phase
        WHERE later.status='INSTALLED_MATCHING'
          AND earlier.status='MISSING'
      )
      THEN 'STOP_INCONSISTENT_DEPENDENCY_CHAIN'
      WHEN EXISTS(SELECT 1 FROM phase_status WHERE status='MISSING')
      THEN 'PREPARE_ONLY_MISSING_PHASES_IN_D0B2_D0B3_D0B4_D0B5_ORDER'
      ELSE 'ALL_PHASES_MATCHING_DO_NOT_RERUN'
    END,
  'frontend_endpoint_installation',
    CASE WHEN EXISTS(
      SELECT 1 FROM phase_status
      WHERE phase IN ('D0B4','D0B5') AND status<>'INSTALLED_MATCHING'
    ) THEN 'QUOTE_OR_SUBMISSION_ENDPOINT_NOT_READY'
    ELSE 'ENDPOINTS_MATCHING_CERTIFICATION_AND_CART_VALIDATION_STILL_REQUIRED'
    END,
  'notes',jsonb_build_array(
    'Phase status describes installed functions; baseline blockers must also be clear.',
    'Public option views are not direct dependencies of the pricing engine.',
    'No certification or quote/submission function was executed.',
    'PostgREST schema-cache visibility requires separate verification after installation.',
    'Matching endpoints alone do not prove successful checkout: current product certification and coverage remain required.'
  )
) AS authoritative_checkout_preflight;

COMMIT;
