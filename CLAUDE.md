# Wasselne — project brief for Claude

On-demand rides in Lebanon: **Wasselne** rider app + **Wasselne Driver** app (Flutter), **Wasselne Admin** (Next.js), NestJS modular monolith (API/WS + worker), PostgreSQL/PostGIS, Redis, S3-compatible private storage.

## Read first (instead of the Word docs)
- `docs/phase-0/Wasselne_Phase0_Register.md` — authoritative summary: decisions, conflicts, open TBDs, risks, acceptance criteria, phase checklist.
- Only open the source docs for detail. Word ed. 0.2 in `Documents/` is authoritative; `*_v0.1.md` files are older history (the v0.1 HLD's driver-proposed fare is superseded).
- `Documents/prompt-for-app.md` defines Phases 0–11 and working rules.

## Non-negotiable rules
- Strict phase gates: stop at each phase end, report (goal, decisions, files, verification actually performed, TBDs, next phase), wait for explicit owner approval.
- Never overwrite files in `Documents/`. New deliverables go in `docs/`.
- CMS-only fares, versioned and snapshotted per ride. No driver price entry. Fare from km, per-km rate, road time, CMS factor. Separate USD and LBP tariffs, either or both published. CMS parameter picks fixed vs recalculated final fare (D-15).
- Exactly one outstanding offer per ride (PENDING_ACK or ACTIVE). 3-second window starts at authenticated app ACK, from DB clock. Old offer terminal before the next.
- Cash only. OMT/Whish/bank disabled with no charge path. No per-trip commission; record trips for pay-day commission (D-16).
- Bus and kiosk are future scope. Launch zones/categories are set in the CMS, never hard-coded.
- SOS = priority chat with a support agent who calls the user (D-17). Never claim a call or help happened.
- Never invent Lebanese legal rules, fares, document lists, emergency numbers, SLAs. Mark `TBD`.
- Never claim tests, device checks, or integrations that weren't actually performed.

## Credit-saving workflow (owner preference)
- Hard reasoning (scope, UX decisions, architecture/contracts, dispatch concurrency, ledger, security review) → strong model.
- Mechanical work (scaffolding, CRUD endpoints/screens, i18n strings, boilerplate tests, doc formatting) → Sonnet.
- Keep this file and the Phase 0 register current so new sessions start cheap.
