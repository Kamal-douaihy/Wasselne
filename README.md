# Wasselne

On-demand rides in Lebanon. Rider app **Wasselne**, driver app **Wasselne Driver** (Flutter),
**Wasselne Admin** (Next.js), and a NestJS API/worker backed by PostgreSQL/PostGIS, Redis, and
S3-compatible storage.

Product and architecture decisions live in `docs/` (see `CLAUDE.md` for the reading order).
This file only covers running the code.

## Repository layout

```
apps/
  api/       NestJS: HTTP API (main.api.ts) and background worker (main.worker.ts)
  admin/     Next.js admin console
  rider/     Flutter app "Wasselne"
  driver/    Flutter app "Wasselne Driver"
packages/
  contracts/      docs/phase-2/openapi.yaml -> generated TS types + a typed fetch client
  flutter_core/   shared Dart: API client, theme (from design tokens), l10n (ar/en/fr)
  design-tokens/  docs/phase-1/design-tokens.json -> CSS variables + Flutter theme constants
db/migrations/    plain SQL migrations, split from docs/phase-2/schema.sql
infra/local/      docker-compose: postgres+postgis, redis, minio, mailhog
scripts/          smoke-test.sh and one-off generation scripts
```

TypeScript packages (`apps/api`, `apps/admin`, `packages/contracts`, `packages/design-tokens`)
are a pnpm workspace. The Flutter packages (`apps/rider`, `apps/driver`, `packages/flutter_core`)
are a Dart pub workspace managed with Melos.

## Prerequisites

- Node.js 20 or 22, with `corepack enable` run at least once (this repo pins `pnpm@9.15.9`). If
  `corepack enable` can't symlink into your global bin (permission-restricted machines), prefix
  pnpm commands with `corepack pnpm` instead of installing pnpm separately.
- Docker, for local Postgres/Redis/MinIO/Mailhog.
- Flutter stable (3.x) with Dart 3.13+, and Melos: `dart pub global activate melos`, then add
  `$HOME/.pub-cache/bin` to `PATH`.

## First-time setup

```bash
pnpm install                                            # TypeScript workspace
pnpm --filter @wasselne/design-tokens run generate       # writes packages/flutter_core/lib/theme/tokens.g.dart
melos bootstrap                                          # Flutter/Dart workspace (also runs gen-l10n)

cp infra/local/.env.example infra/local/.env
cp apps/api/.env.example apps/api/.env                   # dev-only secrets; never use these in production
pnpm infra:up                                             # postgres, redis, minio, mailhog
pnpm db:migrate
```

`packages/flutter_core/lib/theme/tokens.g.dart` and the l10n output under
`packages/flutter_core/lib/l10n/generated/` are generated, not committed — the two commands
above must run before `apps/rider` or `apps/driver` will build.

## Running things

```bash
pnpm --filter @wasselne/api run dev:api        # HTTP API, http://localhost:3000
pnpm --filter @wasselne/api run dev:worker      # background worker process
pnpm --filter @wasselne/admin run dev           # admin console, http://localhost:3001 (the API owns 3000)
cd apps/rider && flutter run -d chrome          # or any connected device/simulator
cd apps/driver && flutter run -d chrome
```

## Testing

```bash
pnpm test                # TS unit + e2e tests. Needs `pnpm infra:up` (postgres+redis) only: e2e creates
                          # its own throwaway database and Redis key prefix and drops them afterwards.
pnpm --filter @wasselne/api run db:check-schema   # schema invariants + migrations==schema.sql gate
pnpm flutter:test         # Flutter unit/widget tests across rider, driver, flutter_core
pnpm flutter:analyze      # Flutter static analysis
pnpm run smoke            # scripts/smoke-test.sh: throwaway database + free port; OTP sign-in ->
                           # complete-profile -> /v1/me plus error/429 shapes. Your dev data is untouched.
```

## Known local-environment notes

- `minio/minio` on Docker Hub now requires a paid login; `infra/local/docker-compose.yml` uses
  the free `bitnamilegacy/minio` image instead. Swap it for a licensed image before production.
- Postgres and Mailhog's published images are `linux/amd64` only; on Apple Silicon Docker runs
  them under emulation, which is fine for local dev but not representative of prod performance.
- A handful of NestJS providers use explicit `@Inject(ClassName)` instead of relying on
  TypeScript's implicit `design:paramtypes` metadata. `tsx` (used for `dev:api`/`dev:worker`)
  compiles via esbuild, which was observed to silently omit that metadata for some class-typed
  constructor parameters — Nest then injects `undefined` with no error. `tsc` (production builds)
  and `ts-jest` (tests) do not have this issue, but the explicit tokens keep dev mode correct too.
- The API contract is `docs/phase-2/openapi.yaml` (server base `/v1`). e2e tests validate every
  response's status, body and required headers against it. `/health` is an operational endpoint
  outside that contract. In dev the OTP code is never returned by the API: the dev SMS adapter
  writes it to Redis (`<REDIS_KEY_PREFIX>dev:sms:<challenge_id>`).
- Per-IP limits use `req.ip`; set `TRUST_PROXY_HOPS` to the real number of reverse proxies in front
  of the API (0 = none) or every client will appear to share the proxy's address.
