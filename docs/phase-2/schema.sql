-- Wasselne — Phase 2 schema (design contract).
-- Target: PostgreSQL 16 + PostGIS 3.4. Phase 3 splits this into ordered migrations.
-- Conventions: UUID keys; timestamptz in UTC; money = bigint minor units + currency code;
-- rates/percentages = integer basis points (10000 = 100% or ×1.0). Localized text = jsonb {"ar","en","fr"}.
-- See 02_State_Machines_and_Transactions.md for the transaction rules these constraints back up.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- enums
CREATE TYPE gender              AS ENUM ('FEMALE','MALE');
CREATE TYPE app_language        AS ENUM ('ar','en','fr');
CREATE TYPE app_kind            AS ENUM ('RIDER','DRIVER');
CREATE TYPE account_status      AS ENUM ('ACTIVE','DELETED');
CREATE TYPE vehicle_base_type   AS ENUM ('CAR','MOTORCYCLE','TUKTUK');
CREATE TYPE publish_status      AS ENUM ('DRAFT','PUBLISHED','RETIRED');
CREATE TYPE driver_status       AS ENUM ('ONBOARDING','SUBMITTED','NEEDS_CHANGES','APPROVED','REJECTED','SUSPENDED');
CREATE TYPE approval_status     AS ENUM ('PENDING','APPROVED','REJECTED','PAUSED_BY_DRIVER');
CREATE TYPE document_status     AS ENUM ('UPLOADED','APPROVED','NEEDS_CHANGES','REJECTED','EXPIRED','SUPERSEDED');
CREATE TYPE vehicle_check_status AS ENUM ('DUE','SUBMITTED','APPROVED','NEEDS_CHANGES');
CREATE TYPE upload_status       AS ENUM ('AUTHORIZED','COMPLETED','QUARANTINED','REJECTED','EXPIRED');
CREATE TYPE fare_mode           AS ENUM ('FIXED','RECALCULATE');
CREATE TYPE value_kind          AS ENUM ('FIXED','PERCENT');
CREATE TYPE discount_kind       AS ENUM ('PROMO_CODE','AUTOMATIC');
CREATE TYPE redemption_status   AS ENUM ('RESERVED','CONSUMED','RELEASED');
CREATE TYPE ride_status         AS ENUM ('SEARCHING','CONFIRMED','AT_PICKUP','IN_PROGRESS','COMPLETED',
                                         'NO_DRIVER','CANCELLED','NO_SHOW','ELIGIBILITY_MISMATCH');
CREATE TYPE actor_role          AS ENUM ('RIDER','DRIVER','ADMIN','SYSTEM');
CREATE TYPE offer_state         AS ENUM ('PENDING_ACK','ACTIVE','ACCEPTED','DECLINED','EXPIRED','CANCELLED');
CREATE TYPE offer_end_reason    AS ENUM ('ACK_TIMEOUT','ACCEPT_TIMEOUT','DECLINED','ACCEPTED',
                                         'RIDE_CANCELLED','RIDE_ASSIGNED','DRIVER_INELIGIBLE');
CREATE TYPE payment_status      AS ENUM ('NOT_DUE','DUE','CHARGE_PENDING','CHARGE_FAILED','RECORDED',
                                         'DISPUTED','RESOLVED','VOID');
CREATE TYPE ledger_entry_type   AS ENUM ('COMMISSION','DISCOUNT_COMPENSATION','ADJUSTMENT','REVERSAL',
                                         'PAYOUT','SETTLEMENT');
CREATE TYPE translation_status  AS ENUM ('PENDING','DONE','FAILED');
CREATE TYPE case_type           AS ENUM ('LOST_ITEM','MESS_DAMAGE','FARE_PAYMENT','DRIVER_BEHAVIOUR',
                                         'RIDER_BEHAVIOUR','SAFETY','ELIGIBILITY_MISMATCH','APP','OTHER');
CREATE TYPE case_status         AS ENUM ('OPEN','IN_REVIEW','WAITING_USER','RESOLVED','CLOSED');
CREATE TYPE sos_status          AS ENUM ('RECEIVED','AGENT_JOINED','AGENT_CALLING','RESOLVED');
CREATE TYPE delivery_status     AS ENUM ('QUEUED','SENT','FAILED','NOT_APPLICABLE');
CREATE TYPE review_direction    AS ENUM ('RIDER_TO_DRIVER','DRIVER_TO_RIDER');
CREATE TYPE legal_doc_type      AS ENUM ('TERMS','PRIVACY','DRIVER_AGREEMENT','CANCELLATION','OTHER');

-- ---------------------------------------------------------------- helpers
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- reference data
CREATE TABLE currencies (
  code            char(3) PRIMARY KEY,            -- 'USD','LBP'
  minor_exponent  smallint NOT NULL CHECK (minor_exponent BETWEEN 0 AND 3)
);

-- One versioned document holding all CMS platform parameters (ACK timeout, search duration,
-- phone window, payment %, payout triggers, commission switch, published currencies, ...).
-- JSON schema validated in the application; a ride stores the version it was created under.
CREATE TABLE platform_settings_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings        jsonb NOT NULL,
  status          publish_status NOT NULL DEFAULT 'DRAFT',
  effective_at    timestamptz,
  created_by      uuid,
  published_by    uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'PUBLISHED' OR (effective_at IS NOT NULL AND published_by IS NOT NULL))
);
CREATE INDEX ON platform_settings_versions (status, effective_at DESC);

-- ---------------------------------------------------------------- identity
CREATE TABLE accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164            text NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  first_name            text,
  last_name             text,
  gender                gender,
  gender_confirmed_at   timestamptz,                 -- D-39 management confirmation
  gender_confirmed_by   uuid,
  email                 citext,
  language              app_language NOT NULL DEFAULT 'ar',
  preferred_currency    char(3) REFERENCES currencies(code),
  status                account_status NOT NULL DEFAULT 'ACTIVE',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER accounts_touch BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE rider_profiles (
  account_id      uuid PRIMARY KEY REFERENCES accounts(id),
  rating_avg_bp   integer,                           -- cached average ×100 (e.g. 482 = 4.82)
  rating_count    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_challenges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164      text NOT NULL,
  code_hash       text NOT NULL,                     -- never store the code in clear text
  provider_ref    text,
  attempts        smallint NOT NULL DEFAULT 0,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  app             app_kind NOT NULL                  -- Phase 3 amendment A-3-01: verify carries no app, so the challenge records it
);
CREATE INDEX ON otp_challenges (phone_e164, created_at DESC);

CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id),
  app                 app_kind NOT NULL,
  refresh_token_hash  text NOT NULL UNIQUE,          -- rotated on every refresh
  device_label        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz,
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoke_reason       text,
  previous_refresh_token_hash text UNIQUE            -- Phase 4 amendment A-4-01: detects reuse of a rotated refresh token
);
CREATE INDEX ON sessions (account_id) WHERE revoked_at IS NULL;

CREATE TABLE push_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  app             app_kind NOT NULL,
  platform        text NOT NULL CHECK (platform IN ('android','ios')),
  token           text NOT NULL UNIQUE,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Blocks (D-34, D-41). effective_at NULL = pending until the account's active ride ends.
CREATE TABLE account_blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  applies_to      app_kind[] NOT NULL,               -- {RIDER}, {DRIVER} or both
  reason          text NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  effective_at    timestamptz,
  lifted_at       timestamptz,
  lifted_by       uuid,
  lift_reason     text
);
CREATE INDEX ON account_blocks (account_id) WHERE lifted_at IS NULL;

-- ---------------------------------------------------------------- admin
CREATE TABLE admin_users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,
  full_name           text NOT NULL,
  password_hash       text NOT NULL,                 -- argon2id
  totp_secret_enc     bytea,                         -- encrypted; NULL until MFA enrolled
  mfa_enrolled_at     timestamptz,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DEACTIVATED')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_recovery_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        uuid NOT NULL REFERENCES admin_users(id),
  code_hash       text NOT NULL,
  used_at         timestamptz
);

CREATE TABLE admin_roles (
  code            text PRIMARY KEY,                  -- SUPER_ADMIN, DRIVER_REVIEWER, OPERATIONS, PRICING, ...
  permissions     text[] NOT NULL                    -- e.g. {'rides.read','chat.view','accounts.block'}
);

CREATE TABLE admin_user_roles (
  admin_id        uuid NOT NULL REFERENCES admin_users(id),
  role_code       text NOT NULL REFERENCES admin_roles(code),
  granted_by      uuid,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, role_code)
);

CREATE TABLE admin_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id            uuid NOT NULL REFERENCES admin_users(id),
  token_hash          text NOT NULL UNIQUE,
  mfa_verified_at     timestamptz,
  ip                  inet,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz
);

-- Append-only audit of every admin mutation and every sensitive read (chat, documents, evidence).
CREATE TABLE admin_audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id        uuid NOT NULL,
  action          text NOT NULL,                     -- 'driver.approve', 'chat.view', ...
  target_type     text NOT NULL,
  target_id       text NOT NULL,
  reason          text,
  before_state    jsonb,
  after_state     jsonb,
  ip              inet,
  correlation_id  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  actor_roles     text[]                             -- Phase 4 amendment A-4-02: role codes held when the action ran
);
CREATE INDEX ON admin_audit_log (target_type, target_id, created_at DESC);
CREATE INDEX ON admin_audit_log (admin_id, created_at DESC);
CREATE TRIGGER admin_audit_log_immutable BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------- legal documents (D-22)
CREATE TABLE legal_document_versions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type                legal_doc_type NOT NULL,
  audience                app_kind[] NOT NULL,
  version_no              integer NOT NULL,
  requires_reacceptance   boolean NOT NULL DEFAULT false,
  status                  publish_status NOT NULL DEFAULT 'DRAFT',
  published_at            timestamptz,
  published_by            uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_type, version_no)
);

CREATE TABLE legal_document_texts (
  version_id      uuid NOT NULL REFERENCES legal_document_versions(id),
  language        app_language NOT NULL,
  title           text NOT NULL,
  body_markdown   text NOT NULL,
  change_summary  text,
  PRIMARY KEY (version_id, language)
);

CREATE TABLE legal_acceptances (
  account_id      uuid NOT NULL REFERENCES accounts(id),
  version_id      uuid NOT NULL REFERENCES legal_document_versions(id),
  app             app_kind NOT NULL,
  accepted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, version_id)
);

-- ---------------------------------------------------------------- categories & documents (D-24)
CREATE TABLE document_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  names           jsonb NOT NULL,
  subject         text NOT NULL CHECK (subject IN ('DRIVER','VEHICLE')),
  has_expiry      boolean NOT NULL DEFAULT false,
  allow_gallery   boolean NOT NULL DEFAULT true,
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE vehicle_categories (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    text NOT NULL UNIQUE,      -- 'car','motorcycle','tuktuk','women_taxi',...
  names                   jsonb NOT NULL,
  descriptions            jsonb,
  base_type               vehicle_base_type NOT NULL,
  seats                   smallint NOT NULL CHECK (seats > 0),
  female_drivers_only     boolean NOT NULL DEFAULT false,   -- D-35
  female_riders_only      boolean NOT NULL DEFAULT false,
  vehicle_rules           jsonb NOT NULL DEFAULT '{}',      -- e.g. {"min_year":2015}
  icon                    text NOT NULL,
  color                   text,
  sort_order              integer NOT NULL DEFAULT 0,
  active                  boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER vehicle_categories_touch BEFORE UPDATE ON vehicle_categories FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE category_document_requirements (
  category_id         uuid NOT NULL REFERENCES vehicle_categories(id),
  document_type_id    uuid NOT NULL REFERENCES document_types(id),
  PRIMARY KEY (category_id, document_type_id)
);

-- ---------------------------------------------------------------- service zones (D-14)
CREATE TABLE service_zones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  active          boolean NOT NULL DEFAULT false,
  priority        integer NOT NULL DEFAULT 0,       -- higher wins where polygons overlap
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_zone_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id         uuid NOT NULL REFERENCES service_zones(id),
  geom            geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(geom)),
  status          publish_status NOT NULL DEFAULT 'DRAFT',
  effective_at    timestamptz,
  published_by    uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_zone_versions_geom ON service_zone_versions USING gist (geom) WHERE status = 'PUBLISHED';
CREATE UNIQUE INDEX one_published_version_per_zone ON service_zone_versions (zone_id) WHERE status = 'PUBLISHED';

CREATE TABLE zone_category_settings (
  zone_id             uuid NOT NULL REFERENCES service_zones(id),
  category_id         uuid NOT NULL REFERENCES vehicle_categories(id),
  enabled             boolean NOT NULL DEFAULT false,
  search_radius_m     integer NOT NULL DEFAULT 5000 CHECK (search_radius_m BETWEEN 200 AND 50000),
  PRIMARY KEY (zone_id, category_id)
);

-- ---------------------------------------------------------------- drivers & vehicles
CREATE TABLE driver_profiles (
  account_id          uuid PRIMARY KEY REFERENCES accounts(id),
  status              driver_status NOT NULL DEFAULT 'ONBOARDING',
  status_reason       text,
  submitted_at        timestamptz,
  decided_at          timestamptz,
  decided_by          uuid,
  current_vehicle_id  uuid,
  rating_avg_bp       integer,
  rating_count        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER driver_profiles_touch BEFORE UPDATE ON driver_profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE vehicles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       uuid NOT NULL REFERENCES driver_profiles(account_id),
  base_type       vehicle_base_type NOT NULL,
  make            text NOT NULL,
  model           text NOT NULL,
  year            smallint,
  color           text NOT NULL,
  plate           text NOT NULL,
  seats           smallint NOT NULL CHECK (seats > 0),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vehicles_plate_active ON vehicles (upper(plate)) WHERE active;
ALTER TABLE driver_profiles ADD FOREIGN KEY (current_vehicle_id) REFERENCES vehicles(id);

CREATE TABLE driver_category_approvals (
  driver_id       uuid NOT NULL REFERENCES driver_profiles(account_id),
  category_id     uuid NOT NULL REFERENCES vehicle_categories(id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  status          approval_status NOT NULL DEFAULT 'PENDING',
  reason          text,
  decided_by      uuid,
  decided_at      timestamptz,
  PRIMARY KEY (driver_id, category_id)
);

CREATE TABLE uploads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id    uuid NOT NULL REFERENCES accounts(id),
  purpose             text NOT NULL CHECK (purpose IN ('DRIVER_DOCUMENT','PROFILE_PHOTO','VEHICLE_CHECK','CASE_EVIDENCE')),
  object_key          text NOT NULL UNIQUE,
  content_type        text NOT NULL,
  max_bytes           integer NOT NULL,
  size_bytes          integer,
  sha256              text,
  status              upload_status NOT NULL DEFAULT 'AUTHORIZED',
  expires_at          timestamptz NOT NULL,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  staging_object_key  text UNIQUE                       -- Phase 4 amendment A-4-12: the only key a presigned PUT targets; NULL once swept
);

CREATE TABLE driver_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           uuid NOT NULL REFERENCES driver_profiles(account_id),
  vehicle_id          uuid REFERENCES vehicles(id),
  document_type_id    uuid NOT NULL REFERENCES document_types(id),
  upload_id           uuid NOT NULL REFERENCES uploads(id),
  expires_on          date,
  status              document_status NOT NULL DEFAULT 'UPLOADED',
  review_reason       text,
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- One current (non-superseded, non-rejected) document per driver/vehicle/type.
CREATE UNIQUE INDEX one_current_document ON driver_documents
  (driver_id, coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid), document_type_id)
  WHERE status IN ('UPLOADED','APPROVED','NEEDS_CHANGES');

CREATE TABLE vehicle_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  due_on          date NOT NULL,
  status          vehicle_check_status NOT NULL DEFAULT 'DUE',
  submitted_at    timestamptz,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  review_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_open_check_per_vehicle ON vehicle_checks (vehicle_id) WHERE status IN ('DUE','SUBMITTED','NEEDS_CHANGES');

CREATE TABLE vehicle_check_photos (
  check_id        uuid NOT NULL REFERENCES vehicle_checks(id),
  slot            text NOT NULL,                     -- 'front','back','left','right','interior',...
  upload_id       uuid NOT NULL REFERENCES uploads(id),
  PRIMARY KEY (check_id, slot)
);

CREATE TABLE driver_online_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       uuid NOT NULL REFERENCES driver_profiles(account_id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  end_reason      text
);
CREATE UNIQUE INDEX one_open_online_session ON driver_online_sessions (driver_id) WHERE ended_at IS NULL;

-- ---------------------------------------------------------------- rider places
CREATE TABLE saved_places (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id        uuid NOT NULL REFERENCES rider_profiles(account_id),
  label           text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  icon            text,
  address_text    text,
  location        geography(Point, 4326) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON saved_places (rider_id);

-- ---------------------------------------------------------------- pricing (D-15, D-20, D-25, D-26)
CREATE TABLE tariff_versions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id                 uuid NOT NULL REFERENCES vehicle_categories(id),
  zone_id                     uuid NOT NULL REFERENCES service_zones(id),
  currency                    char(3) NOT NULL REFERENCES currencies(code),
  base_minor                  bigint NOT NULL CHECK (base_minor >= 0),
  per_km_minor                bigint NOT NULL CHECK (per_km_minor >= 0),
  per_minute_minor            bigint NOT NULL CHECK (per_minute_minor >= 0),
  minimum_minor               bigint NOT NULL CHECK (minimum_minor >= 0),
  rounding_increment_minor    bigint NOT NULL DEFAULT 1 CHECK (rounding_increment_minor > 0),
  fare_mode                   fare_mode NOT NULL DEFAULT 'FIXED',
  recalc_cap_bp               integer CHECK (recalc_cap_bp BETWEEN 0 AND 10000),
  status                      publish_status NOT NULL DEFAULT 'DRAFT',
  effective_at                timestamptz,
  created_by                  uuid,
  published_by                uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (fare_mode = 'FIXED' OR recalc_cap_bp IS NOT NULL)
);
CREATE INDEX tariff_lookup ON tariff_versions (category_id, zone_id, currency, effective_at DESC) WHERE status = 'PUBLISHED';

CREATE TABLE surge_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id         uuid NOT NULL REFERENCES service_zones(id),
  category_id     uuid REFERENCES vehicle_categories(id),   -- NULL = all categories in zone
  multiplier_bp   integer NOT NULL CHECK (multiplier_bp BETWEEN 10000 AND 50000),
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL CHECK (ends_at > starts_at),
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON surge_rules (zone_id, starts_at, ends_at) WHERE active;

CREATE TABLE addons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  names           jsonb NOT NULL,
  kind            value_kind NOT NULL,
  currency        char(3) REFERENCES currencies(code),      -- required for FIXED
  amount_minor    bigint CHECK (amount_minor >= 0),
  percent_bp      integer CHECK (percent_bp BETWEEN 0 AND 10000),
  zone_id         uuid REFERENCES service_zones(id),
  category_id     uuid REFERENCES vehicle_categories(id),
  schedule        jsonb,                                     -- optional days/hours
  starts_at       timestamptz,
  ends_at         timestamptz,
  active          boolean NOT NULL DEFAULT false,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'FIXED' AND currency IS NOT NULL AND amount_minor IS NOT NULL)
      OR (kind = 'PERCENT' AND percent_bp IS NOT NULL))
);

CREATE TABLE discounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                    discount_kind NOT NULL,
  code                    citext UNIQUE,                     -- promo code; NULL for AUTOMATIC
  names                   jsonb NOT NULL,
  value_kind              value_kind NOT NULL,
  percent_bp              integer CHECK (percent_bp BETWEEN 1 AND 10000),
  currency                char(3) REFERENCES currencies(code),
  amount_minor            bigint CHECK (amount_minor > 0),
  max_discount_minor      jsonb,                             -- {"USD":200,"LBP":180000}
  zone_ids                uuid[],                            -- NULL = all zones
  category_ids            uuid[],                            -- NULL = all categories
  starts_at               timestamptz NOT NULL,
  ends_at                 timestamptz NOT NULL CHECK (ends_at > starts_at),
  total_limit             integer,
  per_rider_limit         integer,
  platform_share_bp       integer NOT NULL DEFAULT 10000 CHECK (platform_share_bp BETWEEN 0 AND 10000), -- D-31
  active                  boolean NOT NULL DEFAULT false,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'PROMO_CODE') = (code IS NOT NULL)),
  CHECK ((value_kind = 'PERCENT' AND percent_bp IS NOT NULL)
      OR (value_kind = 'FIXED' AND currency IS NOT NULL AND amount_minor IS NOT NULL))
);

CREATE TABLE commission_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     uuid NOT NULL REFERENCES vehicle_categories(id),
  zone_id         uuid REFERENCES service_zones(id),         -- NULL = all zones
  rate_bp         integer NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  status          publish_status NOT NULL DEFAULT 'DRAFT',
  effective_at    timestamptz,
  published_by    uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- quotes & rides
CREATE TABLE quotes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id                uuid NOT NULL REFERENCES rider_profiles(account_id),
  category_id             uuid NOT NULL REFERENCES vehicle_categories(id),
  zone_id                 uuid NOT NULL REFERENCES service_zones(id),
  pickup                  geography(Point, 4326) NOT NULL,
  dropoff                 geography(Point, 4326) NOT NULL,
  pickup_text             text,
  dropoff_text            text,
  route_distance_m        integer NOT NULL,
  route_duration_s        integer NOT NULL,
  route_polyline          text,
  surge_rule_id           uuid REFERENCES surge_rules(id),
  surge_multiplier_bp     integer NOT NULL DEFAULT 10000,
  discount_id             uuid REFERENCES discounts(id),
  settings_version_id     uuid NOT NULL REFERENCES platform_settings_versions(id),
  expires_at              timestamptz NOT NULL,
  used_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON quotes (rider_id, created_at DESC);

CREATE TABLE quote_amounts (
  quote_id            uuid NOT NULL REFERENCES quotes(id),
  currency            char(3) NOT NULL REFERENCES currencies(code),
  tariff_version_id   uuid NOT NULL REFERENCES tariff_versions(id),
  gross_minor         bigint NOT NULL,
  discount_minor      bigint NOT NULL DEFAULT 0,
  total_minor         bigint NOT NULL CHECK (total_minor >= 0),
  breakdown           jsonb NOT NULL,     -- base, distance, time, surge, addons[], minimum_adjustment, discount, rounding
  PRIMARY KEY (quote_id, currency)
);

CREATE TABLE rides (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id                    uuid NOT NULL REFERENCES rider_profiles(account_id),
  quote_id                    uuid NOT NULL UNIQUE REFERENCES quotes(id),
  request_idempotency_key     text NOT NULL,
  category_id                 uuid NOT NULL REFERENCES vehicle_categories(id),
  category_snapshot           jsonb NOT NULL,         -- names, icon, base_type, women-only flags at request time
  zone_id                     uuid NOT NULL REFERENCES service_zones(id),
  pickup                      geography(Point, 4326) NOT NULL,
  dropoff                     geography(Point, 4326) NOT NULL,
  pickup_text                 text,
  dropoff_text                text,
  status                      ride_status NOT NULL DEFAULT 'SEARCHING',
  version                     integer NOT NULL DEFAULT 1,
  settings_version_id         uuid NOT NULL REFERENCES platform_settings_versions(id),
  fare_mode                   fare_mode NOT NULL,
  recalc_cap_bp               integer,
  payment_request_pct         smallint NOT NULL DEFAULT 100 CHECK (payment_request_pct BETWEEN 1 AND 100), -- D-28
  commission_counted          boolean NOT NULL,       -- D-42 snapshot of the CMS switch
  commission_rate_bp          integer NOT NULL DEFAULT 0,
  discount_id                 uuid REFERENCES discounts(id),
  discount_platform_share_bp  integer,
  search_deadline_at          timestamptz NOT NULL,
  next_dispatch_at            timestamptz,
  dispatch_attempts           integer NOT NULL DEFAULT 0,
  requested_at                timestamptz NOT NULL DEFAULT now(),
  confirmed_at                timestamptz,
  arrived_at                  timestamptz,
  started_at                  timestamptz,
  completed_at                timestamptz,
  ended_at                    timestamptz,
  actual_distance_m           integer,
  actual_duration_s           integer,
  end_actor                   actor_role,
  end_reason                  text,
  UNIQUE (rider_id, request_idempotency_key)
);
CREATE UNIQUE INDEX one_active_ride_per_rider ON rides (rider_id)
  WHERE status IN ('SEARCHING','CONFIRMED','AT_PICKUP','IN_PROGRESS');
CREATE INDEX rides_dispatch_due ON rides (next_dispatch_at) WHERE status = 'SEARCHING';
CREATE INDEX rides_search_deadline ON rides (search_deadline_at) WHERE status = 'SEARCHING';
CREATE INDEX ON rides (rider_id, requested_at DESC);

CREATE TABLE ride_fares (
  ride_id                 uuid NOT NULL REFERENCES rides(id),
  currency                char(3) NOT NULL REFERENCES currencies(code),
  tariff_version_id       uuid NOT NULL REFERENCES tariff_versions(id),
  quoted_gross_minor      bigint NOT NULL,
  quoted_discount_minor   bigint NOT NULL,
  quoted_total_minor      bigint NOT NULL,
  final_total_minor       bigint,                     -- set at completion (= quoted in FIXED mode)
  quoted_breakdown        jsonb NOT NULL,
  final_breakdown         jsonb,
  PRIMARY KEY (ride_id, currency)
);

CREATE TABLE ride_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id             uuid NOT NULL REFERENCES rides(id),
  driver_id           uuid NOT NULL REFERENCES driver_profiles(account_id),
  vehicle_id          uuid NOT NULL REFERENCES vehicles(id),
  attempt_no          integer NOT NULL,
  driver_attempt_no   smallint NOT NULL,
  state               offer_state NOT NULL DEFAULT 'PENDING_ACK',
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  ack_deadline_at     timestamptz NOT NULL,
  acknowledged_at     timestamptz,
  accept_deadline_at  timestamptz,
  resolved_at         timestamptz,
  end_reason          offer_end_reason,
  UNIQUE (ride_id, attempt_no),
  CHECK (state <> 'ACTIVE' OR (acknowledged_at IS NOT NULL
         AND accept_deadline_at = acknowledged_at + interval '3 seconds')),
  CHECK ((state IN ('PENDING_ACK','ACTIVE')) = (resolved_at IS NULL))
);
CREATE UNIQUE INDEX one_outstanding_offer_per_ride   ON ride_offers (ride_id)   WHERE state IN ('PENDING_ACK','ACTIVE');
CREATE UNIQUE INDEX one_outstanding_offer_per_driver ON ride_offers (driver_id) WHERE state IN ('PENDING_ACK','ACTIVE');
CREATE INDEX offers_ack_due    ON ride_offers (ack_deadline_at)    WHERE state = 'PENDING_ACK';
CREATE INDEX offers_accept_due ON ride_offers (accept_deadline_at) WHERE state = 'ACTIVE';
CREATE INDEX ON ride_offers (ride_id, driver_id);

CREATE TABLE ride_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id         uuid NOT NULL REFERENCES rides(id),
  driver_id       uuid NOT NULL REFERENCES driver_profiles(account_id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  offer_id        uuid NOT NULL UNIQUE REFERENCES ride_offers(id),
  vehicle_snapshot jsonb NOT NULL,                    -- make, model, colour, plate at assignment
  assigned_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at        timestamptz,
  outcome         text
);
CREATE UNIQUE INDEX one_open_assignment_per_ride   ON ride_assignments (ride_id)   WHERE ended_at IS NULL;
CREATE UNIQUE INDEX one_open_assignment_per_driver ON ride_assignments (driver_id) WHERE ended_at IS NULL;

CREATE TABLE ride_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id         uuid NOT NULL REFERENCES rides(id),
  ride_version    integer NOT NULL,
  from_status     ride_status,
  to_status       ride_status NOT NULL,
  actor_role      actor_role NOT NULL,
  actor_id        uuid,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON ride_events (ride_id, id);
CREATE TRIGGER ride_events_immutable BEFORE UPDATE OR DELETE ON ride_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Sampled trip trail (not every GPS update). Retention per policy (TBD, legal review).
CREATE TABLE trip_location_samples (
  ride_id         uuid NOT NULL REFERENCES rides(id),
  captured_at     timestamptz NOT NULL,
  location        geography(Point, 4326) NOT NULL,
  accuracy_m      real,
  PRIMARY KEY (ride_id, captured_at)
);

CREATE TABLE discount_redemptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_id     uuid NOT NULL REFERENCES discounts(id),
  rider_id        uuid NOT NULL REFERENCES rider_profiles(account_id),
  ride_id         uuid NOT NULL UNIQUE REFERENCES rides(id),
  status          redemption_status NOT NULL DEFAULT 'RESERVED',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON discount_redemptions (discount_id, rider_id) WHERE status <> 'RELEASED';

-- ---------------------------------------------------------------- payments & ledger (D-28..D-31, D-38, D-42, D-43)
CREATE TABLE payment_methods (
  code                text PRIMARY KEY,               -- 'cash','omt','whish','bank','card'
  names               jsonb NOT NULL,
  enabled             boolean NOT NULL DEFAULT false,
  adapter_available   boolean NOT NULL DEFAULT false, -- set by deployment, not by CMS users
  config_enc          bytea,
  updated_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR adapter_available)
);

CREATE TABLE ride_payments (
  ride_id                 uuid PRIMARY KEY REFERENCES rides(id),
  method_code             text NOT NULL REFERENCES payment_methods(code),
  status                  payment_status NOT NULL DEFAULT 'NOT_DUE',
  due_at                  timestamptz,
  recorded_currency       char(3) REFERENCES currencies(code),
  recorded_amount_minor   bigint CHECK (recorded_amount_minor >= 0),
  recorded_by             uuid,
  recorded_at             timestamptz,
  discrepancy_reason      text,
  tip_currency            char(3) REFERENCES currencies(code),   -- information only (D-42)
  tip_amount_minor        bigint CHECK (tip_amount_minor >= 0),
  resolution              text,
  resolved_by             uuid,
  resolved_at             timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('RECORDED','DISPUTED') OR (recorded_currency IS NOT NULL AND recorded_amount_minor IS NOT NULL))
);

-- Driver wallet ledger. Positive amount = Wasselne owes the driver.
CREATE TABLE ledger_entries (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id           uuid NOT NULL REFERENCES driver_profiles(account_id),
  currency            char(3) NOT NULL REFERENCES currencies(code),
  amount_minor        bigint NOT NULL CHECK (amount_minor <> 0),
  entry_type          ledger_entry_type NOT NULL,
  ride_id             uuid REFERENCES rides(id),
  payout_id           uuid,
  settlement_id       uuid,
  reverses_entry_id   bigint REFERENCES ledger_entries(id),
  reason              text,
  created_by          uuid,                            -- NULL = system
  idempotency_key     text NOT NULL UNIQUE,            -- e.g. 'ride:{id}:COMMISSION'
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (entry_type NOT IN ('ADJUSTMENT','REVERSAL') OR reason IS NOT NULL),
  CHECK (entry_type <> 'REVERSAL' OR reverses_entry_id IS NOT NULL)
);
CREATE INDEX ON ledger_entries (driver_id, currency, id);
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE VIEW driver_wallet_balances AS
  SELECT driver_id, currency, sum(amount_minor)::bigint AS balance_minor, max(created_at) AS last_entry_at
  FROM ledger_entries GROUP BY driver_id, currency;

CREATE TABLE payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       uuid NOT NULL REFERENCES driver_profiles(account_id),
  currency        char(3) NOT NULL REFERENCES currencies(code),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  method          text NOT NULL,                       -- TBD; free text until methods are defined
  reference       text,
  recorded_by     uuid NOT NULL,
  paid_at         timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settlement_methods (
  code            text PRIMARY KEY,                    -- 'payout_deduction','cash_pickup',...
  names           jsonb NOT NULL,
  enabled         boolean NOT NULL DEFAULT false,
  instructions    jsonb,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_settlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       uuid NOT NULL REFERENCES driver_profiles(account_id),
  currency        char(3) NOT NULL REFERENCES currencies(code),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  method_code     text NOT NULL REFERENCES settlement_methods(code),
  reference       text,
  recorded_by     uuid NOT NULL,
  collected_at    timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ledger_entries ADD FOREIGN KEY (payout_id) REFERENCES payouts(id);
ALTER TABLE ledger_entries ADD FOREIGN KEY (settlement_id) REFERENCES driver_settlements(id);

-- ---------------------------------------------------------------- chat (BR-31/32, D-33)
CREATE TABLE chat_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id             uuid NOT NULL REFERENCES rides(id),
  sender_id           uuid NOT NULL REFERENCES accounts(id),
  sender_role         actor_role NOT NULL CHECK (sender_role IN ('RIDER','DRIVER')),
  client_message_id   text NOT NULL,
  body                text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  source_language     text,
  seen_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (sender_id, client_message_id)
);
CREATE INDEX ON chat_messages (ride_id, created_at);

CREATE TABLE chat_translations (
  message_id          uuid NOT NULL REFERENCES chat_messages(id),
  target_language     app_language NOT NULL,
  text                text,
  status              translation_status NOT NULL DEFAULT 'PENDING',
  provider            text,
  error               text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, target_language)
);

-- ---------------------------------------------------------------- support & SOS (BR-33..37, 47..49, D-17, D-21)
CREATE TABLE support_cases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type           case_type NOT NULL,
  ride_id             uuid REFERENCES rides(id),
  reporter_id         uuid NOT NULL REFERENCES accounts(id),
  reporter_role       actor_role NOT NULL,
  status              case_status NOT NULL DEFAULT 'OPEN',
  subject             text,
  assigned_admin_id   uuid REFERENCES admin_users(id),
  resolution          text,
  resolved_by         uuid,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('RESOLVED','CLOSED') OR resolution IS NOT NULL)
);
CREATE INDEX ON support_cases (status, created_at);
CREATE INDEX ON support_cases (ride_id);

CREATE TABLE case_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             uuid NOT NULL REFERENCES support_cases(id),
  author_account_id   uuid REFERENCES accounts(id),
  author_admin_id     uuid REFERENCES admin_users(id),
  client_message_id   text,
  body                text NOT NULL,
  internal_note       boolean NOT NULL DEFAULT false,  -- staff-only
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((author_account_id IS NULL) <> (author_admin_id IS NULL))
);

CREATE TABLE case_evidence (
  case_id         uuid NOT NULL REFERENCES support_cases(id),
  upload_id       uuid NOT NULL REFERENCES uploads(id),
  added_by        uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, upload_id)
);

CREATE TABLE sos_config_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config          jsonb NOT NULL,    -- {actions:["AGENT_CHAT"], fallback_number, oncall_channels, hours, escalation_s}
  status          publish_status NOT NULL DEFAULT 'DRAFT',
  effective_at    timestamptz,
  published_by    uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_agent_presence (
  admin_id        uuid PRIMARY KEY REFERENCES admin_users(id),
  on_shift_since  timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL
);

CREATE TABLE sos_incidents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id                 uuid REFERENCES rides(id),
  reporter_id             uuid NOT NULL REFERENCES accounts(id),
  reporter_role           actor_role NOT NULL,
  client_request_id       text NOT NULL,
  sos_config_version_id   uuid NOT NULL REFERENCES sos_config_versions(id),
  location                geography(Point, 4326),
  location_captured_at    timestamptz,
  status                  sos_status NOT NULL DEFAULT 'RECEIVED',
  assigned_agent_id       uuid REFERENCES admin_users(id),
  agent_joined_at         timestamptz,
  agent_calling_at        timestamptz,
  no_agent_fallback       boolean NOT NULL DEFAULT false,
  oncall_alert_status     delivery_status NOT NULL DEFAULT 'NOT_APPLICABLE',
  resolution              text,
  resolved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (reporter_id, client_request_id)
);
CREATE INDEX ON sos_incidents (status, created_at) WHERE status <> 'RESOLVED';

CREATE TABLE sos_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id         uuid NOT NULL REFERENCES sos_incidents(id),
  author_account_id   uuid REFERENCES accounts(id),
  author_admin_id     uuid REFERENCES admin_users(id),
  client_message_id   text,
  body                text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((author_account_id IS NULL) <> (author_admin_id IS NULL))
);

-- ---------------------------------------------------------------- reviews (BR-38..40, D-37)
CREATE TABLE reviews (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id                 uuid NOT NULL REFERENCES rides(id),
  direction               review_direction NOT NULL,
  reviewer_id             uuid NOT NULL REFERENCES accounts(id),
  reviewee_id             uuid NOT NULL REFERENCES accounts(id),
  rating                  smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment                 text CHECK (length(comment) <= 1000),
  tags                    text[],
  declared_tip_currency   char(3) REFERENCES currencies(code),   -- rider-declared, information only
  declared_tip_minor      bigint CHECK (declared_tip_minor >= 0),
  moderation_status       text NOT NULL DEFAULT 'VISIBLE' CHECK (moderation_status IN ('VISIBLE','HIDDEN')),
  moderated_by            uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, direction),
  CHECK (reviewer_id <> reviewee_id)
);

-- ---------------------------------------------------------------- reliability plumbing
CREATE TABLE idempotency_keys (
  actor_id            uuid NOT NULL,
  operation           text NOT NULL,
  key                 text NOT NULL,
  request_hash        text NOT NULL,
  response_status     smallint,
  response_body       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation, key)
);

CREATE TABLE outbox_events (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id            uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  aggregate_type      text NOT NULL,
  aggregate_id        uuid NOT NULL,
  aggregate_version   integer,
  event_type          text NOT NULL,
  payload             jsonb NOT NULL,
  available_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_until       timestamptz,
  attempts            smallint NOT NULL DEFAULT 0,
  processed_at        timestamptz,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX outbox_pending ON outbox_events (available_at) WHERE processed_at IS NULL;

CREATE TABLE delivery_attempts (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outbox_event_id     bigint NOT NULL REFERENCES outbox_events(id),
  channel             text NOT NULL CHECK (channel IN ('SOCKET','PUSH','SMS','EMAIL')),
  target_account_id   uuid,
  status              delivery_status NOT NULL,
  provider_ref        text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- ---------------------------------------------------------------- driver eligibility (Phase 4 amendment A-4-03, A-4-11)
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

-- Returns the reasons a driver may NOT receive an offer in a category; an empty array = eligible
-- as far as identity, approval and documents go. Live state (online session, outstanding offer,
-- open assignment, debt limit, fresh presence) is checked by dispatch in Phase 6.
-- "Today" is the calendar date in Lebanon; the timezone is an assumption (register TBD-4-01).
CREATE FUNCTION driver_ineligibility_reasons(p_driver uuid, p_category uuid) RETURNS text[]
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

CREATE FUNCTION ride_offers_require_eligible_driver() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reasons text[];
  v_category uuid;
  v_current_vehicle uuid;
BEGIN
  IF NEW.state NOT IN ('PENDING_ACK', 'ACTIVE') THEN RETURN NEW; END IF;
  SELECT r.category_id INTO v_category FROM rides r WHERE r.id = NEW.ride_id;
  reasons := driver_ineligibility_reasons(NEW.driver_id, v_category);
  SELECT dp.current_vehicle_id INTO v_current_vehicle FROM driver_profiles dp WHERE dp.account_id = NEW.driver_id;
  IF NEW.vehicle_id IS DISTINCT FROM v_current_vehicle THEN reasons := array_append(reasons, 'VEHICLE_MISMATCH'); END IF;
  IF cardinality(reasons) > 0 THEN
    RAISE EXCEPTION 'driver % is not eligible: %', NEW.driver_id, array_to_string(reasons, ',') USING ERRCODE = 'WE001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ride_offers_eligibility BEFORE INSERT ON ride_offers
  FOR EACH ROW EXECUTE FUNCTION ride_offers_require_eligible_driver();

-- ---------------------------------------------------------------- seed reference rows (no prices, no legal text)
INSERT INTO currencies (code, minor_exponent) VALUES ('USD', 2), ('LBP', 0);
INSERT INTO payment_methods (code, names, enabled, adapter_available) VALUES
  ('cash',  '{"en":"Cash","ar":"نقداً","fr":"Espèces"}', true,  true),
  ('omt',   '{"en":"OMT","ar":"OMT","fr":"OMT"}',       false, false),
  ('whish', '{"en":"Whish","ar":"Whish","fr":"Whish"}', false, false),
  ('bank',  '{"en":"Bank","ar":"مصرف","fr":"Banque"}',  false, false),
  ('card',  '{"en":"Card","ar":"بطاقة","fr":"Carte"}',  false, false);
INSERT INTO settlement_methods (code, names) VALUES
  ('payout_deduction', '{"en":"Deduct from payout","ar":"خصم من الدفعة","fr":"Déduction du versement"}'),
  ('cash_pickup',      '{"en":"Cash pickup","ar":"استلام نقدي","fr":"Collecte en espèces"}');
-- Role codes follow docs/phase-1/03_Admin_Console.md §2. Permission strings are the ones the
-- API enforces today; later phases add strings with their screens. SUPPORT/SAFETY scoped ("S")
-- access needs cases and incidents (Phase 9), so those roles hold no Phase 4 permission yet.
INSERT INTO admin_roles (code, permissions) VALUES
  ('SUPER_ADMIN',    ARRAY['riders.read','riders.gender_confirm','accounts.block','drivers.read','drivers.manage','approvals.read','approvals.review','documents.view','audit.read','audit.export']),
  ('DRIVER_REVIEWER', ARRAY['drivers.read','drivers.manage','approvals.read','approvals.review','documents.view']),
  ('OPERATIONS',     ARRAY['riders.read','drivers.read','accounts.block']),
  ('PRICING',        ARRAY[]::text[]),
  ('SUPPORT',        ARRAY[]::text[]),
  ('SAFETY',         ARRAY[]::text[]),
  ('FINANCE',        ARRAY['riders.read','drivers.read']),
  ('CONTENT_EDITOR', ARRAY[]::text[]),
  ('AUDITOR',        ARRAY['riders.read','drivers.read','approvals.read','audit.read','audit.export']);
