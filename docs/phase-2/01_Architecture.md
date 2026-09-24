# Wasselne — Phase 2.1: Architecture

**Status:** Draft for owner review (Phase 2). Refines the approved HLD and the draft LLD with Phase 0 decisions D-01 to D-45 and the Phase 1 designs.
**Files in this phase:**

| File | Content |
|---|---|
| `01_Architecture.md` | This document: modules, repo, runtime, providers, security, parameters, capacity |
| `02_State_Machines_and_Transactions.md` | Ride, offer, payment, ledger, case, SOS state machines; exact dispatch transactions |
| `schema.sql` | Full PostgreSQL/PostGIS schema (loaded and tested, see §10) |
| `schema-invariants-test.sql` | Constraint checks run against the schema |
| `openapi.yaml` | HTTP API contract |
| `ws-events.md` | WebSocket and push event contract |

The LLD's intent is kept. Where this phase differs from the LLD, the change is listed in §9.

---

## 1. Module ownership (NestJS modular monolith)

Each module owns its tables. Other modules call its service interface, never its tables. The dispatch coordinator is the only place that writes across ride, offer, and driver rows in one transaction.

| Module | Owns tables | Key responsibilities |
|---|---|---|
| `identity` | accounts, rider_profiles, otp_challenges, sessions, push_devices, account_blocks | OTP sign-in, sessions, blocks (pending until trip end) |
| `admin-auth` | admin_users, admin_roles, admin_user_roles, admin_sessions, admin_recovery_codes, admin_audit_log | Password + TOTP, RBAC, audit writer used by all admin endpoints |
| `legal` | legal_document_versions, legal_document_texts, legal_acceptances | Publish versions, acceptance gate |
| `catalog` | vehicle_categories, document_types, category_document_requirements | CMS categories (D-24) |
| `geo` | service_zones, service_zone_versions, zone_category_settings, saved_places | Coverage checks (PostGIS), saved places |
| `drivers` | driver_profiles, vehicles, driver_category_approvals, driver_documents, vehicle_checks, vehicle_check_photos, driver_online_sessions | Onboarding, approvals, eligibility, online sessions |
| `uploads` | uploads | Presigned upload/download grants, validation |
| `presence` | Redis keys only | Location ingest, freshness, candidate search |
| `pricing` | tariff_versions, surge_rules, addons, discounts, commission_rules, quotes, quote_amounts, discount_redemptions | Quotes, fare formula, final fare |
| `dispatch` | ride_offers | Offer lifecycle, dispatcher, sweeper |
| `rides` | rides, ride_fares, ride_assignments, ride_events, trip_location_samples | Ride state machine, snapshots |
| `payments` | payment_methods, ride_payments | Payment state machine, method registry (D-38) |
| `wallet` | ledger_entries, payouts, settlement_methods, driver_settlements | Ledger postings, payouts, settlements |
| `chat` | chat_messages, chat_translations | Trip chat, translation jobs |
| `support` | support_cases, case_messages, case_evidence | Cases |
| `safety` | sos_config_versions, sos_incidents, sos_messages, support_agent_presence | SOS incidents, fallback, escalation |
| `reviews` | reviews | Ratings, declared tips, moderation |
| `settings` | platform_settings_versions, currencies | Versioned CMS parameters |
| `platform` | outbox_events, delivery_attempts, idempotency_keys | Outbox relay, idempotency, realtime gateway, push |

## 2. Repository layout (created in Phase 3)

```
wasselne/
├─ apps/
│  ├─ api/                 NestJS: src/modules/*, src/main.api.ts, src/main.worker.ts
│  ├─ admin/               Next.js (App Router), English only
│  ├─ rider/               Flutter app "Wasselne"
│  └─ driver/              Flutter app "Wasselne Driver"
├─ packages/
│  ├─ contracts/           openapi.yaml → generated TS client (admin) and Dart client (apps)
│  ├─ flutter_core/        Dart: API client, models, auth, sockets, l10n (ARB ar/en/fr), theme from tokens
│  └─ design-tokens/       design-tokens.json → Flutter theme + CSS variables
├─ db/migrations/          SQL migrations split from schema.sql
├─ infra/local/            docker-compose: postgis, redis, minio, mailhog
├─ docs/                   phases 0–2 (this folder)
└─ .github/workflows/      CI
```

Tooling: pnpm workspaces for TypeScript, Melos for the Flutter packages.

## 3. Runtime

| Process | Scale | Role |
|---|---|---|
| `api` | ≥ 2 tasks in production, stateless | HTTP + WebSocket gateway (Socket.IO with Redis adapter for cross-task fan-out) |
| `worker` | ≥ 2 tasks (safe to run many) | Outbox relay (socket and push), offer sweeper, dispatcher, translation, payout due marker, vehicle-check scheduler, presence sweeper, SOS escalation |
| PostgreSQL 16 + PostGIS | Managed, Multi-AZ | Source of truth |
| Redis 7 | Managed | Presence and geo, socket fan-out, rate limits, short caches. Losing it loses no ride data |
| Object storage | S3 (MinIO locally) | Private documents, vehicle photos, evidence |

**Outbox relay.** It claims rows with `FOR UPDATE SKIP LOCKED`, sets `claimed_until = now + 30 s`, and commits before any network call. It delivers the row, then marks it processed. Rows whose claim lapsed are picked up again. Consumers dedupe on `event_id`. Each socket and push attempt is recorded in `delivery_attempts`, and none of them changes business state.

## 4. Technology choices (versions checked against official docs at the start of Phase 3)

| Area | Choice | Why |
|---|---|---|
| Backend | Node.js LTS, NestJS, TypeScript strict | Approved stack |
| DB access | **Kysely** (typed SQL builder) + plain SQL migrations | Dispatch needs exact control of `FOR UPDATE`, lock order, `clock_timestamp()`, and partial indexes. An ORM that hides SQL makes this harder to verify |
| Validation | Zod schemas generated from or checked against OpenAPI | One contract |
| Realtime | Socket.IO + Redis adapter | Approved. Connection-state recovery is not relied on (HLD §7); snapshots are |
| Mobile | Flutter stable; Riverpod; go_router; dio; ARB localization | Common, well-supported stack |
| Background location (driver) | Evaluate `flutter_background_geolocation` (commercial licence for Android release builds) versus `geolocator` with a custom foreground service | Reliability on Android OEMs is the main risk (R-01). Decided in Phase 5 with device tests; licence cost goes to the owner |
| Admin | Next.js, TanStack Query, shadcn/ui, MapLibre GL + Terra Draw for zone polygons | Polygon editing without a paid drawing SDK |

## 5. External providers (proposed; each behind an adapter interface)

| Capability | Proposed provider | Alternatives | Status |
|---|---|---|---|
| Maps SDK, places search, geocoding, traffic routes | Google Maps Platform | Mapbox, HERE | **Verify with 50 real addresses** from the first zones in Phase 5 before committing. Check two-wheeler routing availability for Lebanon |
| Driver navigation | Hand-off to Google Maps or Waze app | Embedded navigation SDK later | Decided (Phase 0 Q19 default) |
| SMS OTP | Adapter; candidates Twilio Verify, a Lebanese SMS aggregator, WhatsApp OTP | — | Owner picks after price and delivery test. Local development uses a dev-only adapter that is refused at startup in production |
| Push | Firebase Cloud Messaging (Android + iOS via APNs) | — | Standard |
| Translation | Google Cloud Translation | DeepL | Arabic dialect quality to be checked with sample chats |
| Hosting | AWS: ECS Fargate, RDS PostgreSQL Multi-AZ, ElastiCache, S3, Secrets Manager | Other clouds | Region (Frankfurt vs UAE vs Bahrain) chosen by measured latency from Lebanese networks and a legal data-location check |
| Errors & telemetry | Sentry (apps + API), OpenTelemetry → CloudWatch or Grafana Cloud | — | — |

No provider account is created and nothing is purchased without the owner's approval.

## 6. Security and privacy

### 6.1 Authentication

- **Riders and drivers.** Phone number with an SMS code (6 digits, 5-minute expiry, 5 attempts, per-phone and per-IP rate limits). Access JWT lasts 15 min with claims `sub, app, sid`. The refresh token lasts 30 days, rotates on every use, and is stored hashed. Reuse of a rotated refresh token revokes the whole session.
- **Admins.** Email with an argon2id password, then TOTP, mandatory. Session cookie is httpOnly, Secure, SameSite=Strict, 8 h idle limit. Recovery codes are shown once and stored hashed.
- **Blocks (D-34, D-41).** On effect, revoke all sessions for the blocked app, publish `account.blocked`, disconnect sockets, and add the account to a Redis deny-set checked on every request. A pending block is applied by the ride-terminal hook.

### 6.2 Authorization

- Every handler checks ownership: the rider owns the ride, the driver is the assigned driver, the offer's driver is the caller.
- Socket rooms: `account:{id}` is automatic. `ride:{id}` is joinable only by the rider or the assigned driver while the ride is active or inside the contact window. Admin feeds require a permission.
- Admin endpoints declare a permission. Sensitive reads (chat, documents, evidence) require a reason and write an audit row (D-33).

### 6.3 Threat model (summary)

| Threat | Example | Control |
|---|---|---|
| Account takeover | SIM swap, OTP brute force | Rate limits, short OTP expiry, session list with remote sign-out, admin MFA |
| Offer tampering | Driver accepts another driver's offer or after expiry | Server checks offer owner + DB-clock deadline under lock; opaque offer IDs |
| Replay / duplicates | Double booking, double cash record, double ledger | Idempotency keys, unique constraints, ledger idempotency key |
| Location spoofing | Fake GPS to win offers | Accuracy and plausibility checks, sequence numbers, speed sanity check; mock-location flag on Android reported (policy `TBD-2-05`) |
| Data exposure | Rider sees driver home location; push shows address on lock screen | Coarse nearby vehicles; location shared only in active ride; push payloads carry IDs only |
| Insider misuse | Admin reads chats without reason | Separate permission, reason prompt, append-only audit, periodic audit review |
| Malicious uploads | Executable disguised as photo | Presigned PUT with content-type and size limits; server verifies magic bytes on completion; private bucket; short-lived downloads |
| Price manipulation | Client sends its own fare | Fares only computed server-side from quote ID; driver API has no price field |
| Config abuse | Admin enables payment method with no integration | DB check: enabled ⇒ adapter_available (tested) |
| Injection | SQL, XSS in admin | Parameterized queries; admin renders user content as text; CSP |
| Denial of service | OTP SMS pumping | Per-number and per-IP limits, country allow-list option, spend alerts |

### 6.4 Sensitive data flows

| Data | Who can see it | Stored where |
|---|---|---|
| Driver precise location | Assigned rider during active ride; admins with live-map permission | Redis (ephemeral); sampled trail in PostgreSQL during trips |
| Phone numbers | Other party, inside the contact window (D-44); admins | PostgreSQL; never in logs or pushes |
| Driver documents, vehicle photos | Driver (own), reviewers | Private S3; access audited |
| Chat | Participants; admins with chat permission (audited) | PostgreSQL |
| Gender | Account owner; reviewers; used for eligibility only | PostgreSQL |
| SOS location | SOS agents | PostgreSQL |

### 6.5 Retention (proposals; require legal review before launch, Q17)

| Data | Proposed retention |
|---|---|
| OTP challenges | 24 h |
| Redis presence | Minutes (TTL) |
| Trip location trail | 90 days, then delete |
| Chat and translations | 180 days after trip, then delete |
| Driver documents | While the account is active + 1 year |
| Case evidence | 1 year after case closure |
| Rides, fares, payments, ledger | 7 years (financial records) |
| Admin audit log | 5 years |

## 7. Location freshness and cadence (defaults, CMS-adjustable)

| Setting | Default |
|---|---|
| Driver update interval, online idle | 8 s or 50 m moved |
| Driver update interval, on a ride | 4 s or 20 m moved |
| Presence freshness (older = not offerable) | 30 s |
| Accuracy limit for offers | 100 m |
| Rider sees driver as "stale" after | 20 s |
| Trip trail sampling | every 15 s during IN_PROGRESS |

## 8. Platform parameters and defaults

All live in `platform_settings_versions` and are editable in admin screen A-26. Rides snapshot the version. Values marked **owner** have no safe default and must be entered before launch.

| Parameter | Default | Source |
|---|---|---|
| DELIVERY_ACK_TIMEOUT_S | 5 | Q11 default |
| Accept window | 3 s, fixed, not a parameter | D-04 |
| MAX_OFFERS_PER_DRIVER (per ride) | 3 | Q11 |
| MAX_RIDER_SEARCH_DURATION_S | 180 | Q11 |
| DISPATCH_RETRY_INTERVAL_S | 3 | new |
| ETA_SHORTLIST | 5 | new |
| QUOTE_TTL_S | 300 | Q12 |
| Rounding increment | USD 0.25 · LBP 5,000 (per tariff) | Q12 |
| NO_SHOW_WAIT_S | 300 | Q13 |
| Cancellation fees | None at launch | Q13 |
| ARRIVAL_RADIUS_M | 150 | TBD-DS-05 |
| CONTACT_WINDOW_AFTER_TRIP_S | 1800 | D-44 |
| PAYMENT_REQUEST_PCT | 100 | D-28 |
| PUBLISHED_CURRENCIES | ["USD"] | D-15 |
| COMMISSION_COUNTING_ENABLED | false | D-42 |
| PAYOUT_THRESHOLDS, PAYOUT_MAX_WEEKS | **owner** | D-30 |
| VEHICLE_CHECK_INTERVAL_DAYS / GRACE_DAYS | 30 / 7 | D-32, D-40 |
| DRIVER_DEBT_LIMIT | off | D-43 |
| SURGE_MIN_BP / SURGE_MAX_BP | 10000 / 20000 (×1.0 to ×2.0) | D-25 |
| DISPUTE_WINDOW_S | 259200 (72 h) | Q16 |
| SOS_UNASSIGNED_ESCALATION_S | 30 | admin spec |
| SOS fallback number | **owner** | D-21 |
| Tariffs, commission rates, add-ons | **owner**, entered in CMS | D-15, D-16, D-26 |
| Driver document list per category | **owner** | Q14 |
| Review format | 1–5 stars, optional comment and tags; averages shown | Q15 |

## 9. Changes from the draft LLD

| LLD | Phase 2 | Reason |
|---|---|---|
| Ride states include `REQUESTED`, `DRIVER_ARRIVING`, `EXPIRED` | Ride starts in `SEARCHING`; `CONFIRMED` = driver on the way; `NO_DRIVER` replaces `EXPIRED`; added `NO_SHOW`, `ELIGIBILITY_MISMATCH` | Fewer states, same meaning; D-39 |
| Fare in one currency | Fares per published currency (`quote_amounts`, `ride_fares`) | D-15, D-19 |
| `cash_collections`, `financial_events` | `ride_payments` + driver `ledger_entries` wallet | D-28 to D-31, D-42, D-43 |
| Pricing policy as one version | Tariffs per category × zone × currency, plus surge, add-ons, discounts, commission rules | D-15, D-23, D-25, D-26 |
| Settings scattered | One versioned `platform_settings_versions` document | Simpler publication and snapshot |
| ACK = app received | ACK sent only when the offer is rendered on screen | Phase 1 DS §2.2 |
| SOS action registry | Agent chat + fallback number + on-call alert | D-17, D-21 |
| — | Legal documents, categories, discounts, blocks, vehicle checks, gender confirmation | D-22 to D-24, D-32 to D-41 |

## 10. Verification performed in this phase

| Check | Result |
|---|---|
| `schema.sql` loaded into PostgreSQL 16 + PostGIS 3.4 (temporary Docker container) | Loaded without errors |
| `schema-invariants-test.sql`: second outstanding offer per ride; second active ride per rider; ACTIVE offer window ≠ 3 s; second open assignment per ride; duplicate ledger posting; ledger edit; ledger delete; enabling a payment method without adapter; ride history edit; ride history delete | All 10 rejected by the database as intended |
| Concurrency behaviour (parallel accepts, worker crash, lock order) | **Not tested yet.** Requires the Phase 6 implementation; tests listed in `02` §3.8 |

## 11. Capacity and cost assumptions

These are assumptions to be replaced by measurements (NFR-01, Phase 11).

| Assumption | Value |
|---|---|
| Online drivers at peak (first year) | up to 1,000 |
| Concurrent rider app sessions | up to 5,000 |
| Ride requests at peak | 2 per second |
| Driver location updates | ≈ 125–250 per second (Redis only) |
| PostgreSQL writes at peak | < 100 transactions per second |

At this scale, two small API tasks, two small workers, a small Multi-AZ database, and a small Redis should be enough. This is to be confirmed by load test.

**Main variable costs, all per-use:** map calls (autocomplete, one route per quote request shared across categories, one ETA matrix per dispatch round), SMS codes, and translated chat messages. Controls: autocomplete session tokens, caching routes for identical quote requests, translating only when sender and recipient languages differ, and SMS rate limits. Monthly cost figures come from the providers' current price lists once the owner picks providers. No numbers are guessed here.

## 12. Open items raised in Phase 2

| ID | Item | Proposed default |
|---|---|---|
| TBD-2-01 | Driver cancels after confirming: search again automatically? | No; rider re-requests |
| TBD-2-02 | Admin override for a stuck payment | Yes, audited |
| TBD-2-03 | Discount stacking | Best single discount wins |
| TBD-2-04 | Recalculated final fare below the quote | Allowed |
| TBD-2-05 | Android mock-location detected | Block going online and flag for review |
| TBD-2-06 | Payout thresholds X and max weeks Y | Owner enters |
| TBD-2-07 | SOS fallback emergency number | Owner enters |
| TBD-2-08 | Cloud region | Measure latency in Phase 3 |
