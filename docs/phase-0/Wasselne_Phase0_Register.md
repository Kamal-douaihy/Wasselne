# Wasselne — Phase 0 Register: Reconciled Scope, Decisions, and Open Items

**Status:** Draft for owner approval (Phase 0). Revision 2: owner answers of 2026-09-24 recorded. Not a design approval, not implementation.
**Date:** 2026-09-24
**Sources:** BRS Word ed. 0.2, HLD Word ed. 0.2, LLD Word ed. 0.2, Architecture Diagrams Word ed. 0.2 (all dated 23 Sep 2026), and the owner's implementation prompt (`Documents/prompt-for-app.md`).

This register does not repeat the BRS/HLD/LLD. It records what is authoritative, where artifacts conflict, what is decided, what is still `TBD`, and what the first release must prove. Requirement IDs (BR-, NFR-, HLD-, LLD-, VT-, OD-) refer to the source documents.

---

## 1. Artifact inventory and status

| Artifact | Versions present | Status | Use |
|---|---|---|---|
| BRS | `Wasselne_BRS.docx` (ed. 0.2), `Wasselne_BRS_v0.1.md` | **Approved** with owner amendments (OD-04, OD-12 resolved) | Requirement source |
| HLD | `Wasselne_HLD.docx` (ed. 0.2), `Wasselne_HLD_v0.1.md` | **Approved** with owner amendments | Architecture baseline |
| LLD | `Wasselne_LLD.docx` (ed. 0.2) only | **Draft, for owner review** | Input to Phase 2; not frozen |
| Architecture diagrams D-01…D-09 | `.docx` (ed. 0.2), `_v0.1.md` (Mermaid source) | **Draft, for owner review** | Visual reference |
| Implementation prompt | `prompt-for-app.md` | Owner's latest instruction set | Governs phases and working rules |
| Meta-prompt | `prompt.start.txt` | Superseded by `prompt-for-app.md` | Not a requirement source |
| Code / infrastructure | None. Git repo has no commits. | — | Nothing implemented |

**Authority rule:** Word ed. 0.2 > markdown v0.1. The markdown `Wasselne_HLD_v0.1.md` still describes a *driver-proposed fare* and pre-acknowledgment clock, both superseded (see C-01). Markdown files are kept unchanged as history.

---

## 2. Conflicts and gaps found

| ID | Finding | Resolution proposed |
|---|---|---|
| C-01 | `Wasselne_HLD_v0.1.md` §4.3 describes driver-proposed fares requiring rider acceptance. Word HLD ed. 0.2 and BRS OD-04 remove this. | Superseded. CMS-only fare is authoritative. Do not implement any driver price path. |
| C-02 | **Bus service** is in the owner prompt but in none of BRS/HLD/LLD. | **Resolved (D-12):** bus is future scope. |
| C-03 | HLD §6 lists admin MFA as a "recommendation"; the owner prompt requires it. | Adopt prompt: **admin MFA required** (D-09). |
| C-04 | BR-26 allows "final payable fare may differ" while HLD/LLD snapshot a fixed quote. Quote-vs-final treatment undefined. | **Resolved (D-15):** a CMS parameter decides whether the fare is fixed or recalculated at completion. |
| C-05 | LLD and diagrams remain drafts, yet BRS/HLD traceability cites them. | Acceptable. LLD review and freeze happens in Phase 2. |
| C-06 | The kiosk is "confirmed responsiveness", but its use case, hardware, and session model are undefined (OD-14). Driver GPS on kiosk is impossible. | **Resolved (D-13):** kiosk is future scope. |
| C-07 | Emergency numbers, SOS staffing, and trusted-contact channel are undefined (OD-09). HLD says no alert type may be enabled without a staffed exercise. | **Resolved (D-17):** SOS opens a chat with a support agent, who calls the user. |

No conflict found in the core dispatch rule: one outstanding offer per ride, including PENDING_ACK; 3-second window starts at authenticated app ACK; separate ACK timeout; terminal old offer before next; fresh reoffer to a previous driver is a new offer ID. BRS, HLD, LLD, diagrams, and prompt agree.

---

## 3. Decision log

| ID | Decision | Source / evidence | Status |
|---|---|---|---|
| D-01 | Market: Lebanon, staged activation by admin-published polygons. Place names are candidates, not boundaries. | BRS §2, BR-45 | Approved |
| D-02 | Categories: car/taxi, motorcycle, tuk-tuk. Immediate rides only. Scheduled rides future. | BRS §2 | Approved |
| D-03 | Fare set only by admins in CMS, versioned, snapshotted per ride. Driver sees read-only fare. No negotiation. | OD-04, HLD §4.3 | Approved |
| D-04 | 3-second accept window starts at authenticated app ACK, computed from DB clock. Separate bounded ACK timeout. | OD-12, LLD §4 | Approved (timeout value TBD) |
| D-05 | Cash only at launch. OMT, Whish, bank disabled with no charge path. | BR-27–29 | Approved |
| D-06 | USD initial currency. Admin can publish LBP policy. Agreed rides never repriced. | BR-25, BR-44 | Approved (rules TBD) |
| D-07 | Stack: NestJS modular monolith (API/WS + worker), Flutter ×2, Next.js admin, PostgreSQL/PostGIS, Redis, S3-compatible private storage. | HLD §1.1 | Approved |
| D-08 | No Kafka, Kubernetes, H3, separate matching service without measured need. | HLD §1.1 | Approved |
| D-09 | Admin MFA is mandatory. | Owner prompt (C-03) | Proposed |
| D-10 | Markdown v0.1 files are historical. Word ed. 0.2 is authoritative. | §1 | Proposed |
| D-11 | Deliverables for Phases 0–2 live under `docs/`. Source documents in `Documents/` are never overwritten. | Owner prompt | Proposed |

| D-12 | Bus service is future scope. No bus flows in the first release. | Owner, 2026-09-24 (Q1) | Approved |
| D-13 | Kiosk is future scope. First release targets phones and tablets. | Owner, 2026-09-24 (Q2) | Approved |
| D-14 | Launch areas and categories are chosen by the owner in the CMS. Nothing is hard-coded. The admin console must let staff draw, publish, and deactivate zones and enable categories per zone. | Owner, 2026-09-24 (Q3) | Approved |
| D-15 | Fare is computed from CMS parameters: distance (km), per-km rate, road time, and a CMS factor. Each tariff is published per currency. The CMS can publish USD only, LBP only, or both at the same time. No automatic exchange-rate conversion. A CMS parameter decides whether the agreed fare is fixed at request or recalculated from actual distance and time at completion. | Owner, 2026-09-24 (Q4, Q5) | Approved in principle; formula shape needs confirmation (F-1, F-2) |
| D-16 | No commission is charged per trip at launch. Every trip and cash record is kept so commission can be calculated per driver on a periodic pay day. | Owner, 2026-09-24 (Q6) | Approved; rule timing F-4 |
| D-17 | SOS at launch opens a priority chat with a Wasselne support agent. The agent then phones the user. The app reports only what actually happened, such as "request sent" or "agent joined". It never claims a call happened. | Owner, 2026-09-24 (Q7) | Approved; staffing gap F-5 |

---

## 4. First-release boundary

**In the first release (subject to answers):**
- Rider app: sign-in, language (ar/en/fr, RTL), map, pickup/destination, saved places, category, CMS fare, immediate request, search status, driver details, live tracking, trip states, chat with translation, call after confirmation, cash outcome, review, help, lost-item case, SOS options as published.
- Driver app: sign-in, onboarding with documents/photos, approval status, online/offline, background location, offer ACK plus 3-second accept/decline, navigation, trip transitions, cash report, chat, call, review, help, damage case, SOS.
- Admin console: RBAC and MFA, driver/vehicle review, zones/categories, fare and currency publication, live trips, support cases, SOS configuration and incidents, reviews, cash records, audit.
- Backend: everything in HLD-04 to HLD-24 for the flows above.

**Explicitly out of the first release:**
- Scheduled rides (future).
- OMT, Whish, bank payment collection (disabled, future).
- Driver price entry, negotiation, counteroffers (removed).
- Masked calling (not designed; numbers may be visible, see Q9).
- Per-trip commission deduction (D-16). Pay-day commission calculation is in scope for Phase 8.

**Also out of the first release:** bus service (D-12) and kiosk mode (D-13).

**Remaining boundary question:** sign-in method (Q8).

---

## 5. Prioritized requirements

Priority reflects dependency order for delivery. All BRS "M" items remain required before public launch.

| Tier | Meaning | Requirements |
|---|---|---|
| P0 — core ride loop | Nothing else works without it | BR-01–13, BR-14–19, BR-21–22, BR-24–25, BR-27, BR-41–42, BR-44–45; NFR-02–04, NFR-09, NFR-12 |
| P1 — required for launch | Needed before any public rider | BR-20, BR-23, BR-26, BR-30–40, BR-43, BR-46–49; NFR-01, NFR-05–08, NFR-10–11 |
| F — future / disabled | Seams only, no live behavior | BR-28–29 (disabled methods), scheduled rides, bus (pending Q1) |

---

## 6. Journeys

Each journey lists the main path, then exceptions. Screens and wireframes belong to Phase 1.

**J1 — Rider books and completes a ride.** Open app → sign in → choose language → set pickup (GPS, search, or saved place) → set destination → choose available category → see CMS fare and currency → request (idempotent) → searching → driver confirmed → see driver, vehicle, live location, ETA → call or chat → pickup → in progress → completed → pay cash → see fare record → review driver.
Exceptions: outside coverage; category unavailable; no driver after caps; rider cancels; network loss (reconnect snapshot); duplicate tap; map or translation provider down; stale driver location shown as stale.

**J2 — Driver onboarding.** Install → sign in → personal data, category, vehicle → upload photos and documents → submit → pending review → approved, rejected (with reason), or info requested → later: document expiry, suspension, reinstatement.

**J3 — Driver receives and runs a trip.** Go online (permissions, fresh GPS) → offer arrives (socket or push) → app ACKs → 3-second window with CMS fare → accept or decline → navigate to pickup → arriving → at pickup → start → navigate → complete → report cash collected → review rider.
Exceptions: ACK timeout; window expires; late accept rejected; app killed or backgrounded; GPS lost; rider cancels; no-show (policy TBD); suspended mid-shift.

**J4 — Rider lost item.** Trip history → select trip → "I left something" → describe item, optional photo → case opened → support contacts driver → status updates → resolved or closed with reason.

**J5 — Driver mess or damage claim.** Trip history → "Report mess/damage" → description and private photos → case opened → support reviews and may request rider statement → reasoned resolution. No automatic rider charge.

**J6 — SOS.** SOS button at allowed trip stages → shows only published actions with a plain description of each → action taken → truthful status (dialer opened, alert queued, delivered, failed, responder acknowledged) → incident visible to staff.

**J7 — Admin operations.** Sign in with MFA → role-scoped home → review driver queue → publish zone or category change (preview, reason, audit) → publish fare or currency version (validation, effective time) → monitor live trips → handle cases and SOS → moderate reviews → inspect audit.

**J8 — Support agent.** Assigned case queue → view trip context (least data needed) → message parties → attach notes and evidence (audited access) → resolve with reason.

---

## 7. Open decisions (`TBD`)

"Needed by" is the phase that cannot finish without the answer. Items needed by Phase 0 are the questions asked now.

| ID | Item | Source | Needed by | Proposed default |
|---|---|---|---|---|
| Q1 | Bus service model and release | C-02 | Resolved: future (D-12) |
| Q2 | Kiosk use case and release | OD-14 | Resolved: future (D-13) |
| Q3 | First launch area(s) and categories | OD-01, OD-02 | Resolved: chosen in CMS (D-14) |
| Q4 | LBP enabled at launch, and conversion method | OD-05 | Resolved: per-currency tariffs, USD/LBP/both (D-15) |
| Q5 | Fixed upfront fare or final fare that can change | OD-03, C-04 | Resolved: CMS parameter (D-15) |
| Q6 | Commission on cash trips at launch | OD-06 | Resolved: pay-day calculation (D-16) |
| Q7 | SOS actions at launch and who responds | OD-09 | Resolved: agent chat and callback (D-17) |
| Q8 | Sign-in method | OD-11 | **Phase 0** | Phone + SMS OTP for riders and drivers. Email + password + TOTP for admins |
| Q9 | Phone number visibility window | OD-08 | Phase 1 | Real numbers from confirmation until 30 min after trip end |
| Q10 | Admin console languages | OD-11 | Phase 1 | English only at launch |
| Q11 | ACK timeout, max reoffers, max rider search time | OD-13, OD-16 | Phase 2 | 5 s ACK, 3 offers per driver per ride, 3 min search |
| Q12 | Exact formula shape, rounding, minimum fare, quote expiry | OD-03, D-15 | Phase 2 | See F-1 |
| Q13 | Cancellation and no-show rules | BR-20 | Phase 2 | No fees at launch. Reasons recorded. No-show after 5 min wait |
| Q14 | Driver document list per category | OD-02, BR-05 | Phase 4 | Owner supplies, with local legal input |
| Q15 | Review format, visibility, moderation | OD-10 | Phase 2 | 1–5 stars + optional text. Only averages shown |
| Q16 | Lost-item and damage process, deadlines, remedies | OD-15 | Phase 2 | Support-mediated, 72 h claim window, no charges at launch |
| Q17 | Retention periods (location, chat, docs, evidence) | NFR-05 | Phase 2 | Needs legal input |
| Q18 | Reliability and capacity targets | NFR-01, NFR-08 | Phase 2 | Proposed in Phase 2 for owner approval |
| Q19 | Map/geocoding/routing provider, navigation mode | HLD-13 | Phase 2 | Evaluate in Phase 2. External-map handoff for navigation at launch |
| Q20 | Translation, SMS/OTP, push, cloud region providers | HLD §7 | Phase 2 | Evaluate in Phase 2 |
| Q21 | Lebanese legal, tax, privacy, transport review | NFR-10 | Phase 11 (start early) | Owner engages local adviser |

---

### Follow-up questions raised by the owner's answers

| ID | Question | Needed by | Proposed default |
|---|---|---|---|
| F-1 | "km × rate × road time × factor" multiplies distance by time, which grows very fast on long trips. Is the intent `(km × km-rate + minutes × minute-rate) × factor`? | Phase 2 | Yes, plus an optional base fare and minimum fare |
| F-2 | When both USD and LBP are published, does the rider see both amounts? Which currency is the driver told to collect? | Phase 1 | Show both. Rider pays in either |
| F-3 | When recalculation mode is on, may the final fare exceed the quote by any amount? | Phase 2 | Cap set in the CMS, e.g. +20% |
| F-4 | At pay day, is commission calculated with the rule in force at trip time, or at pay day? How often is pay day? | Phase 8 | Rule at trip time. Weekly |
| F-5 | What happens when SOS is pressed and no agent is online? | Phase 1 | Show the emergency number to dial and alert on-call staff |

## 8. Risk register

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R-01 | Background push on Android/iOS arrives late or not at all, so drivers miss offers. | High | ACK-gated window (decided). Prefer foreground socket while online. Measure on real devices in Phase 6. |
| R-02 | 3 seconds is short for a human decision on low-end phones and weak networks. | High | NFR-12 real-device tests. Show ACK-to-decision metrics to the owner before launch. |
| R-03 | Map, geocoding, and routing coverage in Lebanese towns is weak. | High | Provider trial with real addresses from launch areas in Phase 2. |
| R-04 | Visible phone numbers create a privacy and harassment risk after trips. | Medium | Owner decision Q9. Masked calling as a later option. |
| R-05 | SOS relies on a support agent (D-17). With no agent online, a rider in danger gets no response. | High | F-5 fallback. Agent-response time alert. Staffed exercise before launch. |
| R-06 | Cash disputes and unrecorded commission debt. | Medium | Immutable cash events. Commission off at launch unless Q6 says otherwise. |
| R-07 | Separate USD and LBP tariffs drift apart as the exchange rate moves. | Medium | Versioned tariffs. Admin warning when tariffs are old. |
| R-11 | Recalculated final fares cause rider disputes. | Medium | Show quote and final fare with a breakdown. CMS cap (F-3). |
| R-08 | Regulatory status of tuk-tuks, motorcycles, and independent drivers is unconfirmed. | High | Legal review Q21 before public launch. Category toggles per zone. |
| R-09 | Scope size versus budget. | High | Strict phase gates. P0 before P1. Defer bus and kiosk. |
| R-10 | SMS OTP cost and deliverability in Lebanon. | Medium | Evaluate providers, including WhatsApp OTP, in Phase 2. |

---

## 9. First-release acceptance criteria

Each criterion must be demonstrated with evidence. Numeric values marked `TBD` are fixed in Phase 2.

1. A rider in an active zone completes J1 for every enabled category in each language, including Arabic RTL.
2. A request outside active coverage or for a disabled category is refused with a localized explanation.
3. Concurrency tests show zero cases of two outstanding offers for one ride and zero double assignments, under parallel ACK, accept, expiry, and worker crashes (VT-06 to VT-10).
4. A late ACK, late accept, or replayed accept on an expired offer always fails.
5. When candidates run out, the rider sees "no driver available" within the configured maximum search time.
6. Rider and driver see identical fare and currencies. An admin tariff change never alters an agreed ride (VT-11). In recalculation mode, the final fare follows the ride's snapshotted tariff and cap.
6a. Publishing USD only, LBP only, or both displays exactly those currencies to rider and driver.
7. Disabled payment methods cannot be selected or charged (VT-12).
8. Reconnect after network loss or app kill restores the correct state with no duplicate ride (VT-10).
9. Stale or inaccurate driver location is never shown as live and never used for offers (VT-05).
10. Chat keeps original text when translation fails. Calls are possible only in the approved window (VT-13).
11. SOS opens a support-agent chat. The staff console shows it as priority, and the app shows truthful status only (VT-14).
12. Lost-item and damage cases reach a recorded resolution without automatic rider charges (VT-16).
13. Every admin mutation is role-checked, MFA-protected, and audited.
12a. Trip records support a pay-day commission report per driver, with zero commission charged per trip.
14. Load test meets the Phase 2 targets for concurrent drivers, riders, and location updates. Values `TBD`.
15. Staging restore and failover drills succeed within the agreed recovery targets. Values `TBD`.

---

## 10. Phase checklist

| Phase | Name | Status |
|---|---|---|
| 0 | Reconcile discovery, lock scope | **In review** |
| 1 | Experience design | Not started |
| 2 | Architecture, domain model, contracts | Not started |
| 3 | Repository and working foundation | Not started |
| 4 | Identity, onboarding, eligibility | Not started |
| 5 | Presence, locations, maps, saved places | Not started |
| 6 | Fare quote, request, exclusive dispatch | Not started |
| 7 | Trip lifecycle and navigation | Not started |
| 8 | Cash, settlement, accounting | Not started |
| 9 | Communication, safety, post-ride help | Not started |
| 10 | Admin operations and configuration | Not started |
| 11 | Hardening and release decision | Not started |

## 11. Traceability

The full BR/NFR → HLD → LLD → VT matrix is in BRS §10 and LLD §13 and remains valid. Additions from this register:

| New item | Traces to |
|---|---|
| Bus decision (Q1) | Owner prompt only. No BR yet. A BR is added if bus enters scope. |
| Admin MFA (D-09) | BR-42, NFR-09, HLD-05 |
| Quote vs final fare (Q5) | BR-26, OD-03, HLD-11, LLD-07 |
| Acceptance criteria §9 | VT-01 to VT-17 |
