# Wasselne — Phase 3 Report: Repository and working foundation

**Status:** Delivered, **awaiting owner approval**. Nothing is committed yet. Phase 4 has not started.
**Date:** 2026-09-25. **Evidence:** raw command output in `docs/phase-3/evidence/` (run 2026-09-24 ~21:24 UTC, macOS arm64, Node 22.14, Flutter 3.47.5).

## 1. Goal
Real, runnable foundation: two Flutter apps, shared packages, NestJS API and worker, Next.js admin, local PostgreSQL/PostGIS + Redis, migrations, validation, error handling, structured logs, health checks, CI, test tooling, safe secrets examples, and one working authenticated API path with a reproducible smoke test.

## 2. What was delivered
- **Layout:** `apps/{api,admin,rider,driver}`, `packages/{contracts,flutter_core,design-tokens}`, `db/migrations` (19 files), `infra/local`, `.github/workflows/ci.yml`, `README.md` (see it for run instructions).
- **Authenticated path (contract-aligned):** `POST /v1/auth/otp/request` → `POST /v1/auth/otp/verify` (`SESSION` or `NEEDS_PROFILE`) → `POST /v1/me/complete-profile` (201) → `GET /v1/me`. Not implemented yet (Phase 4): token refresh, logout, PATCH /me, real SMS provider, legal-document completeness rules, localized error messages (English only), session revocation checks on each request.
- **Worker:** boots against DB and Redis only. No jobs (outbox, dispatcher, sweepers are Phase 6+).

## 3. Review items and how each was resolved
| # | Item | Result |
|---|---|---|
| 1 | Phase 2 approval / contract | Approval recorded in register §10a (owner message 2026-09-24; baseline commit `04e9761`). Code was aligned to the contract; the four unavoidable edits to Phase 2 files (A-3-01..04) are listed there for owner acceptance. |
| 2 | OTP, headers, errors vs OpenAPI | Request returns exactly `challenge_id, expires_at, resend_after`; the code is never in the response (dev adapter writes it to Redis). Verify takes `challenge_id` + `code` only, the app comes from the challenge. Errors are the flat `{code, message, correlation_id, details?}`. Every response carries server-generated `X-Correlation-Id`; 429s carry `Retry-After`. Statuses: 400 OTP_INVALID, 410 OTP_EXPIRED, 429 OTP_RATE_LIMITED, 403 ACCOUNT_BLOCKED / NOT_AUTHORIZED, 503 PROVIDER_TEMPORARY_FAILURE. **Tests validate each real response's status, body schema and required headers against `docs/phase-2/openapi.yaml`** (`test/support/openapi-contract.ts`). |
| 3 | Atomic + concurrency-tested | Verify is one transaction that locks the challenge row (`FOR UPDATE`), checks the DB clock, verifies, consumes, and creates the session (token signed before commit). Complete-profile is one transaction; the unique phone constraint makes the token single-use. Tested: 20 parallel verifies → exactly 1 success and 1 session; 12 parallel wrong guesses → attempts capped at 5; correct-vs-wrong race; 10 parallel complete-profile → 1 account/1 session; injected failure after consumption → rollback, code still redeemable. |
| 4 | Per-IP abuse controls | Redis Lua counters (atomic INCR+EXPIRE, fail closed with 503 if Redis is down): OTP request per IP (20/h) and per phone (5/h), resend cooldown (30 s), OTP verify per IP (30/h), per-challenge attempts (5), global per-IP ceiling (300/min, `RATE_LIMITED`). All configurable by env; tested with low limits. `TRUST_PROXY_HOPS` must match the real proxy count in deployment. |
| 5 | Ports / smoke PID | Admin runs on 3001 (API 3000); README and `.env.example` fixed. Smoke test starts the API with `exec` in a subshell and uses `$!` (no `pgrep`), picks a free port, checks the process is alive while waiting, resolves containers via `docker compose ps`, and cleans up on any exit. |
| 6 | Schema invariant gate | `schema-invariants-test.sql` now names the expected SQLSTATE per check and `RAISE EXCEPTION`s on unexpected success or wrong reason. `npm run db:check-schema` runs it (10 checks counted), self-tests that dropping `one_outstanding_offer_per_ride` makes it fail, and diffs the structure of `db/migrations` against `schema.sql`. It is a CI step. |
| 7 | Report and labels | This file; register §10 and header, `CLAUDE.md` status section. |
| 8 | Full checks, isolated DB | See §4. E2E creates `wasselne_test_<hex>` and a Redis key prefix per run and drops them; the smoke test does the same. After the runs only the developer database `wasselne` existed. |

## 4. Verification actually performed (see evidence files)
| Check | Result |
|---|---|
| `npm run lint / typecheck / build` (api, admin, contracts, design-tokens) | pass (01–03) |
| Schema gate | 10/10 invariants rejected with expected SQLSTATE; self-test failed as intended; migrations == schema.sql (04) |
| API unit tests | 10 passed (05) |
| API e2e, isolated database | **23 passed**, incl. contract, rate-limit and concurrency suites (06) |
| Admin tests 2, design-tokens tests 2 | pass (07, 08) |
| Smoke test, throwaway DB + free port | PASS (09) |
| Leftover databases/keys after runs | only `wasselne`; 0 `test:*` Redis keys (10) |
| Flutter `analyze`, `test` (rider 1, driver 1, flutter_core 5), `dart format` check | pass; a first run **failed format-check** on the generated `tokens.g.dart`; fixed by formatting in the generator and in CI (13–15) |
| `flutter build web` rider and driver | built (16, 17) |

## 5. Not verified / limits
- **GitHub Actions has never run.** The workflow YAML parses; the `smoke` and `flutter` jobs are untested there.
- **No Android or iOS build or device test.** `flutter doctor` (11): no Android SDK, CocoaPods missing, Chrome missing. Only `flutter build web` and widget/unit tests ran. The apps were not launched.
- No real SMS provider; the dev adapter is refused in production and `SMS_ADAPTER=disabled` answers 503.
- No load test; the rate-limit and concurrency results are functional, not capacity claims.
- Dart API client is hand-written (no OpenAPI codegen; needs Java). Admin uses generated TS types only.
- Local images: `bitnamilegacy/minio` (free mirror; revisit before production), amd64 Postgres/Mailhog under emulation on Apple Silicon.
- Redis key prefix and `TRUST_PROXY_HOPS` are deployment settings that must be set correctly.

## 6. Decisions to confirm
Accept or reject amendments A-3-01..04 (register §10a). Whether to commit (one commit or split) and push.

## 7. Next phase
Phase 4 (identity, onboarding, eligibility) — starts only after explicit approval of Phase 3.
