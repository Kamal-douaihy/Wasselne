-- Phase 4 review fixes (register A-4-11, A-4-12; mirrored in docs/phase-2/schema.sql).
-- A-4-11  Eligibility ignored seats and minimum year: a driver could lower the vehicle's seats or
--         year after choosing a category, or the CMS could tighten a category after approval, and
--         the driver stayed approvable and offerable. vehicle_category_fit_reasons() is now the
--         single vehicle/category rule and driver_ineligibility_reasons() reports its codes as
--         VEHICLE_CATEGORY_MISMATCH:<code>. An inactive vehicle is now reported as VEHICLE_INACTIVE.
-- A-4-12  A presigned PUT stays usable until it expires, so the object it targets must never be
--         the reviewed one. Clients upload to uploads.staging_object_key; completion copies the
--         object server-side to object_key (random, never signed for writing), validates the copy
--         and deletes the staging object. The cleanup job deletes anything re-PUT to staging once
--         the grant has expired, then clears the column.

-- Whether a vehicle physically fits a category: base type, at least the category's seats, and
-- the category's minimum model year (vehicle_rules.min_year; a vehicle with no year fails a
-- min_year rule, and a min_year that is not a number fails closed). Codes, in this order:
-- VEHICLE_TYPE, SEATS, VEHICLE_YEAR. Used by category selection, by the vehicle step (to drop
-- selections that no longer fit) and by driver_ineligibility_reasons(), so there is one rule.
CREATE FUNCTION vehicle_category_fit_reasons(p_vehicle uuid, p_category uuid) RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
  reasons text[] := '{}';
  v vehicles%ROWTYPE;
  c vehicle_categories%ROWTYPE;
  v_min jsonb;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle;
  IF NOT FOUND THEN RETURN ARRAY['VEHICLE_NOT_FOUND']; END IF;
  SELECT * INTO c FROM vehicle_categories WHERE id = p_category;
  IF NOT FOUND THEN RETURN ARRAY['CATEGORY_NOT_FOUND']; END IF;

  IF v.base_type <> c.base_type THEN reasons := array_append(reasons, 'VEHICLE_TYPE'); END IF;
  IF v.seats < c.seats THEN reasons := array_append(reasons, 'SEATS'); END IF;
  v_min := c.vehicle_rules -> 'min_year';
  IF v_min IS NOT NULL AND jsonb_typeof(v_min) <> 'null' THEN
    IF jsonb_typeof(v_min) <> 'number' OR v.year IS NULL OR v.year < (v_min #>> '{}')::numeric THEN
      reasons := array_append(reasons, 'VEHICLE_YEAR');
    END IF;
  END IF;
  RETURN reasons;
END $$;

CREATE OR REPLACE FUNCTION driver_ineligibility_reasons(p_driver uuid, p_category uuid) RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
  reasons text[] := '{}';
  v_status driver_status;
  v_vehicle uuid;
  v_gender gender;
  v_gender_confirmed timestamptz;
  v_account account_status;
  v_cat_active boolean;
  v_cat_women boolean;
  v_cat_found boolean := false;
  v_appr approval_status;
  v_appr_vehicle uuid;
  v_veh_active boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Beirut')::date;
  v_grace integer;
  d record;
BEGIN
  SELECT dp.status, dp.current_vehicle_id, a.gender, a.gender_confirmed_at, a.status
    INTO v_status, v_vehicle, v_gender, v_gender_confirmed, v_account
    FROM driver_profiles dp JOIN accounts a ON a.id = dp.account_id
   WHERE dp.account_id = p_driver;
  IF NOT FOUND THEN RETURN ARRAY['DRIVER_NOT_FOUND']; END IF;

  IF v_account <> 'ACTIVE' THEN reasons := array_append(reasons, 'ACCOUNT_NOT_ACTIVE'); END IF;
  IF v_status <> 'APPROVED' THEN reasons := array_append(reasons, 'DRIVER_NOT_APPROVED'); END IF;

  IF EXISTS (SELECT 1 FROM account_blocks b WHERE b.account_id = p_driver AND b.lifted_at IS NULL
             AND 'DRIVER' = ANY (b.applies_to) AND b.effective_at IS NOT NULL AND b.effective_at <= now()) THEN
    reasons := array_append(reasons, 'ACCOUNT_BLOCKED');
  END IF;
  IF EXISTS (SELECT 1 FROM account_blocks b WHERE b.account_id = p_driver AND b.lifted_at IS NULL
             AND 'DRIVER' = ANY (b.applies_to) AND b.effective_at IS NULL) THEN
    reasons := array_append(reasons, 'BLOCK_PENDING');
  END IF;

  SELECT true, vc.active, vc.female_drivers_only INTO v_cat_found, v_cat_active, v_cat_women
    FROM vehicle_categories vc WHERE vc.id = p_category;
  IF NOT FOUND THEN
    reasons := array_append(reasons, 'CATEGORY_NOT_FOUND');
    RETURN reasons;
  END IF;
  IF NOT v_cat_active THEN reasons := array_append(reasons, 'CATEGORY_INACTIVE'); END IF;

  SELECT dca.status, dca.vehicle_id INTO v_appr, v_appr_vehicle
    FROM driver_category_approvals dca WHERE dca.driver_id = p_driver AND dca.category_id = p_category;
  IF NOT FOUND OR v_appr IN ('PENDING', 'REJECTED') THEN
    reasons := array_append(reasons, 'CATEGORY_NOT_APPROVED');
  ELSIF v_appr = 'PAUSED_BY_DRIVER' THEN
    reasons := array_append(reasons, 'CATEGORY_PAUSED');
  END IF;

  IF v_vehicle IS NULL THEN
    reasons := array_append(reasons, 'NO_VEHICLE');
  ELSE
    SELECT v.active INTO v_veh_active FROM vehicles v WHERE v.id = v_vehicle;
    IF NOT v_veh_active THEN reasons := array_append(reasons, 'VEHICLE_INACTIVE'); END IF;
    -- Evaluated live against the current vehicle and the category's current rules, so a vehicle
    -- edited after selection or rules tightened after approval both take effect immediately.
    reasons := reasons || ARRAY(SELECT 'VEHICLE_CATEGORY_MISMATCH:' || f.r
                                  FROM unnest(vehicle_category_fit_reasons(v_vehicle, p_category)) WITH ORDINALITY AS f(r, n)
                                 ORDER BY f.n);
    IF v_appr_vehicle IS NOT NULL AND v_appr_vehicle <> v_vehicle THEN reasons := array_append(reasons, 'CATEGORY_VEHICLE_CHANGED'); END IF;
  END IF;

  IF v_cat_women AND (v_gender IS DISTINCT FROM 'FEMALE' OR v_gender_confirmed IS NULL) THEN
    reasons := array_append(reasons, 'GENDER_NOT_CONFIRMED');
  END IF;

  FOR d IN
    SELECT dt.id, dt.code, dt.subject, dt.has_expiry
      FROM category_document_requirements r JOIN document_types dt ON dt.id = r.document_type_id
     WHERE r.category_id = p_category AND dt.active
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM driver_documents dd
       WHERE dd.driver_id = p_driver AND dd.document_type_id = d.id AND dd.status = 'APPROVED'
         AND (d.subject = 'DRIVER' OR dd.vehicle_id IS NOT DISTINCT FROM v_vehicle)
         AND (NOT d.has_expiry OR (dd.expires_on IS NOT NULL AND dd.expires_on >= v_today))
    ) THEN
      reasons := array_append(reasons, ('DOCUMENT_NOT_VALID:' || d.code));
    END IF;
  END LOOP;

  -- D-40: overdue only after the CMS grace period; a submitted check awaiting review never blocks.
  v_grace := coalesce((SELECT (s.settings ->> 'vehicle_check_grace_days')::integer
                         FROM platform_settings_versions s
                        WHERE s.status = 'PUBLISHED' AND s.effective_at <= now()
                        ORDER BY s.effective_at DESC LIMIT 1), 7);
  IF v_vehicle IS NOT NULL AND EXISTS (
    SELECT 1 FROM vehicle_checks vcheck
     WHERE vcheck.vehicle_id = v_vehicle AND vcheck.status IN ('DUE', 'NEEDS_CHANGES')
       AND vcheck.due_on + v_grace < v_today
  ) THEN
    reasons := array_append(reasons, 'VEHICLE_CHECK_OVERDUE');
  END IF;

  RETURN reasons;
END $$;

ALTER TABLE uploads ADD COLUMN staging_object_key text UNIQUE;

-- Grants issued before this migration signed their PUT for object_key itself; close them so every
-- completion goes through staging. No environment holds production uploads yet.
UPDATE uploads SET status = 'EXPIRED' WHERE status = 'AUTHORIZED';
