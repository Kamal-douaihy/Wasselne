# Wasselne — Phase 4 Report: Identity, onboarding, and eligibility

**Status:** Delivered, **awaiting owner approval**. Phase 3 is committed (`6d6b023`); all Phase 4 work is uncommitted in the working tree. Phase 5 has not started.
**Date:** 2026-09-25. **Evidence:** raw command output in `docs/phase-4/evidence/` (macOS arm64, Node 22, Flutter 3.47.5, local Docker: PostgreSQL 16/PostGIS, Redis 7, MinIO).

## 1. Goal

Rider and driver sign-in and profiles; category-specific driver and vehicle onboarding; private uploads; admin approval, rejection, suspension and reinstatement; permissions and audit; expiry and review status; approval/eligibility enforced for every future offer; minimal integrated app and admin screens; authorization tests.

## 2. Phase 3 approval

The owner wrote "Aproved phase 3, proceed" on 2026-09-25. The amendments A-3-01..04 (register §10a) were not listed separately; this report treats them as accepted with Phase 3 unless the owner says otherwise. Phase 3 is now committed as `6d6b023`. Phase 3 items that were listed as "not implemented, Phase 4" are all done here except the ones in §7.

## 3. What was built

**Database (migrations 020–021, mirrored in `schema.sql`, gate passes with 14 invariants).** `driver_ineligibility_reasons(driver, category)` is the single eligibility rule: account active, driver `APPROVED`, no effective or pending block, category active and approved and not paused, vehicle present and active, vehicle fits the category's current base type, seat count and minimum year (`vehicle_category_fit_reasons()`, the same function category selection and the vehicle step use; added by review fix H1, §6), category approval made for the current vehicle, women-only ⇒ gender `FEMALE` and management-confirmed, every required document approved and unexpired, no vehicle check past `due_on + grace` (D-40, grace from published platform settings, default 7). A trigger on `ride_offers` calls it for every new `PENDING_ACK`/`ACTIVE` offer, so an ineligible driver cannot be given an offer by any code path (raises SQLSTATE `WE001`). Also: rotated-refresh-token hash, audit `actor_roles`, admin role/permission seed.

**API (NestJS).**
- *Identity:* refresh with rotation and reuse detection (reuse revokes the session), logout, `PATCH /me`, legal documents (list, accept, completeness check at sign-up, terms retrievable with the sign-up token), push devices. Every authenticated request re-checks the session, the account and blocks in PostgreSQL, so revocation and blocking take effect on the next request. Tokens are app-scoped (a rider token gets `NOT_AUTHORIZED` on driver routes).
- *Uploads:* presigned PUT to a private MinIO/S3 staging key; completion copies it server-side to a random final key that is never signed for writing, checks size, magic bytes and sha256 on that copy, and deletes the staging object (review fix H2, §6); owner-only; the worker cleans up abandoned grants and anything re-PUT to staging after expiry.
- *Driver onboarding:* profile + legal acceptance, vehicle (plates normalised and unique), categories (vehicle type, seats, minimum year, women-only), documents (required by the chosen categories only, expiry rules, supersede on replace), checklist, submit; plus `GET /driver/onboarding/options` (CMS categories and their required documents).
- *Admin:* password (argon2id) + mandatory TOTP, enrolment with 10 hashed recovery codes, replay protection, per-email/per-IP/per-admin limits, server-side logout; nine roles with permissions from the Phase 1 matrix; riders and drivers lists and details (search, cursor pagination); approval queue; document view by short-lived signed URL (audited); document approve/reject/request-changes; driver approve/reject/suspend/reinstate; category edit; gender confirmation (D-39); block/unblock with the D-41 queue-until-trip-end rule; audit log (written in the same transaction as the action, append-only). `admin:create` CLI creates the first admin (no default credentials).
- *Worker:* document-expiry sweep and upload cleanup every 15 minutes.

**Admin console (Next.js).** Sign-in with MFA enrolment (QR, key, recovery codes with a "saved" gate), approval queue and detail with document viewer and reason dialogs, drivers, riders, audit log; navigation limited by role; httpOnly SameSite=Strict session cookie; browser calls go through a same-origin proxy that adds the session and requires a CSRF header; security headers.

**Flutter.** Shared in `flutter_core`: API client with single-flight refresh-and-retry, secure token store, sign-in flow (phone, code, profile with terms), driver onboarding screen (profile, vehicle, categories, documents with camera/gallery and expiry date, submit, review statuses). Rider app: sign-in and a home that says booking is not available yet. Driver app: sign-in and the application. Arabic (RTL), English, French.

## 4. Verification actually performed

| Check | Result | Evidence |
|---|---|---|
| `lint`, `typecheck`, `build` (api, admin, contracts, design-tokens) | pass | 01 |
| Schema gate: 14 invariants rejected with the expected SQLSTATE (incl. offers to suspended / unapproved-category / blocked drivers, and to a vehicle with too few seats for the category), self-test fails as intended, migrations == schema.sql | pass | 02, 16 |
| API unit tests | 11 passed | 03, 16 |
| API e2e on isolated database, real Redis and MinIO, every response checked against `openapi.yaml`: **121 passed** in 7 suites (sessions 19, uploads 12, onboarding 27, admin 40, plus the 23 Phase 3 tests). 8 consecutive full runs green after a test-harness fix (§5). After review fixes H1/H2 (§6): **126 passed** (uploads 13, onboarding 31), one full run | pass | 04, 16 |
| Authorization: all 9 roles × every implemented admin route against the Phase 1 matrix (403 vs pass-through), denied request leaves no data or audit change, tokens of one kind rejected on the other's routes, expired/revoked/no-MFA/deactivated admin sessions | pass | 04 |
| Concurrency: 3 reviewers approving one application → 1 winner and 1 audit row; approve vs reject; document replaced while decided; 5 parallel blocks → 1 block; 3 parallel refreshes → 1 success | pass | 04 |
| Admin console in a real Chromium against the real API/DB/Redis/MinIO: 11 scenarios (enrolment, wrong password, role-limited nav, document view, approve documents and driver with reason dialogs, suspend/reinstate, CSRF refusal, server-side sign-out, auditor read-only, direct API call refused, headers) | 11 passed | 07 |
| Dart `ApiClient` against the real API and MinIO (sign-in, terms, profile, onboarding, real presigned upload, submit, refresh rotation, reuse revoking the session) | pass | 08 |
| Flutter: analyze clean, `flutter_core` 43 tests (2 live tests skipped in the default run), rider 2, driver 2, format clean, `flutter build web` rider and driver | pass | 09–12 |
| Phase 3 smoke test (isolated database) | pass | 13 |
| No leftover databases, Redis keys or S3 objects | pass | 14 |
| `admin:create` CLI (validation, idempotent re-run, argon2id hash; run by hand, not part of the test suites) | pass | 15 |

Tests found and fixed real defects while writing them: the Verify button never enabled (no rebuild on typing); `details.reason` was never parsed by the Dart client; enum-array columns read back as strings (`applies_to`); duplicate DOM ids broke the reason dialog labels; pagination cursors lost microsecond precision; the token generator emitted invalid CSS (Phase 3 file, first consumed now).

## 5. Test-harness defect found and fixed

About one in three full e2e runs failed with garbled or headerless responses. Cause: supertest given the bare `http.Server` listens and closes it around each request, and the `Promise.all` tests closed it under each other. The harness now listens once on an ephemeral port. Production code was not involved. Before the fix the Phase 3 evidence claimed 23/23; those runs happened to pass.

## 6. Review fixes after delivery (H1, H2)

An external review of the delivered Phase 4 raised two high-severity findings. Both were confirmed in the code and fixed. Migration `021_vehicle_fit_and_upload_staging.sql` is new, not an edit to 020, so databases that already applied 020 pick it up.

**H1: eligibility ignored seats and minimum year.** Category selection checked base type, seats, minimum year and the women-only rule, but `driver_ineligibility_reasons()` checked only base type. Editing the vehicle dropped selections only on a base-type change. A driver could lower seats or year after selecting a category, or the CMS could tighten a category after approval, and still be approved and offered rides. Fix (A-4-11): new function `vehicle_category_fit_reasons(vehicle, category)` (codes `VEHICLE_TYPE`, `SEATS`, `VEHICLE_YEAR`; no vehicle year, or a non-numeric `min_year`, fails a minimum-year rule). It is used by the eligibility rule (reported as `VEHICLE_CATEGORY_MISMATCH:<code>`, which admin approval, admin category approval and the offer trigger all read), by category selection, and by the vehicle step, which now drops pending selections that no longer fit. The submission checklist counts only non-rejected selections that the current vehicle fits. An inactive vehicle is now reported as `VEHICLE_INACTIVE` (was `VEHICLE_CATEGORY_MISMATCH`). Tests: vehicle edited to fewer seats or an older year drops the selection and blocks submit. Seats, year or a missing year lowered after approval, and category seats or `min_year` raised after approval (including a malformed `min_year`), each remove eligibility. For each of the four changes, admin approval answers 409 with the fit reason as the only blocker, and the `ride_offers` trigger refuses the offer with `WE001`. Plus one new schema invariant.

**H2: completed uploads could be overwritten.** The presigned PUT targeted the same key that was validated, hashed and later shown to reviewers. The URL stays usable until its TTL ends, so new bytes could replace the validated ones. Fix (A-4-12): the PUT targets `uploads.staging_object_key`. Completion copies it server-side to `object_key` (random, not derived from the upload id, never returned, never signed for writing), runs every check on the copy, and deletes the staging object after commit. The cleanup job, once a grant has expired, deletes whatever sits at the staging key and clears the column. Grants that were still `AUTHORIZED` when 021 ran are set to `EXPIRED`. Test: after completion, the original PUT URL still stores new bytes (storage answers 200), but the reviewer's download returns the original bytes with the recorded sha256, a repeated completion is unchanged, and the sweep later removes the re-PUT staging object while the reviewed object remains. S3 object versions are not stored: the bucket is not versioned and the final key has no write path other than the server's copy.

Not done for these fixes: the admin console browser run, Dart live client, Flutter and smoke checks (evidence 07–13) were not re-run. The fixes change no API contract, but the codes an inactive or ill-fitting vehicle reports in eligibility `reasons` / `blocking` changed as described.

## 7. Not implemented, not verified, limits

- **Not implemented (Phase 4 scope items deferred):** monthly vehicle-photo checks (driver upload, admin review; the eligibility rule already honours `vehicle_checks`), driver pausing a category and going online (Phase 5), `DELETE /me` (retention policy Q17 is open), admin user/role management and MFA reset endpoints (`/admin/users*`), audit-log export, server-side localized error messages (apps map error codes to localized text; the API still answers English), scoped support/safety access (needs Phase 9 cases).
- **No data by default.** Categories, document types and their requirements are CMS data with no admin screens until Phase 10, so a fresh database offers drivers no categories. Tests and the browser/Dart runs create them by SQL. Q14 (which documents per category) remains the owner's.
- **Cancelling outstanding offers when a driver becomes ineligible** is not done: no offers can exist yet. The database trigger stops new ones; Phase 6 must cancel existing ones in the same transaction (02_State_Machines §3.5, lock order ride → driver → offer).
- **GitHub Actions has never run**, including the two new pieces (MinIO service, `live-clients` job with Chromium and the Dart live test). The YAML parses.
- **No Android/iOS build or device test.** Only `flutter build web` and widget/unit tests. The secure token store, camera and gallery picker were never run on a device. The live Dart test uses an in-memory token store.
- **No malware scan of uploads** (size and magic bytes only). PDFs are accepted for documents. Presigned PUT cannot cap size, so oversize objects can exist until completion or the cleanup job.
- **Arabic and French strings were written by me and need native review.** No RTL visual review beyond widget tests.
- No load test. No real SMS provider (dev adapter, refused in production). No accessibility audit beyond semantic labels.

## 8. Decisions and assumptions to confirm (register §10a)

- Amendments A-4-01..A-4-12 to Phase 2 files (register §10a).
- **TBD-4-01** Document expiry compares dates in `Asia/Beirut`.
- **TBD-4-02** Replacing an approved document puts the new one in review and pauses eligibility for categories that need it. Policy for renewal without a gap is the owner's.
- **TBD-4-03** Malware scanning of uploads: none.
- **TBD-4-04** argon2id parameters (OWASP minimum) need tuning on real hardware; admin sessions slide with use and have no absolute lifetime cap; per-email login limiting lets someone lock an admin out of sign-in for 15 minutes by guessing.
- **TBD-4-05** "Expiring soon" window is 30 days (proposal, should be a CMS parameter).
- **TBD-4-06** Architecture §6.2 wants a reason for sensitive reads; the download contract has no reason field, so document opens are audited without one.
- **TBD-4-07** Unblocking lifts a whole block row even if it covered both apps.
- **TBD-4-08** A driver with a pending block gets no new offers (the rule reports `BLOCK_PENDING`); a submitted vehicle check awaiting review never blocks.
- **TBD-4-09** A refresh retried after a lost response signs the person out (strict reuse detection).
- Gender confirmation criteria remain `TBD-A-04`.

## 9. Next phase

Phase 5 (presence, locations, maps, saved places) starts only after explicit owner approval of Phase 4. Also for the owner: whether to commit Phase 4 (one commit or split) and push.
