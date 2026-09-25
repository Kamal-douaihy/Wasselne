# Wasselne — Phase 0 Register: Reconciled Scope, Decisions, and Open Items

**Status:** **Phase 0 approved by owner, 2026-09-24.** Revision 7 (adds §10a: Phase 2 approval record and Phase 3 amendments). Not a design approval, not implementation.
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
| C-08 | Owner references Uber-style "behavioral modeling" (price based on a rider's willingness to pay). This is personalized pricing: it needs rider history that won't exist at launch, raises fairness and consumer-law questions in Lebanon, and conflicts with BR-16 (rider and driver see the same fare). | Deferred (D-27). Not in the first release. Revisit with data and legal review. |
| C-09 | Owner says money "comes to the app and the app pays the drivers", and mentions a failed payment falling back to cash. D-05 (approved) says cash is the only enabled method, so the driver holds the money and cannot "fail". Platform collection also needs a payment provider and Lebanese legal review. | **Resolved (D-38):** all non-cash methods exist in the CMS but stay disabled; only cash is enabled at launch. |
| C-10 | Owner wants admins to see all rides and all chats. HLD §3 and §6 say staff see only what a case needs. | Owner decision wins (D-33). Access is limited to a specific admin permission, every view is audited, and the privacy policy tells users chats may be reviewed. |

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
| D-15 | **Upfront pricing.** Rider price = (base fare + km-rate × planned-route km + minute-rate × predicted minutes) × surge multiplier + add-ons − discount, then minimum fare and rounding. Route km and minutes come from the map provider's traffic-aware route. Every component is set in the CMS per category, zone, and currency. The quote is the agreed fare unless the CMS fare mode says "recalculate at completion", in which case the final fare is capped by a CMS cap (D-20). | Owner, 2026-09-24 (Q4, Q5, F-1) | Approved |
| D-16 | **Driver payout and commission.** Driver payout = fare − platform commission. Commission percentage is set in the CMS per category and zone and may be 0% at launch. Because riders pay cash to the driver, commission owed is recorded on every trip and settled per driver on pay day. | Owner, 2026-09-24 (Q6, F-4) | Approved; pay-day rules F-4 |
| D-17 | SOS at launch opens a priority chat with a Wasselne support agent. The agent then phones the user. The app reports only what actually happened, such as "request sent" or "agent joined". It never claims a call happened. | Owner, 2026-09-24 (Q7) | Approved |

---
| D-18 | Sign-in: phone number + SMS code for riders and drivers. Admins use email, password, and an authenticator app. | Owner, 2026-09-24 (Q8) | Approved |
| D-19 | When both currencies are published, rider and driver see both amounts. The rider may pay in either. The driver records which currency and amount was collected. | Owner, 2026-09-24 (F-2) | Approved |
| D-20 | In recalculation mode, the final fare may exceed the quote only up to a CMS-set cap. | Owner, 2026-09-24 (F-3) | Approved |
| D-21 | If SOS is pressed and no agent is online, the app shows the CMS-configured emergency number to dial and on-call staff are alerted. | Owner, 2026-09-24 (F-5) | Approved |
| D-22 | **Legal documents in CMS.** Admins publish terms and conditions and policies (privacy, cancellation, etc.) per language, as versions. Users accept the current version at sign-up. A new version can require re-acceptance. Every acceptance is recorded with version and time. | Owner, 2026-09-24 | Approved (new) |
| D-23 | **Discounts in CMS.** Two kinds: promo codes entered by the rider, and automatic category discounts (e.g. 20% on tuk-tuk for one month). Each has a percentage or fixed amount, start and end dates, zones, categories, optional max discount, and usage limits. The discount is shown in the quote and snapshotted with the ride. | Owner, 2026-09-24 | Approved (new); funding F-7 |
| D-24 | **Categories are CMS data.** Car, motorcycle, and tuk-tuk are the initial records. Admins can add categories such as Luxury or Women's taxi, each with localized name, icon, base vehicle type (car, motorcycle, or tuk-tuk, which drives routing and vehicle rules), seats, driver and vehicle eligibility requirements, required documents, tariffs, commission, discounts, and zone enablement. A driver can qualify for several categories. | Owner, 2026-09-24 | Approved (new); women's category F-8 |
| D-25 | **Surge.** A surge multiplier per zone and category, derived from open requests versus available drivers, bounded by CMS minimum and maximum, with a CMS on/off switch and manual override. The rider sees the multiplier before requesting. | Owner, 2026-09-24 | Approved (new); launch mode F-9 |
| D-26 | **Add-ons.** CMS-defined fixed or percentage add-ons (tolls, airport fees, taxes, surcharges) with the zones, categories, and times they apply. No tax or fee values are invented. | Owner, 2026-09-24 | Approved (new) |
| D-27 | Behavioral (willingness-to-pay) pricing is not in the first release. | C-08 | Approved |
| D-28 | **Payment timing.** The rider pays at the end of the trip. A CMS parameter sets the percentage of the route after which payment is requested; initial value 100%. | Owner, 2026-09-24 (F-6) | Approved |
| D-29 | **Fallback to cash.** If an in-app payment fails, the driver is told to collect cash. Applies once a non-cash method exists (see G-1). | Owner, 2026-09-24 | Approved; depends on G-1 |
| D-30 | **Driver wallet.** Each driver has a ledger wallet. Trip earnings, tips, discount compensation, commission owed, and payouts are immutable ledger entries. A payout is due when the balance owed to the driver exceeds X, or Y weeks have passed since the last payout. X and Y are set in the CMS. The payout method is `TBD`. | Owner, 2026-09-24 (F-4) | Approved |
| D-31 | **Discount funding** is a parameter on each discount (platform, driver, or a split). All money is modeled through the platform ledger, so changing the policy needs no code change. | Owner, 2026-09-24 (F-7) | Approved |
| D-32 | **Driver verification.** Every driver uploads ID and required documents from the app, directly to private S3 storage. An admin approves or rejects; only approved drivers can go online. Drivers submit vehicle photos monthly for a check-up; the interval and grace period are set in the CMS, and an overdue check blocks going online. | Owner, 2026-09-24 (F-8) | Approved; overdue rule default G-3 |
| D-33 | **Admin oversight.** Admins with the right permission can view all rides and all chats. Every view is audited. | Owner, 2026-09-24 | Approved (see C-10) |
| D-34 | **Account blocking.** An admin can block any account. A blocked driver cannot go online; a blocked rider cannot request rides. Sessions and sockets are cut, and the user sees a message with a support contact. A block issued during a trip takes effect when the trip ends (D-41). | Owner, 2026-09-24 | Approved; amended by D-41 |
| D-35 | **Women's category.** Women drivers carrying women riders only. | Owner, 2026-09-24 (F-8) | Approved; rider eligibility G-2 |
| D-36 | Surge is manual (admin-set) at launch. Automatic surge is a later version. | Owner, 2026-09-24 (F-9) | Approved |
| D-37 | **Tips.** A rider can add a tip when reviewing the driver. The full tip goes to the driver, with no commission. Tips are paid in cash and recorded for information (D-42). | Owner, 2026-09-24 | Approved; cash collection G-5 |
| D-38 | **Payment methods are CMS entities.** Every method (cash, OMT, Whish, bank, card, etc.) is disabled until an admin enables it and enters its details in the CMS. Only cash is enabled at launch. A method can be enabled only if its provider adapter has been built and tested; the CMS refuses otherwise. | Owner, 2026-09-24 (G-1) | Approved |
| D-39 | **Women-rider eligibility.** The rider declares gender when creating the account. Management confirms it after the first ride. The driver may decline and report a mismatch at pickup without penalty. | Owner, 2026-09-24 (G-2) | Approved |
| D-40 | An overdue vehicle check never blocks a driver at once: reminders first, then a block from going online after a CMS grace period. | Owner, 2026-09-24 (G-3) | Approved |
| D-41 | **Blocking never interrupts a ride.** A block issued during a trip takes effect when the trip ends. This replaces the admin "end trip" option in D-34. | Owner, 2026-09-24 (G-4) | Approved |
| D-42 | **Commission switch.** The CMS has a "commission counting" switch. Each ride stores the switch value at request time as a true/false flag. Commission is calculated only over rides flagged true. Tips and other cash between rider and driver carry no commission; tips are recorded for information only. | Owner, 2026-09-24 (G-5) | Approved |
| D-43 | **Driver debt settlement methods are CMS entities**, e.g. deduction from payout or cash pickup by an agent. Admins enable them later; every collection is an admin-recorded ledger entry. | Owner, 2026-09-24 (G-6) | Approved |
| D-44 | Rider and driver phone numbers are visible from driver confirmation until a CMS-set time after the trip ends (e.g. 30 min, 8 h, 24 h, 2 days). | Owner, 2026-09-24 (Q9) | Approved |
| D-45 | Admin console is English only at launch. | Owner, 2026-09-24 (Q10) | Approved |

## 4. First-release boundary

**In the first release (subject to answers):**
- Rider app: sign-in, language (ar/en/fr, RTL), map, pickup/destination, saved places, category, CMS fare, immediate request, search status, driver details, live tracking, trip states, chat with translation, call after confirmation, cash outcome, review, help, lost-item case, SOS options as published.
- Driver app: sign-in, onboarding with documents/photos, approval status, online/offline, background location, offer ACK plus 3-second accept/decline, navigation, trip transitions, cash report, chat, call, review, help, damage case, SOS.
- Admin console: CMS for categories, tariffs, surge, add-ons, discounts and promo codes, commission, terms and policies, SOS fallback number; RBAC and MFA, driver/vehicle review, zones/categories, fare and currency publication, live trips, support cases, SOS configuration and incidents, reviews, cash records, audit.
- Backend: everything in HLD-04 to HLD-24 for the flows above.

**Explicitly out of the first release:**
- Scheduled rides (future).
- OMT, Whish, bank payment collection (disabled, future).
- Driver price entry, negotiation, counteroffers (removed).
- Masked calling (not designed; numbers may be visible, see Q9).
- Per-trip commission deduction (D-16). Pay-day commission calculation is in scope for Phase 8.

**Also out of the first release:** bus service (D-12) and kiosk mode (D-13).

**Also out of the first release:** behavioral pricing (D-27).

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
| Q8 | Sign-in method | OD-11 | Resolved (D-18) |
| Q9 | Phone number visibility window | OD-08 | Phase 1 | Resolved (D-44) |
| Q10 | Admin console languages | OD-11 | Phase 1 | Resolved (D-45) |
| Q11 | ACK timeout, max reoffers, max rider search time | OD-13, OD-16 | Phase 2 | 5 s ACK, 3 offers per driver per ride, 3 min search |
| Q12 | Rounding per currency, quote expiry, surge formula details | OD-03, D-15, D-25 | Phase 2 | Round USD to $0.25 and LBP to 5,000. Quote valid 5 min |
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
| F-1 | "km × rate × road time × factor" multiplies distance by time, which grows very fast on long trips. Is the intent `(km × km-rate + minutes × minute-rate) × factor`? | Phase 2 | Resolved (D-15) |
| F-2 | When both USD and LBP are published, does the rider see both amounts? Which currency is the driver told to collect? | Phase 1 | Resolved (D-19) |
| F-3 | When recalculation mode is on, may the final fare exceed the quote by any amount? | Phase 2 | Resolved (D-20) |
| F-4 | Is commission calculated with the rule in force at trip time? How often is pay day? (See F-6.) | Phase 8 | Resolved (D-30) |
| F-6 | Owner answered F-4 with "the rider pays after 30% of the total route is passed." Does this mean (a) cash is collected once 30% of the route is done, (b) a rider who ends the trip early after 30% pays the full fare, or (c) something else? | Phase 2 | Resolved (D-28) |
| F-7 | Who pays for a discount: the platform or the driver? | Phase 2 | Resolved (D-31) |
| F-8 | For a women's category: must drivers be women, verified how, and can any rider book it? Gender is sensitive personal data. | Phase 1 | Resolved (D-32, D-35); see G-2 |
| F-9 | At launch, is surge automatic or manual only? | Phase 2 | Resolved (D-36) |
| F-5 | What happens when SOS is pressed and no agent is online? | Phase 1 | Resolved (D-21) |

### Third-round questions

| ID | Question | Needed by | Proposed default |
|---|---|---|---|
| G-1 | Is a non-cash in-app payment method (e.g. Whish, card, wallet top-up) part of the first release? If not, payment cannot "fail" and money stays with the driver. | Phase 1 | Resolved (D-38) |
| G-2 | How is a rider verified as a woman for the women's category? | Phase 1 | Resolved (D-39) |
| G-3 | When a monthly vehicle check is overdue, is the driver blocked immediately? | Phase 4 | Resolved (D-40) |
| G-4 | When blocking an account during a trip, does the trip end? | Phase 4 | Resolved (D-41) |
| G-5 | With cash, a tip added later in the review cannot be handed to a driver who has left. How is it paid? | Phase 1 | Resolved (D-42) |
| G-6 | When a driver owes the platform (cash commission), how does the driver pay it? | Phase 8 | Resolved (D-43) |

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
| R-12 | Surge in a new market may upset riders or draw regulatory attention. | Medium | CMS cap and switch. Show the multiplier before booking. Start manual (F-9). |
| R-13 | Promo abuse through multiple accounts. | Medium | Per-rider and per-phone limits. Audit usage. |
| R-14 | A women's category needs gender data and verification, which is sensitive. | Medium | F-8 policy, least-data storage, legal review. |
| R-15 | Scope grew in this round (CMS categories, surge, discounts, terms). | Medium | Built into Phases 8 and 10. P1 priority, after the core ride loop works. |
| R-16 | Enabling a non-cash method later may need a payment licence or licensed partner in Lebanon. | High | D-38 keeps them off. Legal review and a built adapter before enabling. |
| R-17 | Blanket admin access to chats is a privacy and insider-misuse risk. | Medium | Separate permission, audit of every view, privacy notice. |
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
12a. Each trip records its commission flag and the commission owed from the CMS rate. Only flagged rides count, and a pay-day report lists what each driver owes.
13. Every admin mutation is role-checked, MFA-protected, and audited.
13e. A driver with an unapproved or overdue vehicle check cannot go online. A blocked rider cannot request and a blocked driver cannot go online.
13f. Wallet balances are derived only from ledger entries, and pay-day triggers follow the CMS X and Y values.
13a. The quote shows base, distance, time, surge, add-ons, and discount, and matches the published tariff for the ride's zone, category, and currency.
13b. A promo code or category discount applies only inside its dates, zones, categories, and limits.
13c. A category created in the CMS appears to riders and drivers in enabled zones without an app release.
13d. Users must accept the current terms version, and each acceptance is stored with version and time.
14. Load test meets the Phase 2 targets for concurrent drivers, riders, and location updates. Values `TBD`.
15. Staging restore and failover drills succeed within the agreed recovery targets. Values `TBD`.

---

## 10. Phase checklist

| Phase | Name | Status |
|---|---|---|
| 0 | Reconcile discovery, lock scope | **Approved 2026-09-24** |
| 1 | Experience design | **Approved 2026-09-24** (`docs/phase-1/`) |
| 2 | Architecture, domain model, contracts | **Approved 2026-09-24** (owner instruction in session; baseline = commit `04e9761`). Amended by A-3-01..03 below, which the owner accepts or rejects with Phase 3 |
| 3 | Repository and working foundation | **Delivered, awaiting owner approval** (`docs/phase-3/Phase3_Report.md`; not yet committed) |
| 4 | Identity, onboarding, eligibility | Not started (blocked until Phase 3 is approved) |
| 5 | Presence, locations, maps, saved places | Not started |
| 6 | Fare quote, request, exclusive dispatch | Not started |
| 7 | Trip lifecycle and navigation | Not started |
| 8 | Cash, settlement, accounting | Not started |
| 9 | Communication, safety, post-ride help | Not started |
| 10 | Admin operations and configuration | Not started |
| 11 | Hardening and release decision | Not started |

### 10a. Phase 2 approval record and Phase 3 contract amendments

**Phase 2 approval.** The owner wrote "Approved phase 2, proceed phase 3" on 2026-09-24 at the start of the Phase 3 session. The approved baseline is git commit `04e9761` ("Phase 2: architecture, state machines, tested schema, API and socket contracts"). This is a chat instruction, not a signed document; the owner can ask for a different form of record.

**Amendments made to Phase 2 artifacts during Phase 3.** Phase 3 found that the first foundation code diverged from `openapi.yaml`. The code was brought into line with the contract wherever possible. The changes below are the only edits to approved Phase 2 files and need owner acceptance:

| ID | File | Change | Reason |
|---|---|---|---|
| A-3-01 | `schema.sql`, new `db/migrations/019_otp_challenge_app.sql` | `otp_challenges.app` (`app_kind NOT NULL`) | `POST /auth/otp/verify` has no `app` field, so the challenge must remember which app asked for the code. |
| A-3-02 | `openapi.yaml` `ErrorCode` | Added `NOT_FOUND` and `INTERNAL_ERROR` | The contract had no code for unknown routes (404) or unhandled failures (500). |
| A-3-03 | `openapi.yaml` `/me`, `/me/complete-profile` | Declared `429` (`RateLimited`) | The global per-IP ceiling can answer `RATE_LIMITED` on any operation. Other operations get it when they are implemented. |
| A-3-04 | `schema-invariants-test.sql` | Each check now states the expected SQLSTATE and raises on unexpected success | The old version only printed `FAIL` and could not fail a process. |

`scripts/split-schema.mjs` was deleted: `db/migrations/` is now the source of truth for new changes, and `db:check-schema` proves migrations and `schema.sql` describe the same structure.

## 11. Proposed BRS amendments

These add owner requirements from 2026-09-24. The BRS Word file is not edited; the amendments live here until a BRS revision is approved.

| ID | Requirement | Priority | Decision |
|---|---|---|---|
| BR-50 | Admins shall publish upfront fare components per category, zone, and currency: base, per-km, per-minute, minimum, rounding. | M | D-15 |
| BR-51 | Admins shall configure surge per zone and category within set bounds, and the rider shall see it before requesting. | M | D-25 |
| BR-52 | Admins shall configure add-ons such as tolls, fees, taxes, and surcharges. | M | D-26 |
| BR-53 | Admins shall set commission per category and zone. Each trip records the commission owed, settled on pay day. | M | D-16 |
| BR-54 | Admins shall create promo codes and time-limited category discounts. | M | D-23 |
| BR-55 | Admins shall create and edit vehicle categories with their eligibility, documents, fares, and enablement. | M | D-24 |
| BR-56 | Admins shall publish versioned terms and policies per language. Users accept them, and acceptance is recorded. | M | D-22 |
| BR-57 | Rider and driver see both currencies when both are published. The rider may pay in either. | M | D-19 |
| BR-58 | Payment is requested at a CMS-set percentage of the route, default 100%. | M | D-28 |
| BR-59 | Each driver has a ledger wallet with CMS-set payout triggers. | M | D-30 |
| BR-60 | Drivers submit monthly vehicle photos for review at a CMS-set interval. | M | D-32 |
| BR-61 | Authorized admins can view all rides and chats, with every view audited. | M | D-33 |
| BR-62 | Admins can block any rider or driver account from riding or going online. | M | D-34 |
| BR-63 | Riders can tip the driver when reviewing. | M | D-37 |
| BR-64 | Payment methods and debt-settlement methods are managed in the CMS; only cash is enabled at launch. | M | D-38, D-43 |
| BR-65 | Riders declare gender at sign-up for women's category eligibility, confirmed by management. | M | D-39 |
| BR-66 | A CMS switch controls whether new rides count toward commission, stored per ride. | M | D-42 |

## 12. Traceability

The full BR/NFR → HLD → LLD → VT matrix is in BRS §10 and LLD §13 and remains valid. Additions from this register:

| New item | Traces to |
|---|---|
| Bus decision (Q1) | Owner prompt only. No BR yet. A BR is added if bus enters scope. |
| Admin MFA (D-09) | BR-42, NFR-09, HLD-05 |
| Quote vs final fare (Q5) | BR-26, OD-03, HLD-11, LLD-07 |
| Acceptance criteria §9 | VT-01 to VT-17 |
