-- LOCAL DRAFT ONLY. Do not execute until separately reviewed and approved.
-- Requires existing option schema, D0A.1 and D0B1. No configuration/backfill changes.
-- First application only. Run as the existing trusted is_admin() owner.
-- Lock scope: all listed configuration tables, briefly blocking configuration writes
-- (ordinary SELECT remains available). Bounded 2s acquisition; retry on contention.
-- READ COMMITTED required so dependency reads see writers committed before locks.
BEGIN;
DO $$
DECLARE object_name text; dependency record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.is_admin()')
    AND prosecdef AND proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
    OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Review owner authorization prerequisites' USING DETAIL='MM_OPTION_DELETE_PREREQUISITE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('menu_manager_delete_option_group','menu_manager_delete_option_choice')) THEN
    RAISE EXCEPTION 'Delete RPC collision; stop for review' USING DETAIL='MM_OPTION_DELETE_COLLISION';
  END IF;
  FOREACH object_name IN ARRAY ARRAY['public.option_groups','public.option_choices','public.product_option_groups','public.product_option_defaults','public.product_option_choice_price_overrides','public.product_size_option_choice_compatibility','public.product_option_choice_override_requirements','configuration_private.product_pricing_certifications'] LOOP
    IF to_regclass(object_name) IS NULL THEN
      RAISE EXCEPTION 'Missing prerequisite %',object_name USING DETAIL='MM_OPTION_DELETE_PREREQUISITE';
    END IF;
  END LOOP;
  FOR dependency IN SELECT * FROM (VALUES
    ('public','option_groups','id','uuid'),
    ('public','option_choices','id','uuid'),('public','option_choices','option_group_id','uuid'),
    ('public','product_option_groups','option_group_id','uuid'),
    ('public','product_option_defaults','option_group_id','uuid'),('public','product_option_defaults','option_choice_id','uuid'),
    ('public','product_option_choice_price_overrides','option_choice_id','uuid'),
    ('public','product_size_option_choice_compatibility','option_choice_id','uuid'),
    ('public','product_option_choice_override_requirements','option_choice_id','uuid'),
    ('configuration_private','product_pricing_certifications','expected_structure','jsonb')
  ) v(sch,tbl,col,typ) LOOP
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=dependency.sch
      AND table_name=dependency.tbl AND column_name=dependency.col AND data_type=dependency.typ) THEN
      RAISE EXCEPTION 'Incompatible dependency %.%.%',dependency.sch,dependency.tbl,dependency.col
        USING DETAIL='MM_OPTION_DELETE_PREREQUISITE';
    END IF;
  END LOOP;
END $;

CREATE FUNCTION public.menu_manager_delete_option_group(p_group_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog
SET lock_timeout='2s'
AS $$
DECLARE reasons text[] := '{}'; deleted_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',false,'code','OWNER_REQUIRED');
  END IF;
  IF p_group_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RETURN jsonb_build_object('ok',false,'code','RETRY_REQUIRED');
  END IF;
  -- Same order in both RPCs. Locks protect FK dependencies AND JSON certificates
  -- against concurrent direct CRUD/certification, not just other delete RPCs.
  LOCK TABLE public.option_groups,
    public.option_choices,
    public.product_option_groups,
    public.product_option_defaults,
    public.product_option_choice_price_overrides,
    public.product_size_option_choice_compatibility,
    public.product_option_choice_override_requirements,
    configuration_private.product_pricing_certifications IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS(SELECT 1 FROM public.option_groups WHERE id=p_group_id) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');
  END IF;
  -- Unknown FKs/delete triggers require manual review; never trust CASCADE safety.
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f'
    AND confrelid IN ('public.option_groups'::regclass,'public.option_choices'::regclass)
    AND (connamespace <> 'public'::regnamespace OR conname <> ALL(ARRAY['option_choices_option_group_id_fkey','product_option_groups_option_group_id_fkey','product_option_defaults_option_group_id_fkey','product_option_defaults_option_choice_id_fkey','product_option_defaults_choice_group_fk','product_option_choice_price_overrides_option_choice_id_fkey','product_size_option_choice_compatibility_option_choice_id_fkey','product_option_choice_override_requirements_option_choice_id_fkey'])) )
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.option_groups'::regclass
      AND NOT tgisinternal AND (tgtype::integer & 8) <> 0) THEN
    RETURN jsonb_build_object('ok',false,'code','REFERENCE_REVIEW_REQUIRED');
  END IF;
  IF EXISTS(SELECT 1 FROM public.option_choices WHERE option_group_id=p_group_id) THEN reasons:=array_append(reasons,'GROUP_HAS_CHOICES'); END IF;
  IF EXISTS(SELECT 1 FROM public.product_option_groups WHERE option_group_id=p_group_id) THEN reasons:=array_append(reasons,'GROUP_ASSIGNED'); END IF;
  IF EXISTS(SELECT 1 FROM public.product_option_defaults WHERE option_group_id=p_group_id) THEN reasons:=array_append(reasons,'USED_AS_DEFAULT'); END IF;
  -- Expected structures store complete catalog rows, including inactive ones.
  IF EXISTS(SELECT 1 FROM configuration_private.product_pricing_certifications
    WHERE jsonb_path_exists(expected_structure,'$.** ? (@ == $id)',jsonb_build_object('id',p_group_id::text))) THEN
    reasons:=array_append(reasons,'USED_IN_CERTIFICATION');
  END IF;
  IF cardinality(reasons)>0 THEN RETURN jsonb_build_object('ok',false,'code','IN_USE','reasons',to_jsonb(reasons)); END IF;
  -- No child/configuration row is deleted here. All dependency checks precede
  -- the sole target DELETE. Active and inactive unused entries are both allowed.
  DELETE FROM public.option_groups WHERE id=p_group_id RETURNING id INTO deleted_id;
  IF deleted_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'deleted_id',deleted_id);
EXCEPTION
  WHEN lock_not_available OR deadlock_detected THEN
    RETURN jsonb_build_object('ok',false,'code','RETRY_REQUIRED');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok',false,'code','REFERENCE_REVIEW_REQUIRED');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok',false,'code','DELETE_UNAVAILABLE');
END $$;
REVOKE ALL ON FUNCTION public.menu_manager_delete_option_group(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.menu_manager_delete_option_group(uuid) TO authenticated;

CREATE FUNCTION public.menu_manager_delete_option_choice(p_choice_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog
SET lock_timeout='2s'
AS $$
DECLARE reasons text[] := '{}'; deleted_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',false,'code','OWNER_REQUIRED');
  END IF;
  IF p_choice_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RETURN jsonb_build_object('ok',false,'code','RETRY_REQUIRED');
  END IF;
  -- Same order in both RPCs. Locks protect FK dependencies AND JSON certificates
  -- against concurrent direct CRUD/certification, not just other delete RPCs.
  LOCK TABLE public.option_groups,
    public.option_choices,
    public.product_option_groups,
    public.product_option_defaults,
    public.product_option_choice_price_overrides,
    public.product_size_option_choice_compatibility,
    public.product_option_choice_override_requirements,
    configuration_private.product_pricing_certifications IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS(SELECT 1 FROM public.option_choices WHERE id=p_choice_id) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');
  END IF;
  -- Unknown FKs/delete triggers require manual review; never trust CASCADE safety.
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f'
    AND confrelid IN ('public.option_groups'::regclass,'public.option_choices'::regclass)
    AND (connamespace <> 'public'::regnamespace OR conname <> ALL(ARRAY['option_choices_option_group_id_fkey','product_option_groups_option_group_id_fkey','product_option_defaults_option_group_id_fkey','product_option_defaults_option_choice_id_fkey','product_option_defaults_choice_group_fk','product_option_choice_price_overrides_option_choice_id_fkey','product_size_option_choice_compatibility_option_choice_id_fkey','product_option_choice_override_requirements_option_choice_id_fkey'])) )
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.option_choices'::regclass
      AND NOT tgisinternal AND (tgtype::integer & 8) <> 0) THEN
    RETURN jsonb_build_object('ok',false,'code','REFERENCE_REVIEW_REQUIRED');
  END IF;
  IF EXISTS(SELECT 1 FROM public.product_option_defaults WHERE option_choice_id=p_choice_id) THEN reasons:=array_append(reasons,'USED_AS_DEFAULT'); END IF;
  IF EXISTS(SELECT 1 FROM public.product_option_choice_price_overrides WHERE option_choice_id=p_choice_id) THEN reasons:=array_append(reasons,'USED_IN_OVERRIDE'); END IF;
  IF EXISTS(SELECT 1 FROM public.product_size_option_choice_compatibility WHERE option_choice_id=p_choice_id) THEN reasons:=array_append(reasons,'USED_IN_COMPATIBILITY'); END IF;
  IF EXISTS(SELECT 1 FROM public.product_option_choice_override_requirements WHERE option_choice_id=p_choice_id) THEN reasons:=array_append(reasons,'USED_IN_REQUIREMENT'); END IF;
  IF EXISTS(SELECT 1 FROM public.product_option_groups a JOIN public.option_choices c ON c.option_group_id=a.option_group_id WHERE c.id=p_choice_id) THEN reasons:=array_append(reasons,'CHOICE_ASSIGNED'); END IF;
  -- Expected structures store complete catalog rows, including inactive ones.
  IF EXISTS(SELECT 1 FROM configuration_private.product_pricing_certifications
    WHERE jsonb_path_exists(expected_structure,'$.** ? (@ == $id)',jsonb_build_object('id',p_choice_id::text))) THEN
    reasons:=array_append(reasons,'USED_IN_CERTIFICATION');
  END IF;
  IF cardinality(reasons)>0 THEN RETURN jsonb_build_object('ok',false,'code','IN_USE','reasons',to_jsonb(reasons)); END IF;
  -- No child/configuration row is deleted here. All dependency checks precede
  -- the sole target DELETE. Active and inactive unused entries are both allowed.
  DELETE FROM public.option_choices WHERE id=p_choice_id RETURNING id INTO deleted_id;
  IF deleted_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'deleted_id',deleted_id);
EXCEPTION
  WHEN lock_not_available OR deadlock_detected THEN
    RETURN jsonb_build_object('ok',false,'code','RETRY_REQUIRED');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok',false,'code','REFERENCE_REVIEW_REQUIRED');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok',false,'code','DELETE_UNAVAILABLE');
END $$;
REVOKE ALL ON FUNCTION public.menu_manager_delete_option_choice(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.menu_manager_delete_option_choice(uuid) TO authenticated;

COMMIT;
