# Wasselne — Phase 1.0: Design Direction and Shared Patterns

**Status:** Draft for owner review (Phase 1). Design only; no application code.
**Applies to:** Wasselne (rider), Wasselne Driver, Wasselne Admin.
**Inputs:** Phase 0 Register rev 6 (approved). No brand assets were supplied, so this document proposes a direction for approval.

Companion files: `design-tokens.json`, `01_Rider_App.md`, `02_Driver_App.md`, `03_Admin_Console.md`.

---

## 1. Design direction (proposed)

**Name meaning.** "Wasselne" (وصّلني) means "take me there". The brand should feel local, dependable, and calm, not flashy.

**Personality.** Trustworthy, direct, warm. Every message says exactly what happened, never more (Phase 0 truthfulness rule).

**Colour.**

| Role | Colour | Use |
|---|---|---|
| Primary "Cedar" | `#0B6E4F` | Main actions, brand, selected states. Contrast 6.3:1 on white. |
| Accent "Taxi amber" | `#F4B400` | Highlights, surge badge, driver "online" chip. Always with dark text. |
| Danger "SOS red" | `#C62828` | SOS only, destructive confirmations. Never decorative. |
| Neutrals | Grey scale in tokens | Surfaces, text, borders. |

Light and dark themes are both defined. The driver app defaults to dark at night to reduce glare while driving.

**Typography.** IBM Plex Sans Arabic for Arabic and IBM Plex Sans for Latin (English, French). Both are open-licence and share proportions, so mixed Arabic/Latin lines (addresses, plate numbers) look consistent. Minimum body size 16 sp on phones. The driver offer screen uses larger sizes (see Driver spec).

**Numerals.** Western digits (0–9) in all three languages, since they are common in Lebanon and match plates, phone numbers, and prices. `TBD-P1-01`: owner may choose Arabic-Indic digits for Arabic.

**Iconography.** One outline icon set (Material Symbols Rounded, open licence), mirrored in RTL where direction matters (arrows, back, send), never mirrored for clocks, media, or checkmarks.

**Logo.** Placeholder wordmark only. A professional logo is `TBD-P1-02`.

---

## 2. Principles

1. **Server truth.** Screens show server state. Timers count to server deadlines. Nothing is shown as confirmed until the server confirms.
2. **Truthful status.** "Sent", "delivered", "agent joined", "dialer opened" are different words for different facts. Never say "help is on the way" or "driver notified" unless the server knows it.
3. **One primary action per screen.** Large, bottom-anchored, reachable with one thumb.
4. **Glanceable for drivers.** Driver screens are read in one or two seconds at arm's length in a moving car.
5. **Works on weak phones and weak networks.** Degrade maps and animations before degrading function.
6. **CMS-driven, not hard-coded.** Categories, prices, currencies, discounts, SOS actions, payment methods, and legal texts come from the server. The apps render whatever is published, including new categories, without an app release.

---

## 3. Languages, RTL, and text

- Languages: Arabic (`ar`, RTL), English (`en`), French (`fr`). Chosen on first launch, changeable in Settings any time, independent of the phone language.
- **Mirroring.** In Arabic the whole layout mirrors: back arrow on the right, lists aligned right, progress bars fill right-to-left, bottom sheets keep the same position. Maps are never mirrored; only map controls move sides.
- **Mixed text.** Phone numbers, plate numbers, prices, promo codes, and times are isolated as left-to-right runs inside Arabic text so they don't scramble.
- **Length.** French strings run about 30% longer than English. Buttons wrap to two lines rather than truncate. No text inside images.
- **Addresses.** Shown as returned by the map provider, in the user's language where available.
- **Admin console:** English only (D-45). User-generated content (names, chat) displays in its original script with correct direction.

## 4. Money display

- Every amount shows its currency: `USD 4.50`, `LBP 400,000`. No bare numbers.
- When both currencies are published (D-19), both appear, with the rider's preferred currency first: `USD 4.50 · LBP 400,000`.
- Discounts show the original price struck through, then the new price, then the reason ("Tuk-tuk 20% off" or promo code).
- Surge shows a badge with the multiplier ("×1.5 busy") before the rider requests.
- Recalculation mode (D-15/D-20) shows "Estimated fare. Final fare can be up to X% higher." The cap comes from the CMS.

## 5. Device classes

| Class | Width | Layout |
|---|---|---|
| Compact phone | < 360 dp | Single column; map shrinks to 40% height on booking; secondary info collapses. |
| Phone | 360–599 dp | Reference design. Map with bottom sheet. |
| Tablet | ≥ 600 dp | Two panes: map plus a 400 dp side panel (start side). Driver tablets assume landscape in a car mount. |
| Admin desktop | ≥ 1024 px | Left navigation, content, detail drawer. Responsive down to 768 px. |

Kiosk is future scope (D-13). Nothing in these layouts blocks adding it later.

**Low-end phones (target: 2 GB RAM, Android 8+).** Minimum OS versions are set in Phase 2. Reduced-motion mode is used automatically when the system requests it. The map uses lite rendering on low-memory devices. Images are compressed before upload.

## 6. Accessibility

- WCAG 2.2 AA contrast for text and controls. Touch targets ≥ 48 × 48 dp. Driver offer buttons are much larger.
- All controls have screen-reader labels in all three languages. The driver offer countdown is announced once at start ("New ride offer, 3 seconds"), not every tick.
- No information by colour alone: surge, errors, and statuses always have text or an icon.
- Text scales to 200% without losing primary actions. The offer screen caps scaling at 130% to keep the Accept button on screen, and the design is tested at that size.
- Haptics and sound accompany critical events (new offer, driver arrived, SOS state change) and respect silent mode except for the driver's offer sound, which the driver controls in Settings.

## 7. Global states (all apps)

Every screen spec must handle these states. Copy below is English reference; translations follow in implementation.

| State | Pattern | Example copy |
|---|---|---|
| Loading | Skeleton blocks, not spinners, for lists and cards. | — |
| Empty | Illustration + one sentence + one action. | "No saved places yet. Add Home or Work to book faster." |
| Offline | Persistent top banner; actions that need the server are disabled with a reason. | "You're offline. We'll reconnect automatically." |
| Reconnecting | Same banner, animated; on success the screen refreshes from the server snapshot. | "Reconnecting…" then "Back online" (2 s). |
| Stale data | Timestamp on live data older than the CMS freshness limit. | "Driver location updated 1 min ago." |
| Server error | Plain explanation + retry; include a short reference code for support. | "We couldn't load your trip. Try again. (Ref 7F3A)" |
| Action unknown | After a timeout on an action, never assume failure or success; re-check state. | "Checking your request…" |
| Blocked account | Full-screen message with support contact (D-34). | "Your account is paused. Contact support to continue." |
| Maintenance / update required | Full-screen with store link. | "Please update Wasselne to continue." |

**Error codes to copy.** Each server error code in the LLD (e.g. `OUTSIDE_SERVICE_AREA`, `OFFER_EXPIRED`) gets one localized message. The table is built in Phase 2 with the API contract.

## 8. Permissions

Always explain before the system prompt, once, with a clear reason and a "Not now" option.

| Permission | Rider | Driver |
|---|---|---|
| Location while using | Asked on first booking. Without it the rider types the pickup. | Required to go online. |
| Background location | Not requested. | Required while online. Android: foreground service with a persistent "You're online" notification. iOS: "Always" with explanation. |
| Notifications | Asked after first ride request ("so we can tell you when your driver arrives"). | Required to receive offers when the app is in the background. |
| Camera / photos | Only when uploading evidence. | Documents, profile photo, monthly vehicle photos. |

If a permission is revoked, the app shows what no longer works and a button to Settings. A driver who loses location permission goes offline with the reason shown.

## 9. Shared components (inventory)

Top app bar · bottom sheet (peek / half / full) · primary button · secondary button · danger button · chip · category card · fare line (with currencies, discount, surge) · address field with saved-place shortcuts · map pin (pickup, destination, driver, stale driver) · status timeline · chat bubble (with translate toggle) · banner (info, warning, offline) · toast · confirmation dialog · document upload tile (empty, uploading, uploaded, rejected, expired) · rating stars · tip selector · SOS button · countdown ring (driver) · list row · empty state · skeleton.

Component details and states are specified where first used in the rider and driver specs.

## 10. Content rules

- Sentence case. Short sentences. Verbs on buttons ("Request ride", not "OK").
- Never blame the user. Never promise times ("Your driver will arrive in 3 min" becomes "About 3 min away").
- Estimates are labelled as estimates (BR-11).
- Safety copy is reviewed by the owner before launch (`TBD-P1-03`).

## 11. Open items raised in Phase 1

| ID | Item | Proposed default |
|---|---|---|
| TBD-P1-01 | Western or Arabic-Indic digits in Arabic | Western |
| TBD-P1-02 | Final logo and brand identity | Placeholder until supplied |
| TBD-P1-03 | Safety and SOS copy review | Owner reviews before launch |
