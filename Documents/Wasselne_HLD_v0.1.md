# Wasselne — High-Level Design (HLD)

**Status:** Draft for owner review; HLD not yet approved  
**Version:** 0.1  
**Source:** Wasselne BRS v0.1, revised draft, Library version 1; owner approved the BRS in the project conversation.  
**Sequence:** BRS approved → **this HLD for approval** → LLD → architecture diagrams. No LLD or final architecture diagram is part of this deliverable.

## 1. Purpose, boundaries, and decisions

This HLD translates the approved Wasselne business requirements BR-01–BR-49 and NFR-01–NFR-12 into system responsibilities, data ownership, interaction flows, deployment boundaries, and safeguards. It is an architecture proposal. It does not claim that the system is implemented, that integrations have been contracted, or that open business policies have been decided.

**Launch scope:** staged activation of selected Lebanon service areas (candidate names: Zgharta, Ehden, Batroun, Jbeil, Beirut, Jounieh, Tripoli/Tarablos, Koura, Bcharre), immediate car/taxi, motorcycle, and tuk-tuk ride requests where enabled, mainly independent drivers, rider and driver mobile apps, admin web console, user-selected Arabic/English/French, both admin-selectable fare-setting modes, cash at launch, reciprocal reviews, saved places, post-trip help, and configurable SOS. Exact map boundaries, order, vehicle eligibility, rates, and policies remain open.

**Explicit exclusions from enabled first-release flows:** scheduled ride booking and live OMT, Wish/Whish, or bank collection. Their configuration names and future extension seams may exist, but no provider transactions or customer charges may occur until separately authorized.

### 1.1 Proposed architecture choices

| Decision | Proposed choice | Reason and boundary | Trace |
| --- | --- | --- | --- |
| Deployable backend | TypeScript/NestJS modular monolith, with API/WebSocket runtime and background worker runtime from one codebase. | A single transactional domain makes three-second serial dispatch and trip/fare consistency easier to govern at the initial scale. Independent processes allow different resource profiles without an early distributed-service estate. | BR-12–19, NFR-01–02, NFR-07 |
| Mobile | Separate Flutter/Dart rider and driver apps with shared API models, localization, and design tokens. Platform-specific modules handle background location and notifications. | Gives distinct workflows and one shared mobile foundation while respecting Android/iOS lifecycle rules. | BR-01–04, BR-08–09, BR-21, NFR-06, NFR-11–12 |
| Operations web | Responsive React/Next.js with TypeScript, role-specific pages and an API. | Supports approvals, fares, active trips, cases, reviews, SOS, and audit workflows; precise kiosk interaction remains undecided. | BR-06, BR-35, BR-40–45, NFR-09, NFR-11 |
| System of record | Managed PostgreSQL with PostGIS. | Transactions and database constraints govern booking, one-at-a-time offers, assignments, prices, cash records, cases, and reviews; spatial polygons govern coverage. | BR-10, BR-12–29, BR-38–49, NFR-08 |
| Live lookup | Managed Redis GEOSEARCH plus short-lived presence/freshness metadata. | Efficient shortlist and transient location; never the authority for a ride assignment, payment, or active offer. | BR-07–13, BR-21, NFR-03 |
| External capabilities | Provider adapters for maps/routes/geocoding, notifications, translation, telephony, and later payments; private object storage for documents/evidence. | Isolates vendor changes and prevents a failed third party from rewriting ride truth. Provider selection and terms require later review. | BR-05, BR-11, BR-28–37, BR-47–49 |
| Hosting | Managed container platform in a suitable region, two or more app tasks across availability zones, managed database failover, managed Redis, private storage, staging, CI/CD, and monitoring. | Reduces single-host failures, with explicit degraded behavior when DB, network, push, or maps are unavailable. Region and cost need validation. | NFR-01–05, NFR-07–10 |

No Kafka, H3, Kubernetes, second primary database, or independent matching service is required for the initial scale. A measured bottleneck or organizational requirement can reopen those choices in a later architecture decision record.

## 2. Logical component catalogue

Each component has a stable **HLD ID** for requirements traceability. “Owns” names logical responsibilities; modules may share one PostgreSQL deployment but may not mutate one another's records without an explicit domain operation.

| HLD ID | Component / responsibility | Owns or uses | Parent requirements |
| --- | --- | --- | --- |
| HLD-01 | Rider mobile client: language, map, saved places, request, fare approval, trip, chat, call, SOS, support, review. | Authenticated rider session and local UI state; server owns ride truth. | BR-01–04, BR-09–11, BR-14–16, BR-19–23, BR-25–38, BR-46–47, NFR-02, NFR-06, NFR-11 |
| HLD-02 | Driver mobile client: registration, document upload, online/offline, location, exclusive offer countdown, fare proposal, trip, support/SOS, review. | Permissions and local GPS acquisition; server owns eligibility and offer deadline. | BR-01–08, BR-12–13, BR-16–23, BR-30–39, BR-48, NFR-02–03, NFR-06, NFR-11–12 |
| HLD-03 | Admin web console: approvals, active areas/categories, fare/currency/mode versions, incidents, cases, reviews, permissions, audit. | Authorized administrative commands and projections. | BR-06, BR-14, BR-24–25, BR-35, BR-40–45, BR-49, NFR-09, NFR-11 |
| HLD-04 | Edge/API: load balancer, HTTP endpoints, WebSocket authentication and gateway, input validation, rate limits. | Authenticated request routing, connection lifecycle; no persistent ride truth. | BR-01–04, BR-18–22, BR-30–36, NFR-01–04 |
| HLD-05 | Identity and authorization module: rider/driver/admin identity, sessions, roles, record ownership checks. | Accounts and access policy; exact sign-in method TBD. | BR-02, BR-05–07, BR-30–31, BR-40–43, NFR-04–05, NFR-09 |
| HLD-06 | Driver/vehicle eligibility and uploads: registrations, document metadata/review, approvals, suspensions. | Persistent eligibility state and secure object references. | BR-05–08, BR-41, NFR-04–05, NFR-10 |
| HLD-07 | Service geography and rider places: versioned active polygons/categories, saved named places. | PostGIS zones; user-owned named locations. | BR-09–11, BR-41, BR-45–46, NFR-04 |
| HLD-08 | Location and presence module: driver heartbeat, position accuracy/freshness, Redis geo, selected trip tracking. | Ephemeral position, presence and sampled history only if approved. | BR-07–08, BR-11–13, BR-21–22, NFR-02–04 |
| HLD-09 | Dispatch and offer coordinator: shortlist, one outstanding offer per request, three-second expiry, decline, reoffer, atomic reserve. | Durable offer state and candidate progression. | BR-12–13, BR-16–18, BR-22, NFR-01–03, NFR-12 |
| HLD-10 | Trip lifecycle: request/confirmation, permitted transitions, cancellation/no-show, participant snapshots, trip history. | Durable trip and assignment state. | BR-09, BR-17–23, BR-26–27, BR-30–31, BR-38–39, NFR-02, NFR-08 |
| HLD-11 | Fare configuration and quote: active pricing mode, rates, currency, quote/proposal and immutable per-trip agreement snapshot. | Versioned policy and fare agreement; numeric policy TBD. | BR-14–16, BR-24–26, BR-41, BR-44, NFR-09 |
| HLD-12 | Cash and payment capability: cash collection record, reconciliation status, future disabled method registry and provider seam. | Durable financial events; no live non-cash charge. | BR-27–29, BR-44, NFR-07–08 |
| HLD-13 | Maps/routing adapter: geocoding, map display data, shortlist road ETA, route and navigation handoff. | Provider calls and caching policy, not ride assignment. | BR-09–11, BR-21, BR-46, NFR-01, NFR-03 |
| HLD-14 | Realtime and notification delivery: trip event fan-out, WebSocket sessions, APNs/FCM push, reconnect snapshot. | Delivery attempts and outbox processing; never authoritative acceptance. | BR-12–13, BR-19–22, BR-31–36, NFR-02, NFR-07, NFR-12 |
| HLD-15 | Chat/translation/contact: trip-scoped original messages, translations, telephone action after confirmation. | Durable chat and approved contact policy. | BR-30–32, NFR-04–05 |
| HLD-16 | Support/case management: trip-linked cases, lost property, mess/damage evidence, staff workflow and outcome. | Case history and restricted evidence references. | BR-33, BR-40, BR-43, BR-47–49, NFR-04–05, NFR-07 |
| HLD-17 | SOS policy/incident module: publish approved choices, initiate selected action, log status/escalation. | Versioned action registry and incident trail. | BR-34–37, BR-41–44, NFR-04, NFR-07, NFR-09 |
| HLD-18 | Reciprocal review module: one review per author/direction/completed trip, staff dispute handling. | Review and moderation records. | BR-38–40, BR-43, NFR-04 |
| HLD-19 | PostgreSQL/PostGIS data service: transactional records, geofences, integrity constraints, backups. | Source-of-truth persisted data. | BR-05–49, NFR-04–05, NFR-08–09 |
| HLD-20 | Managed Redis: candidate geolocation and presence, distributed WebSocket fan-out where needed, caches. | Rebuildable ephemeral data only. | BR-07–13, BR-21–22, NFR-01–03 |
| HLD-21 | Private object storage: driver documents and case attachments, short-lived upload/download authorization. | Encrypted objects with database ownership metadata. | BR-05–06, BR-47–49, NFR-04–05 |
| HLD-22 | Durable outbox and worker: offer expiry/recovery, reliable notification jobs, translation and evidence processing. | Transactionally enqueued work with retry/idempotency. | BR-12–13, BR-18–22, BR-32–37, BR-47–49, NFR-02, NFR-07 |
| HLD-23 | Security, audit and observability: administrative audit, metrics, traces, alerts, incident investigation. | Access controls, security telemetry and operational evidence. | BR-06, BR-36, BR-40–44, BR-49, NFR-01, NFR-04–10, NFR-12 |
| HLD-24 | Hosting/delivery platform: load-balanced app and worker instances, managed data services, secrets, backups, release pipeline. | Runtime availability and recovery processes. | NFR-01–02, NFR-05, NFR-07–10 |

## 3. Data ownership and trust boundaries

| Data class | Authoritative store | Consumers and rules |
| --- | --- | --- |
| Identities, eligibility, vehicles, document review | PostgreSQL; file bytes in private object storage | Rider/driver self access as appropriate, reviewers by role; approval rechecked before offers. |
| Service zones and categories | Versioned PostGIS geometries and metadata in PostgreSQL | Admin publishes; booking validates pickup, destination, vehicle type against currently active policy. Exact area boundaries remain TBD. |
| Saved places | PostgreSQL, scoped to rider identity | Only owner and narrowly authorized support where needed; a trip stores a pickup/destination snapshot, not a mutable pointer to the saved-place label. |
| Driver geo/presence | Redis geo index plus independently checked heartbeat timestamp/accuracy | A Redis geo member alone is never evidence of online eligibility; remove or ignore stale entries. Share precise trip location only with authorized participants. |
| Ride requests, offers, assignments, trips | PostgreSQL | Transactions and constraints govern the sole active offer and sole confirmed assignment. WebSocket events are derived notifications. |
| Fare policies, currency, proposals, cash | PostgreSQL, versioned and immutable snapshots for accepted rides | Admin may publish future-effective changes; agreed amount/currency survives configuration updates. |
| Chat, reviews, support, SOS/audit | PostgreSQL; restricted attachments in object storage | Strict participant/role access and retention policies; no public object URLs or wholesale chat visibility for operations staff. |

High-frequency driver location writes should not be copied into PostgreSQL on every update. A limited, consent/policy-approved trip trail may be persisted for disputes and safety; its sampling and retention need a decision. Redis position loss may temporarily pause matching until drivers reconnect/repopulate, without erasing trips or offers. Coverage decisions use PostGIS polygons; candidate proximity uses Redis; routes/ETA are computed by a selected map provider. PostGIS supports index-aware polygon coverage queries and Redis GEOSEARCH provides radius/box candidate queries. [PostGIS documentation](https://postgis.net/docs/ST_Covers.html), [Redis documentation](https://redis.io/docs/latest/commands/geosearch/).

## 4. Key interactions and consistency model

### 4.1 Onboarding, online presence, and coverage

1. A driver submits identity/vehicle information and uploads documents directly to private storage using a short-lived authorization. The backend validates ownership, type, size, and review status; admin approval or suspension is recorded with actor/time/reason. Document requirements depend on the approved Lebanon operating policy.
2. An approved driver chooses online. The driver app obtains platform-compliant location permission and sends coordinates, timestamp, and quality/accuracy information. The backend validates the update, category, eligibility, and active area before updating Redis. On offline/suspension, it removes or makes the driver ineligible immediately; heartbeat checks still exclude stale geo members.
3. Admin publishes zone/category activation after preview and authorization. PostGIS geofences govern which pickups may be booked and where drivers may be dispatched. Candidate names do not imply that every surrounding district is open. Saved rider places are private shortcuts and never bypass active coverage checks.

Android foreground-service and iOS background-location constraints require a real device implementation and user-visible permissions; the platform cannot assume Flutter itself ensures constant GPS delivery. [Android documentation](https://developer.android.com/develop/background-work/services/fgs/service-types), [Apple documentation](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background).

### 4.2 Immediate request and strictly sequential dispatch

1. **Create request:** The rider sends pickup, destination, category and an idempotency key. The API validates identity, active pickup/service area and fare mode; it records one ride request and a snapshot of the relevant setting versions. A duplicate client retry returns that same ride.
2. **Choose candidate:** HLD-09 asks Redis for nearby fresh, approved, online drivers of the chosen category. It excludes those already reserved/busy and may use HLD-13 for road ETA on a small shortlist. Redis is a shortlist, so current PostgreSQL eligibility and active assignment are rechecked at offer creation.
3. **Issue one offer:** A PostgreSQL transaction locks the ride request, checks it has no unexpired or pending-delivery offer, reserves one candidate's dispatch slot, creates an offer with its unique identity and three-second acceptance deadline under the agreed clock-start rule, and records an outbox delivery event. A database invariant prohibits more than one *outstanding* offer per ride, including delivery-pending and driver-reserved/awaiting-rider-decision states where the chosen fare policy requires them. No second driver is issued an actionable offer while this slot is occupied.
4. **Accept or decline:** An acceptance carries ride ID, offer ID, driver identity, and an idempotency key. In one transaction, the service checks the driver, request, offer identity, expiry, pricing state, and lack of other active assignments, then changes the offer/ride/driver reservation atomically. Declines and stale/expired replies cannot succeed. An explicit uniqueness constraint for the outstanding offer and an active driver-assignment constraint remain the final guard across all API instances. PostgreSQL can enforce uniqueness over a subset of states with a partial unique index. [PostgreSQL documentation](https://www.postgresql.org/docs/current/indexes-partial.html).
5. **Advance the queue:** At the deadline, a durable worker transaction expires the current offer **before** creating the next one. Decline can trigger the same transition early. If there is no other eligible candidate, the previously attempted driver can receive a *new* offer and deadline; maximum attempts and total rider wait time await owner policy. A worker crash must not strand an offer: expiry is recovered by scanning durable offer deadlines when workers resume or another instance takes over.
6. **Notify and recover:** WebSocket and push signal offer changes, but neither determines ownership. Driver app countdown and server acceptance both use the server-issued offer identity and authoritative deadline. The app checks current server state before presenting a late notification as actionable. After reconnect, both apps fetch current ride/offer state. A delayed push or repeated socket event referring to an old offer can never reopen it. An operating-system notification can still arrive late while another driver has the current offer; its delivery time cannot be controlled by the backend. The enforceable invariant is **one active, acceptable driver offer per ride**, not an impossible guarantee about network packet arrival.

**Three-second delivery risk:** A push message sent while the driver app is backgrounded may arrive after the acceptance window; even high-priority mobile push is an attempt at prompt delivery, not a three-second guarantee. The HLD does **not** treat push acknowledgement or a notification tap as acceptance. The owner must decide whether the three seconds begin when the server issues the offer or after a verified in-app delivery acknowledgement, and what happens if that acknowledgement never arrives. Until resolved, no production claim can be made that every eligible driver gets a full visible three seconds. This policy and active/background-device eligibility are gating decisions for LLD and real-device testing. [Firebase priority guidance](https://firebase.google.com/docs/cloud-messaging/android-message-priority), [Android background notification behavior](https://firebase.google.com/docs/cloud-messaging/android/receive-messages).

### 4.3 The two fare modes without concurrent offers

**Platform fare:** HLD-11 calculates a quote using the published mode, area/category rate configuration and USD or LBP currency version. The rider sees it before requesting/confirming. The accepted fare policy/version, amount and currency are copied into the ride agreement. Any post-ride adjustment requires an approved policy and a separate record; an admin edit cannot silently reprice an agreed ride.

**Driver-proposed fare:** The rider must explicitly accept a particular driver's proposed amount/currency before the booking is confirmed. The system must keep the request exclusive to that driver while a permitted proposal/decision is pending or explicitly release them and move on; two drivers must never simultaneously hold an active offer for that ride. The HLD proposes *as an option for owner review* a three-second driver **acceptance of the chance to propose**, followed by a separate bounded proposal and rider-decision interval with that driver reserved. An alternative is price submission within the three-second window. **Neither option is approved yet**; the choice affects states, timeouts, the rider experience, and dispatch fairness (BRS OD-04 and OD-12).

### 4.4 Trip, cash, and post-trip cases

HLD-10 controls trip transitions and prevents a client from declaring an impossible state. Once the booking is confirmed, the rider receives assigned-driver identity and appropriate current location, and both participants can use the approved phone/chat contact window. The driver follows a map route or approved navigation handoff. The system records cash as reported collected, disputed or unresolved as appropriate to later policy; a cash flag is **not** a provider-verified bank settlement. No future payment option can trigger a charge while disabled. Future adapters must preserve idempotent financial records and approved ledger/reconciliation behavior.

After completion, HLD-18 offers a rider→driver and driver→rider review tied to that ride; format, visibility and moderation are pending. The rider may open a forgotten-item case and the driver may open a mess/damage case. HLD-16 links each case to the ride, retains authorized messages/evidence, provides case status and a human review path. A driver claim does not create a rider debt or charge automatically. Case deadlines, remedies and appeals remain pending.

### 4.5 SOS, support, translation, and phone contact

HLD-17 publishes a versioned, admin-approved list of supported SOS actions, limited to registered safe action types: emergency call handoff, support alert, trusted-contact notification, or an explicitly reviewed additional action. Configuration changes are role-restricted, previewable, auditable and should be testable before publication. The screen accurately distinguishes opening the phone dialer from delivery of a support/trusted-contact alert; no UI promises that emergency services or a human responder answered. Support/SOS delivery attempts and escalations are recorded; operational staffing and local emergency contact details are pending.

HLD-15 stores original chat text and translated versions linked to an authorized trip; translation failure leaves the original readable. After confirmation, the client can initiate an ordinary phone call outside the app under the approved contact/number-exposure window. The precise number visibility and lifetime require owner approval. Support staff only see content necessary to resolve an assigned case, with auditable access to sensitive evidence.

## 5. Failure handling and recovery

| Failure | Intended behavior and limit | Trace |
| --- | --- | --- |
| Delayed/duplicated WebSocket or push | Clients reconcile from API snapshot; offer IDs and server deadlines reject stale responses; no duplicate assignment. The driver may miss a three-second offer in the background. | BR-12–13, BR-17–22, NFR-02, NFR-12 |
| Driver GPS stale, inaccurate, offline, or permission revoked | Exclude from new matching, show stale/unknown rather than live on map, retry after valid heartbeat; preserve ongoing trip truth. | BR-07–08, BR-11, BR-21, NFR-03 |
| Redis outage or evicted location data | Stop or degrade new geo matching instead of guessing nearby drivers; ask drivers to repopulate presence. Existing trips and offers remain in PostgreSQL. | BR-10–13, NFR-02–03 |
| PostgreSQL outage/failover | Do not accept or assign rides from cache alone; show service unavailable/retry safely. Once recovered, workers reconcile deadlines and clients resync. Managed failover may interrupt active operations. | BR-12–22, NFR-07–08 |
| Worker crash during offer expiry or notifications | Durable deadline and outbox rows are picked up by another worker; side effects are idempotent; close old offer before opening next. | BR-12–13, BR-17–18, NFR-07 |
| Maps/translation provider outage | Existing trip status stays accessible; route/ETA or translation show a truthful unavailable state and controlled retry. Original chat remains readable. | BR-11, BR-21–22, BR-32, NFR-02, NFR-07 |
| Support/SOS notification failure | Persist incident and delivery status; alert operations through independent available channels under an approved escalation policy. Do not falsely report successful emergency contact. | BR-33–37, NFR-07 |
| Cash disputed or driver damage claim contested | Preserve reported collection/claim evidence and route to staff; no automatic rider charge or silent balance change. | BR-27, BR-47–49 |

## 6. Security, privacy, and operational controls

**Authorization:** The backend enforces rider/driver ownership of a ride, offer, saved place, message, review, trusted contact, or support case on every request and WebSocket subscription. Admin roles are separate from customer roles; sensitive actions and evidence access are restricted and audited. Admin MFA is an HLD recommendation to confirm with the authentication decision. A driver approval change must invalidate eligibility for future offers immediately.

**Personal information:** Driver documents and case attachments are private objects, never public URLs. Backend-issued short-lived upload/download grants are bound to record/role, validated for content/size, scanned or quarantined according to approved operations, and revoked where practical. Phone numbers are exposed only under the approved confirmed-trip contact policy; a direct external call may reveal caller ID, so hiding the app button later does not retract a disclosed number. Saved places, precise locations, review identities, and SOS trusted contacts need explicit retention/deletion rules. Logs and analytics exclude message text, document bytes, precise address strings, phone numbers, and secrets unless incident access is specifically authorized.

**Trust boundaries:** TLS from apps/admin to edge and encrypted connections to data services; private networking for PostgreSQL/Redis; least-privilege service identities and object access; secrets held outside code; token/session rotation and revocation; bounded OTP/sign-in attempts once the authentication channel is chosen; input validation for locations, prices, upload metadata, messages, and admin configuration. Arbitrary admin-defined SOS actions must be constrained to reviewed registered integrations, not executable scripts or unrestricted URLs. Exact external regulatory requirements and retention periods require Lebanon-specific validation (BRS OD-09/11, NFR-10).

**Configuration changes:** Publish pricing, currency, service areas, vehicle categories, and SOS actions as versioned configurations with maker identity, validation, effective time, rollback path, and audit record. A ride snapshots the rules it agreed under. Existing trips are not reinterpreted when an admin changes currency or kilometre rates. Proposed publication workflow and approvals will be detailed in LLD after the business policy is chosen.

## 7. Runtime and deployment topology (textual HLD; diagrams come later)

| Tier | Proposed placement | Availability and operational note |
| --- | --- | --- |
| Mobile clients | Discrete Flutter rider and driver binaries for supported iOS/Android devices; adaptive tablet layouts. | Offline/reconnect behavior and background location tested on actual devices. Kiosk hardware/flow TBD. |
| Admin client | Responsive Next.js application over HTTPS. | Access restricted to authorized staff; no fake live data. |
| Edge | Managed load balancer and API protection/rate limiting. | Routes HTTP and authenticated WebSocket sessions to healthy app tasks. |
| Backend | At least two stateless NestJS API/WebSocket tasks in separate availability zones; worker tasks separately scaled from the same codebase. | Health/readiness checks, rolling releases, connection drain and reconnect; no sticky ride ownership. |
| Primary database | Managed PostgreSQL with PostGIS, Multi-AZ/standby, encrypted backup and point-in-time recovery where available. | Primary source of truth; size/region and backup objectives TBD. Failover still causes a visible write interruption. |
| Redis | Managed Redis with suitable failover; geo/presence and optional socket fan-out. | Data can be repopulated; no DB-truth fallback to Redis for assignments. |
| File storage | Private encrypted S3-compatible object storage. | Signed uploads and restricted access; retention and scanning policy TBD. |
| Outside services | Map/geocode/route provider, FCM/APNs, translation, SMS/voice where approved. | Provider calls have timeouts, budgets, measured failure behavior, and status visibility. |
| Environments | Separate development, staging, production; infrastructure as code and gated CI/CD. | Public deployment, live payment enablement, and app publication require separate owner authorization. |

AWS ECS/Fargate with managed PostgreSQL and Redis is a candidate, **not a committed vendor or region**. Confirm network latency, Lebanon-related data obligations, service availability and budget before selection. Multi-AZ database deployment provides a standby/failover path but does not promise instantaneous recovery. [AWS RDS Multi-AZ documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html), [ECS availability-zone guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-rebalancing.html).

**WebSocket scaling:** multiple application tasks need a cross-task broadcast mechanism for chat/trip events (Redis adapter or equivalent). Delivery is best effort; durable records and `/current-trip` / `/current-offer` snapshot APIs are the recovery path. Socket.IO's Redis adapter currently does not support its built-in connection-state-recovery feature; Wasselne must not depend on that capability if this adapter is selected. [Socket.IO Redis adapter documentation](https://socket.io/docs/v4/redis-adapter/).

## 8. Quality strategy and release evidence

| Quality concern | HLD control and evidence to require | Parent requirements |
| --- | --- | --- |
| Capacity | Measure hundreds of concurrent drivers/riders under realistic location frequency, websocket sessions, offers and map calls; size by test, not an assumed instance count beyond the HA minimum. Agree latency/error targets before production sizing. | NFR-01, BR-11–13 |
| Three-second sequential rule | Instrument offer created, delivery attempt/ack if chosen, active window start, expiry, accept, next-offer start and rejection reason. Test slow/background phones, push delays, concurrent backend tasks, expiry worker failover, late accept/retry, and no-other-driver reoffer. | BR-12–13, BR-16–18, NFR-12 |
| Live location | Test real Android/iOS background modes, permission revocation, device restarts, weak GPS, battery and loss/recovery of connection. Agree freshness and sampling thresholds. | BR-08, BR-11, BR-21–22, NFR-02–03 |
| Recovery | Perform staging DB failover/restore and Redis flush/restart; measure lost work and recovery. Backups alone are not evidence of a successful restore. | NFR-07–08 |
| Security/privacy | Validate object ownership, unauthorized room subscription, admin roles, saved-place access, phone display rules, expired documents, case evidence, SOS/trusted-contact consent, and log redaction. | NFR-04–05, NFR-09–10 |
| Product breadth | Run full car/motorcycle/tuk-tuk and zone journeys, both fare modes, USD/LBP policy once set, cash, three languages/RTL, reviews both ways, lost property, damage, SOS choices, and responsive screens. | BR-01–49, NFR-06, NFR-11 |
| Observability | Dashboard/alerts for offer deadline and overlap violations, assignment integrity, stale GPS, reconnects, map/translation cost and errors, cash disputes, SOS delivery failures, support backlog and recovery. | NFR-01–03, NFR-07–08, NFR-12 |

For emergency actions, run an end-to-end staffed operational exercise before enabling any alert type. A configured button without a response process does not meet BR-36.

## 9. HLD requirements traceability matrix

This matrix maps **every BRS requirement** to its high-level components. The component catalogue above maps each HLD element back to its parents. LLD element IDs and verification case IDs are intentionally pending until the next approved document; the HLD does not invent completed tests.

| BRS IDs | Implementing HLD elements | HLD evidence or flow | LLD / test IDs |
| --- | --- | --- | --- |
| BR-01–04, NFR-06 | HLD-01–05, HLD-23 | Separate apps/admin; language, RTL, access | Pending |
| BR-05–08 | HLD-02, HLD-03, HLD-05–06, HLD-08, HLD-19–21 | Approval, eligibility and presence | Pending |
| BR-09–11 | HLD-01, HLD-07–10, HLD-13, HLD-19–20 | Coverage, category, route and nearby discovery | Pending |
| BR-12–13, NFR-12 | HLD-02, HLD-09, HLD-14, HLD-19, HLD-22–23 | One offer; three seconds; expiry and reoffer | Pending |
| BR-14–16, BR-24–26 | HLD-01–03, HLD-09–11, HLD-19 | Fare mode, proposal, versioned rate/currency | Pending |
| BR-17–18 | HLD-04, HLD-09–10, HLD-19, HLD-22 | Atomic sole assignment, idempotency | Pending |
| BR-19–23, NFR-02–03 | HLD-01–02, HLD-08–10, HLD-13–14, HLD-19–20 | Trip lifecycle, presence, authoritative reconnect | Pending |
| BR-27–29 | HLD-11–12, HLD-19 | Cash record and disabled method boundary | Pending |
| BR-30–32 | HLD-01–02, HLD-14–15, HLD-19 | Approved phone contact, scoped chat/translation | Pending |
| BR-33–37 | HLD-01–03, HLD-14, HLD-16–17, HLD-19, HLD-22 | Support, configurable SOS and incidents | Pending |
| BR-38–40 | HLD-01–03, HLD-18–19 | Reciprocal review and moderation case | Pending |
| BR-41–44 | HLD-03, HLD-06–07, HLD-11, HLD-17, HLD-19, HLD-23 | Admin controls, settings version, audit | Pending |
| BR-45 | HLD-03, HLD-07, HLD-19 | Staged polygon activation | Pending |
| BR-46 | HLD-01, HLD-07, HLD-13, HLD-19 | Private named saved places | Pending |
| BR-47–49 | HLD-01–03, HLD-16, HLD-19, HLD-21–22 | Lost-property and driver damage cases | Pending |
| NFR-01 | HLD-04, HLD-08–09, HLD-13–14, HLD-20, HLD-23–24 | Load-balanced tasks and measurable load | Pending |
| NFR-04–05 | HLD-01–06, HLD-15–19, HLD-21, HLD-23–24 | Access boundaries, private storage, retention | Pending |
| NFR-07–08 | HLD-09–12, HLD-14, HLD-17, HLD-19, HLD-22–24 | Audit, alerting, durable processing, restore | Pending |
| NFR-09–10 | HLD-03, HLD-05–07, HLD-11, HLD-17, HLD-23–24 | Authorized settings and external legal review | Pending |
| NFR-11 | HLD-01–03, HLD-23 | Adaptive layouts and kiosk policy | Pending |

**Coverage check:** BR-01 through BR-49 and NFR-01 through NFR-12 appear in the matrix. All HLD-01 through HLD-24 components have at least one BRS parent in the component catalogue. This is design traceability, not proof of implementation or test execution.

## 10. Open decisions and approval gate

The BRS open decisions OD-01–OD-15 remain in force. The following are especially consequential to HLD approval and LLD sequencing:

| Priority | Decision | HLD impact |
| --- | --- | --- |
| Critical | **Three-second clock start and device eligibility:** start at server offer creation or after a client delivery acknowledgement? What happens when the app is backgrounded/no ack? | Offer state, timeout and fairness; may invalidate the assumption that every driver sees a full three-second window. |
| Critical | **Driver-proposed fare:** accept within three seconds then propose/await rider, or submit proposed fare inside the three seconds? Define rider decision timeout and reservation policy. | Trip/offer state machine and serial dispatch continuity. |
| High | **Reoffer termination:** maximum new three-second attempts per driver/request and total rider wait. | Prevents an infinite loop when there is only one eligible driver. |
| High | Initial named-area activation, precise zone boundaries, vehicle/document eligibility. | Polygon and onboarding policy. |
| High | USD/LBP pricing policy, detailed tariff, driver proposal bounds, cash/commission reconciliation. | Quote versioning, final fare and financial reporting. |
| High | SOS responder, action channels, call destination, trusted-contact consent; lost-property/damage claims process. | Safety and support staffing and integrations. |
| High | Kiosk user journey/hardware and session security; authentication methods and phone disclosure lifetime. | Client surfaces and access boundaries. |
| High | Quantitative availability/latency, location freshness, recovery and retention targets; Lebanon-specific legal review. | Infrastructure sizing and release gates. |

**Owner review requested:** approve/correct this HLD's component responsibilities, transaction-owned serial dispatch, source-of-truth split, failure behavior, and open decisions. Approval of the HLD authorizes drafting the **LLD only**. It does not authorize coding, deployment, provider contracting, activation of payment methods, or publication. Architecture diagrams remain a later deliverable under the approved sequence.
