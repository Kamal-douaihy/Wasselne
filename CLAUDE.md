# Wasselne — project brief for Claude

On-demand rides in Lebanon: **Wasselne** rider app + **Wasselne Driver** app (Flutter), **Wasselne Admin** (Next.js), NestJS modular monolith (API/WS + worker), PostgreSQL/PostGIS, Redis, S3-compatible private storage.

## Read first (instead of the Word docs)
- `docs/phase-0/Wasselne_Phase0_Register.md` — authoritative summary: decisions, conflicts, open TBDs, risks, acceptance criteria, phase checklist.
- Only open the source docs for detail. Word ed. 0.2 in `Documents/` is authoritative; `*_v0.1.md` files are older history (the v0.1 HLD's driver-proposed fare is superseded).
- `docs/phase-1/` — UX specs: 00 direction/patterns, design-tokens.json, 01 rider (R-xx), 02 driver (DS-xx), 03 admin (A-xx).
- `Documents/prompt-for-app.md` defines Phases 0–11 and working rules.

## Non-negotiable rules
- Strict phase gates: stop at each phase end, report (goal, decisions, files, verification actually performed, TBDs, next phase), wait for explicit owner approval.
- Never overwrite files in `Documents/`. New deliverables go in `docs/`.
- CMS-only fares, versioned and snapshotted per ride. No driver price entry. Upfront pricing: (base + km-rate×km + minute-rate×min) × surge + add-ons − discount, min fare, rounding; all CMS per category/zone/currency (D-15, D-25, D-26). USD and/or LBP tariffs; rider pays in either (D-19). CMS picks fixed vs recalculated final fare, with CMS cap (D-20).
- Exactly one outstanding offer per ride (PENDING_ACK or ACTIVE). 3-second window starts at authenticated app ACK, from DB clock. Old offer terminal before the next.
- Cash only. OMT/Whish/bank disabled with no charge path. CMS commission % per category/zone recorded per trip, settled on pay day (D-16).
- Categories, discounts/promo codes, terms and policies are CMS data (D-22..D-24). No behavioral pricing (D-27).
- Payment requested at CMS % of route (default 100%, D-28). Driver ledger wallet; payout when balance > X or after Y weeks, CMS (D-30). Discount funding is a per-discount parameter (D-31). Tips 100% to driver (D-37).
- Drivers upload ID/docs from app to private S3; admin approves; monthly vehicle photos (D-32). Admin can view all rides/chats (audited) and block accounts (D-33, D-34). Women's category = women drivers, women riders (D-35). Surge manual at launch (D-36).
- Payment and debt-settlement methods are CMS entities, all disabled except cash (D-38, D-43). Blocks never interrupt a ride (D-41). Per-ride commission flag snapshotted from a CMS switch; commission = flagged rides only (D-42). Women riders declare gender at sign-up, confirmed by management (D-39).
- Bus and kiosk are future scope. Launch zones/categories are set in the CMS, never hard-coded.
- SOS = priority chat with a support agent who calls the user (D-17). Never claim a call or help happened.
- Never invent Lebanese legal rules, fares, document lists, emergency numbers, SLAs. Mark `TBD`.
- Never claim tests, device checks, or integrations that weren't actually performed.

## Credit-saving workflow (owner preference)
- Hard reasoning (scope, UX decisions, architecture/contracts, dispatch concurrency, ledger, security review) → strong model.
- Mechanical work (scaffolding, CRUD endpoints/screens, i18n strings, boilerplate tests, doc formatting) → Sonnet.
- Keep this file and the Phase 0 register current so new sessions start cheap.
