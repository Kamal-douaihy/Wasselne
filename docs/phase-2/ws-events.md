# Wasselne — Phase 2.4: WebSocket Events and Push Payloads

**Status:** Draft for owner review (Phase 2). Contract for implementation; not code.
**Companions:** `openapi.yaml`, `02_State_Machines_and_Transactions.md`, `schema.sql`.
No example below is a real fare, phone number, or emergency number.

---

## 1. Transport

- One namespace, `/v1/ws` (Socket.IO is an acceptable implementation; a raw WebSocket with the same
  envelope and room semantics is equally valid).
- **Auth on connect:** the same bearer JWT as the REST API (rider/driver `app` claim, or admin token),
  sent as a connect-time auth payload, not a query string. A missing/expired/revoked token refuses the
  connection with `NOT_AUTHENTICATED`; the client falls back to REST polling.
- **Room membership is server-side and re-checked on every join,** never trusted from the client:
  - `account:{account_id}` — joined automatically on connect; carries `account.blocked`, `config.updated`,
    and push-adjacent events for that account.
  - `ride:{ride_id}` — joined only if the caller is the ride's rider, its assigned driver, or (for admin
    tokens) holds the ride-view permission. A driver who is not the assigned driver, or a rider who is not
    the ride's rider, is refused with `NOT_AUTHORIZED` and not added to the room.
  - `driver:{driver_id}` — the driver's own offer/dispatch channel; joined automatically for a driver
    session while online.
  - `admin:{permission_code}` — one room per admin permission (e.g. `admin:dashboard`, `admin:sos`,
    `admin:live-map`); membership is computed from the admin's roles at connect time, not client-chosen.
- **Delivery is best effort.** Sockets are a convenience channel, not the source of truth. A dropped
  connection loses no state: the server keeps writing to `outbox_events` regardless of who is listening.
- **Reconnect rule (binding):** on every reconnect — and on any event whose `aggregate_version` is not
  exactly one more than what the client already holds — the client MUST call the matching snapshot
  endpoint (`GET /me/active-ride`, `GET /driver/state`, `GET /rides/{id}`, `GET /admin/...` list/detail)
  before trusting further events. Sockets never replay missed events; snapshots are the recovery path
  (state-machine doc §8).
- **State-changing actions never go over the socket.** ACK/accept/decline, ride transitions, and payment
  recording are HTTP calls with `Idempotency-Key`, because idempotent retries need a stored request/response
  pair (`idempotency_keys` table), which a fire-and-forget socket message cannot give. The socket only
  carries the resulting `offer.*` / `ride.*` events.

---

## 2. Common envelope

Every server → client event uses exactly this shape:

```json
{
  "event_id": "uuid",
  "type": "offer.created",
  "aggregate_type": "ride_offer",
  "aggregate_id": "uuid",
  "aggregate_version": 3,
  "occurred_at": "2026-01-01T00:00:00Z",
  "server_now": "2026-01-01T00:00:00.120Z",
  "payload": { "...": "type-specific fields, see §3" }
}
```

- `event_id` — `outbox_events.event_id`; dedupe on this if a resent event is ever observed.
- `aggregate_type` / `aggregate_id` — e.g. `ride`, `ride_offer`, `sos_incident`, `support_case`.
- `aggregate_version` — the aggregate's version *after* this event (`rides.version` for ride events, etc.).
  Absent (`null`) for aggregates that don't carry an optimistic version (e.g. `chat_message`).
- `occurred_at` — when the transaction committed. `server_now` — the server clock at emit time; countdowns
  (e.g. an offer's accept window) are always rebuilt as `deadline_at − server_now`, never from a local timer.

---

## 3. Event catalogue

| `type` | Audience | Trigger (state-machine transition) | Payload fields | Client action |
|---|---|---|---|---|
| `offer.created` | driver (room `driver:{id}`) | dispatcher inserts `ride_offers` PENDING_ACK (§3.2) | `offer_id` (opaque), `fares[]` per currency, `fare_mode`, `pickup_summary` (eta/distance/area), `destination_area`, `trip_distance_m`, `rider_rating_avg`, `ack_deadline_at` | Render the offer card, then call `POST /driver/offers/{id}/ack` — never ACK before it is drawn on screen |
| `offer.active` | driver | `POST .../ack` succeeds (PENDING_ACK → ACTIVE) | `offer_id`, `accept_deadline_at` | Echo/confirm the countdown the ACK response already gave; start the 3 s ring from `accept_deadline_at − server_now` |
| `offer.terminal` | driver | offer reaches ACCEPTED / DECLINED / EXPIRED / CANCELLED | `offer_id`, `state`, `end_reason` | Show the matching DS-10 outcome copy, then return to Waiting after its fixed duration |
| `ride.changed` | rider + driver (room `ride:{id}`) | any ride status transition (§2 table) | `status`, `version`, role-filtered `ride` snapshot (same shape as `GET /rides/{id}`; full address only once the caller is the assigned driver) | Update the active-ride screen; if `version` is not local+1, call the snapshot endpoint |
| `ride.no_driver` | rider | ride SEARCHING → NO_DRIVER | `ride_id`, `search_deadline_at` | Show R-12 "No drivers are available right now" |
| `driver.location` | rider only, only while ride is CONFIRMED / AT_PICKUP / IN_PROGRESS | driver location batch/socket update passes validation | `ride_id`, `lat`, `lng`, `heading`, `captured_at`, `stale` | Move the car icon; if `stale` (older than `PRESENCE_FRESHNESS_S`), grey the icon and hide ETA rather than guess |
| `payment.due` | rider + driver | payment NOT_DUE → DUE | `ride_id`, `fare` (per currency) | Rider: show the pay sheet (R-16). Driver: show the collect-cash banner (DS-13) |
| `payment.recorded` | rider + driver | payment → RECORDED or DISPUTED | `ride_id`, `status`, `recorded` (currency + amount), `tip` | Rider: "Driver recorded X received." Driver: confirm the amount shown |
| `chat.created` | rider + driver (ride room) | `chat_messages` insert | `ChatMessage` shape (id, sender_role, client_message_id, body, source_language, created_at) | Append to the thread; mark own pending message as Sent |
| `chat.translated` | rider + driver | `chat_translations` row reaches DONE/FAILED | `message_id`, `target_language`, `text` or `status: FAILED` | Fill in the translation, or show "Translation unavailable · Retry" |
| `chat.seen` | the *other* party in the ride | `POST .../chat/seen` | `ride_id`, `up_to_message_id` | Mark own messages up to that id as Seen |
| `sos.updated` | reporter + assigned agent (+ `admin:sos` room) | `sos_incidents` status change or `assigned_agent_id` set | `SOSIncident` shape (status, assigned_agent_name, no_agent_fallback, fallback_number, oncall_alert_status) | Update the truthful status line (R-22 / A-22); never render "help is on the way" beyond what `status` says |
| `case.updated` | reporter + assigned admin | `support_cases` status change or new `case_messages` row | `case_id`, `status`, latest message summary | Refresh the case timeline (R-24) |
| `account.blocked` | the blocked account | `account_blocks.effective_at` becomes non-null | `applies_to`, `reason` | Show the blocked-account screen, then the server disconnects the socket |
| `config.updated` | account room (all connected accounts) or broadcast | a platform-settings / category / legal document version publishes | `kind` (`SETTINGS` \| `CATEGORIES` \| `LEGAL`), `effective_at` | Hint only — re-fetch `GET /config/bootstrap` or `GET /legal/current`; never trust an inline payload here as authoritative |
| `admin.dashboard.counts` | `admin:dashboard` | any counted aggregate changes (ride, SOS, case, online session) | `DashboardCounts` shape | Update tiles in place, no reload |
| `admin.sos.queue` | `admin:sos` | `sos_incidents` insert/update | `AdminSOSQueueItem` shape | Update the A-22 queue row (or insert, sorted by wait time) |
| `admin.live_map.update` | `admin:live-map` | a driver/ride marker moves or changes status | `LiveMapDriverMarker` or `LiveMapRideMarker` | Upsert the marker; drop it if `stale` |

Any event type not recognized by a client build is ignored (forward compatible); the client still resyncs
on the next version gap.

---

## 4. Client → server messages

| Message | Purpose | Notes |
|---|---|---|
| `driver.location` | Live location push while online, between HTTP batches | Same validation as `POST /driver/locations` (sequence, freshness, accuracy); rejected updates are acked with `{ accepted: false, reason }` and never silently dropped |
| `chat.typing` | Optional "is typing" indicator | Not persisted; best-effort fan-out to the other ride-room member only |
| `ping` | Liveness / RTT probe | Server replies `pong` with `server_now`; clients may use this to detect a dead socket before the transport layer does |

State-changing actions — offer ACK/accept/decline, ride transitions (arrived/start/no-show/eligibility-
mismatch/end/cancel), and payment recording — are **HTTP only**, exactly as in `openapi.yaml`, because they
carry an `Idempotency-Key` and a stored response; a socket message has no equivalent replay guarantee.

---

## 5. Push notification payloads (FCM / APNs)

Push wakes the app; it never carries enough to act on by itself. Every payload is minimal and holds no
rider/driver name, phone number, address, or fare amount.

| Type | Priority / TTL | Payload fields | App behaviour on receipt |
|---|---|---|---|
| `offer.created` | High priority, short TTL (≈ `DELIVERY_ACK_TIMEOUT_S`) — a late offer push is worthless | `ride_offer_id` | Foreground the app / full-screen alert where the OS allows; render the offer only after `GET /driver/offers/current` confirms it is still `PENDING_ACK`, then ACK |
| `ride.changed` | Normal | `ride_id` | Call `GET /rides/{id}` (or `/driver/state`) and update the matching screen; never render status text taken from the push itself |
| `chat.created` | Normal | `ride_id`, `message_id` | Call the chat list endpoint before showing a notification with message content |
| `sos.updated` | High priority (agent-facing builds only) | `incident_id` | Call `GET .../sos/{id}` before showing status text |

The app always fetches authoritative state before showing anything actionable — the push is a wake-up
signal, not a data source (mirrors the "no invented status" rule in `00_Design_Direction_and_Patterns.md`
and D-17).

---

## 6. Open items

| ID | Item | Proposed default |
|---|---|---|
| `TBD-WS-01` | Exact admin permission → room-name mapping | One room per `admin_roles.permissions` entry actually used by a live screen (dashboard, live-map, sos, rides) |
| `TBD-WS-02` | Socket reconnect backoff schedule | Exponential, capped at 30 s, jittered |
| `TBD-WS-03` | Whether `config.updated` broadcasts to all accounts or only affected zones/apps | Broadcast at launch; scope by zone once zone-scoped rooms exist |
