-- Phase 3 amendment A-3-01 (mirrors docs/phase-2/schema.sql). POST /auth/otp/verify has no `app`
-- field in the OpenAPI contract, so the app that requested the code is stored on the challenge.
ALTER TABLE otp_challenges ADD COLUMN app app_kind NOT NULL DEFAULT 'RIDER';
ALTER TABLE otp_challenges ALTER COLUMN app DROP DEFAULT;
