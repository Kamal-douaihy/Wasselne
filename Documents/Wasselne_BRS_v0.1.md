# Wasselne — Business Requirements Specification (BRS)

**Status:** Draft for owner review; no design approval implied  
**Version:** 0.1, revised draft  
**Document sequence:** BRS → owner approval → HLD → owner approval → LLD → owner approval → architecture diagrams  
**Owner:** Wasselne product owner

## 1. Purpose and source of requirements

This document defines the business needs and the first-release boundaries for Wasselne, a Lebanon-focused on-demand ride platform with a rider app, a driver app, and an administrative operations console. It records requirements expressed by the product owner in this project conversation. Uber, Bolt, Careem, Otaxi, Tasleem, TaxiF, and Yango are experience references, **not** a list of features automatically approved for Wasselne. Competitor research informs questions and workflows but does not create requirements.

Status labels below: **Confirmed** means explicitly requested or previously established and retained by the owner; **Pending detail** means the business intent is confirmed but its policy/amount/operating detail still needs the owner's decision; **Future** means excluded from the first release while preserving a later path.

The proposed Flutter / Next.js / NestJS / PostgreSQL / PostGIS / Redis architecture is a **design baseline for HLD review**, not a business requirement or a claim that any software already exists.

## 2. Agreed product baseline

| Topic | Baseline | Status |
| --- | --- | --- |
| Market | Lebanon, starting in selected cities/areas. Initial candidates named by the owner: Zgharta, Ehden, Batroun, Jbeil, Beirut, Jounieh, Tripoli/Tarablos, Koura, Bcharre, and others added in stages. Exact boundaries and activation order are undecided. | Confirmed staged rollout; pending boundaries/order |
| Surfaces | Separately installable Wasselne rider and Wasselne Driver apps, plus Wasselne Admin web console. | Confirmed |
| Vehicle categories | Car/taxi, motorcycle, and tuk-tuk; availability may depend on configured service areas and driver approval. | Confirmed categories; pending local operating rules |
| First-release booking | Request a ride immediately. | Confirmed |
| Later booking | Scheduled rides are for a future release. | Future |
| Driver model | Mainly independent drivers. | Confirmed |
| Languages | Arabic, English, French; the rider and driver choose their preferred language. | Confirmed |
| Fare currency | USD initially; an authorized admin can change the configured fare currency to LBP. Conversion and display rules need definition. | Confirmed capability; pending rules |
| Fare-setting modes | Admin chooses between platform-configured fare and driver-proposed fare. In platform mode, admin configures amounts/rates, including a per-kilometre rate. | Confirmed modes; pending detailed policy |
| Payments | Cash is the only enabled first-release payment method. OMT, Wish/Whish, and bank are retained as disabled future options until individually approved and integrated. | Confirmed intention; provider naming pending |
| Contact | After a booking has been confirmed with a driver, rider and driver can call each other using the device's ordinary telephone function. | Confirmed; number visibility policy pending |
| In-app communication | Trip-linked chat with translation; retain access to original messages. Both parties can contact support. | Confirmed |
| Safety | SOS is required. Admin configures whether to show one, several, or all of emergency-services contact, Wasselne support alert, and trusted-contact alert, and may configure an additional supported action. | Confirmed; response integration pending |
| Reviews | Rider reviews driver and driver reviews rider after a completed trip. | Confirmed; rating policy pending |
| Saved places | Riders can save, name, edit, and reuse places such as Home, Work, a hospital, or a relative's home. | Confirmed |
| Help after a ride | Riders can seek help for an item left in a vehicle; drivers can report a mess/damage and seek fair review of their claim. | Confirmed; remedies pending |
| Dispatch timing | A ride request has only one active driver offer at a time. A driver gets 3 seconds to accept; an unanswered offer moves to another eligible driver. If none remains, a previous driver may receive a fresh offer window. | Confirmed rule; delivery/timing details pending |
| Device sizes | Experiences must adapt to phones, tablets/pads, and supported kiosk displays; exact kiosk journey and device configuration are undecided. | Confirmed responsiveness; pending kiosk scope |

## 3. Business outcomes

| ID | Desired outcome | Evidence to define or review |
| --- | --- | --- |
| BG-01 | Let people in the configured initial Lebanon cities/areas request and complete a suitable immediate ride. | Completed booking-to-trip journeys for each enabled category/area. |
| BG-02 | Let eligible independent drivers receive work while protecting both sides from duplicate or misleading assignments. | Approved-driver and ride-assignment scenarios pass. |
| BG-03 | Give riders and drivers reliable trip visibility, communication, support during and after rides, and configurable emergency access. | End-to-end trip, reconnect, contact, post-ride help, and SOS scenarios pass. |
| BG-04 | Let operations staff govern vehicle availability, fares, currency, driver approvals, incidents, and service quality. | Authorized admin changes and review workflows are demonstrable and auditable. |
| BG-05 | Launch with cash and preserve a controlled path to other payment methods and later booking options. | Cash trip recorded; disabled methods cannot be selected or charged. |

Numerical service levels, operating hours, coverage, and commercial targets have not been supplied and are **not** invented here.

## 4. People and responsibilities

| Actor | Business responsibility |
| --- | --- |
| Rider | Register/sign in, choose language, request a ride, approve a fare when the active fare mode requires it, follow the trip, communicate, pay cash, seek help, and review the driver. |
| Driver | Register, submit requested documents, wait for approval, go online, receive/accept/decline offers, propose a fare when that mode is enabled, complete trips, receive cash as applicable, seek help, and review the rider. |
| Operations/admin user | Review eligibility, configure service and pricing rules, oversee active trips and support, configure SOS choices, and inspect audit history under assigned permissions. |
| Support responder | Handle trip-linked questions, incidents, and SOS alerts if that action is enabled and staffed. |
| External parties | Mapping, messaging, telephony, emergency services, and later payment providers; the exact provider arrangements remain open. |

## 5. Scope and primary journeys

**First-release scope:** rider and driver registration; driver/vehicle review; staged service activation for selected Lebanon cities/areas; immediate ride requests for enabled categories; rider saved places; location-based discovery and **one-driver-at-a-time, three-second** offers; both fare-setting modes; trip tracking and route display; cash trip handling; post-confirmation telephone contact; chat and translation; rider/driver support including post-ride lost-property and mess/damage cases; configurable SOS; reciprocal post-trip reviews; responsive phone/tablet/kiosk layouts; and the admin functions needed to run these journeys. The three user-selected languages apply to the mobile experience. Whether every admin screen is localized remains a decision.

**Future scope:** scheduled rides and enabling OMT, Wish/Whish, or bank payments after separate business and provider decisions. Disabled future payment methods must not create live payment activity.

**Illustrative end-to-end flow:** a rider selects pickup, destination (possibly from a saved place), and vehicle category; the app displays an available fare or the driver-offer process; exactly one eligible nearby driver receives an offer and has three seconds to accept it; otherwise that offer expires before the request moves to another eligible driver; if no other eligible driver remains, a previous driver may receive a fresh offer. The parties agree under the active pricing mode; the booking becomes confirmed with one driver; both sides see the current trip state and appropriate live locations; both may call, chat, and access support/SOS; the trip is completed and cash handling is recorded; both may review the other or seek post-ride help. Exceptions include no eligible driver, ignored/expired offers, fare proposal declined, cancellation, lost network, stale location, a forgotten item, a mess/damage claim, and an SOS incident. Policies other than the stated three-second driver acceptance window remain to be specified.

## 6. Functional business requirements

**Priority:** M = required for first-release business scope; F = future/disabled. A requirement marked *pending detail* is still an explicit business need, but its values and edge rules must be resolved before the relevant design is approved.

### 6.1 Access, language, and eligibility

| ID | Requirement | Priority / status |
| --- | --- | --- |
| BR-01 | The platform shall provide separate rider and driver mobile experiences and an admin web experience. | M / Confirmed |
| BR-02 | A rider and driver shall be able to register, sign in, and manage their relevant profile; the authentication method is pending selection. | M / Pending detail |
| BR-03 | A mobile user shall be able to select Arabic, English, or French and change that choice later. | M / Confirmed |
| BR-04 | User-facing flows and operational messages shall be usable in the selected language, including Arabic right-to-left presentation where appropriate. | M / Confirmed outcome |
| BR-05 | A driver shall provide required identity, licence/permission, vehicle, and photo/document information for review; the exact Lebanon-specific document list must be agreed before deployment. | M / Pending detail |
| BR-06 | An authorized admin shall approve, reject, suspend, or reinstate driver and vehicle eligibility with an accountable record of the decision. | M / Confirmed outcome |
| BR-07 | Only drivers and vehicles currently eligible for a given category/service area shall receive an offer or appear as available. | M / Confirmed |
| BR-08 | A driver shall be able to go online/offline, and unavailable or stale drivers shall not receive new ride offers. | M / Confirmed |

### 6.2 Finding, agreeing on, and completing a ride

| ID | Requirement | Priority / status |
| --- | --- | --- |
| BR-09 | A rider shall choose pickup, destination, and an available car/taxi, motorcycle, or tuk-tuk category and request an immediate ride. | M / Confirmed |
| BR-10 | The service shall prevent a new request outside currently active coverage or for an unavailable category, and explain the situation to the rider. The initial rollout can activate selected cities/areas before wider Lebanon coverage. | M / Confirmed; boundaries pending |
| BR-11 | The rider shall see nearby eligible vehicle availability and an appropriate route/ETA or availability indication; estimates must not be presented as guarantees. | M / Confirmed outcome |
| BR-12 | For a given ride request, **only one driver shall have an active offer at any moment**. That driver shall have **three seconds** to accept; the next eligible driver must not receive an active offer until the first offer has ended. A driver may decline within the window. | M / Confirmed |
| BR-13 | If a driver declines or does not accept within three seconds, that offer ends and the request moves to another eligible driver. The expired offer cannot subsequently be accepted. If no other eligible driver is available, a driver who previously lost an offer may receive a **new** offer with a new three-second window; the old offer does not reopen. The rider shall be informed if the request cannot be filled. | M / Confirmed rule; exhaustion/retry policy pending |
| BR-14 | An authorized admin shall select which fare-setting mode is active for its defined scope: platform-configured fare or driver-proposed fare. Scope of configuration (global, area, category) is pending. | M / Confirmed modes; pending scope |
| BR-15 | In platform-configured mode, the rider shall see the proposed fare before confirming the request, based on admin-configured fare amounts and rates, including per-kilometre pricing. Other formula components remain pending. | M / Confirmed core; pending formula |
| BR-16 | In driver-proposed mode, the driver shall submit a price and the rider shall see it and explicitly accept or reject it before the agreed booking is confirmed. Only one driver may hold the active offer for a ride at a time. Whether the price is entered within the three-second acceptance window or after the driver accepts, and how long the rider has to decide, require an explicit product decision. | M / Confirmed core; pending timing policy |
| BR-17 | Only one driver shall be assigned to a confirmed ride, and a driver shall not be assigned incompatible simultaneous active rides. Late replies, retries, or network-delayed messages shall not create a second active offer or assignment. | M / Confirmed reliability outcome |
| BR-18 | Repeating a booking or acceptance action because of network failure shall not create a second ride or assignment. | M / Confirmed reliability outcome |
| BR-19 | Rider and driver shall see consistent states for request, offer, confirmation, approach, pickup, ride in progress, completion, and cancellation where applicable. | M / Confirmed outcome; exact transitions pending design |
| BR-20 | Rider and driver shall have access to approved cancellation and no-show flows; fees, reasons, deadlines, and authority to cancel remain pending business policy. | M / Pending detail |
| BR-21 | The rider shall see the assigned driver's appropriate live location and the route/ETA after confirmation; the driver shall see the pickup and destination and an appropriate route. | M / Confirmed |
| BR-22 | Each app shall recover the current authoritative booking/trip state after reconnecting, rather than treating a missed update as a new booking. | M / Confirmed reliability outcome |
| BR-23 | Riders and drivers shall be able to inspect their relevant trip history and trip-specific outcome information. | M / Confirmed outcome |

### 6.3 Currency, payment, and cash record

| ID | Requirement | Priority / status |
| --- | --- | --- |
| BR-24 | An authorized admin shall configure fare amounts and rates, including per-kilometre rates, for the selected platform-fare mode. Effective dates, category/area overrides, base/minimum/time components, and taxes remain pending. | M / Confirmed core; pending details |
| BR-25 | USD shall be the initial fare currency. An authorized admin shall be able to switch the configured fare currency to LBP; the amount shown for an already agreed ride shall remain unambiguous when settings change. | M / Confirmed outcome; conversion policy pending |
| BR-26 | The rider and driver shall see the agreed amount and currency before confirmation and at completion, with a clear explanation if the final payable fare may differ. | M / Confirmed outcome; adjustment rules pending |
| BR-27 | Cash shall be the only enabled first-release payment choice; the platform shall record the reported cash collection and trip/payment outcome for operations and dispute handling. | M / Confirmed; reconciliation detail pending |
| BR-28 | OMT, Wish/Whish, and bank payment choices shall remain disabled until a separately approved provider integration and business process is ready. Disabled choices shall not authorize or collect funds. | F / Confirmed future intent; exact provider pending |
| BR-29 | The platform shall preserve the ability to add future payment methods without redefining the booking and trip business records; this does not require live integrations in the first release. | M / Confirmed readiness goal |

### 6.4 Communication, support, and safety

| ID | Requirement | Priority / status |
| --- | --- | --- |
| BR-30 | After a driver is assigned and the booking is confirmed, rider and driver shall be able to place ordinary phone calls to each other outside the app. Number-display and access-expiry rules require approval. | M / Confirmed ability; pending privacy policy |
| BR-31 | Rider and driver shall be able to exchange trip-related in-app messages during the allowed contact window. | M / Confirmed; window pending |
| BR-32 | Each party shall be able to read the original chat message and an available translation into their chosen language, with failed translation clearly indicated. | M / Confirmed outcome |
| BR-33 | Rider and driver shall be able to contact support easily and associate a request with the relevant booking/trip when one exists. | M / Confirmed |
| BR-34 | Both mobile apps shall make an SOS entry point available at the appropriate stage of a ride. The exact pre/post-trip visibility policy is pending. | M / Confirmed |
| BR-35 | An authorized admin shall configure which SOS choices users can see: emergency-services contact, alert Wasselne support, notify a trusted contact, any combination of these, or an additional supported option. | M / Confirmed |
| BR-36 | An SOS choice shall state clearly what action it will take; the service shall record relevant incidents and notify responders where the selected action supports notification. A phone call alone must not be represented as proof that help arrived. | M / Confirmed safety outcome; response policy pending |
| BR-37 | Where trusted-contact notification is enabled, users shall be able to manage the contact and understand what trip/location information will be shared. Delivery method and consent process remain pending. | M if enabled / Pending detail |

### 6.5 Reciprocal reviews and administration

| ID | Requirement | Priority / status |
| --- | --- | --- |
| BR-38 | After a completed ride, a rider shall be able to review the assigned driver and the driver shall be able to review that rider. | M / Confirmed |
| BR-39 | A review shall be linked to an actual completed trip and its author; the system shall prevent duplicate reviews of the same direction for one trip. Rating scale, written feedback, editing, visibility, and moderation are pending. | M / Confirmed integrity outcome; pending policy |
| BR-40 | An authorized admin shall be able to see relevant trip and review records and handle a complaint about a review under defined permissions; moderation authority and appeals policy remain pending. | M / Pending detail |
| BR-41 | Admin shall manage service areas, vehicle categories, driver/vehicle approvals, applicable pricing mode/rates, fare currency, and SOS choices through controlled settings. | M / Confirmed |
| BR-42 | Admin and support users shall have permissions appropriate to their jobs, and sensitive actions and configuration changes shall be attributable to an actor and time. | M / Confirmed outcome |
| BR-43 | Authorized staff shall be able to view relevant active and historic trips, handle support cases and SOS alerts, and inspect an auditable action history. | M / Confirmed outcome |
| BR-44 | Material setting changes shall have a recorded effective version so that a confirmed ride remains interpretable under the rules agreed for that ride. | M / Confirmed consistency outcome |
| BR-45 | Admin shall be able to activate, deactivate, and extend individual Lebanon service areas in stages; the first candidates include Zgharta, Ehden, Batroun, Jbeil, Beirut, Jounieh, Tripoli/Tarablos, Koura, and Bcharre. Named places are rollout candidates, not yet approved map boundaries or a mandatory launch date for each. | M / Confirmed staged rollout; pending boundaries |
| BR-46 | A rider shall be able to save multiple named places, select one as pickup or destination on a later ride, and edit or delete it. Names may be personal, such as Home, Work, Hospital, or Mama's Home. | M / Confirmed |
| BR-47 | After a trip, a rider shall be able to report an item left in the vehicle and request assistance contacting the driver or recovering the item through support. | M / Confirmed; contact/recovery policy pending |
| BR-48 | After a trip, a driver shall be able to report a significant mess or damage in the vehicle and ask support to review evidence and protect the driver's rights. Reporting shall not automatically impose a charge or penalty on the rider before an approved policy and review process exist. | M / Confirmed core; remedy policy pending |
| BR-49 | Authorized support staff shall be able to track post-trip lost-item and mess/damage cases linked to the ride, collect appropriate statements and evidence, communicate case status to affected parties, and record a reasoned resolution. Evidence rules and remedies require owner approval. | M / Confirmed outcome; pending case policy |

## 7. Business quality and protection requirements

These state outcomes; numerical targets and specific technologies belong in the HLD after business approval.

| ID | Requirement | Status |
| --- | --- | --- |
| NFR-01 | The platform shall remain usable at the intended initial scale of hundreds of concurrent users and drivers, subject to a measured workload and agreed service targets. | Confirmed scale; targets pending |
| NFR-02 | The platform shall tolerate intermittent mobile connectivity and recover the correct ride state when users reconnect. | Confirmed |
| NFR-03 | Stale, inaccurate, or unavailable driver location shall not be presented as current or used to issue misleading offers. | Confirmed outcome |
| NFR-04 | Access to live locations, phone numbers, chat, documents, reviews, support cases, and SOS data shall be limited to authorized roles and appropriate trip stages. | Confirmed outcome; detailed retention pending |
| NFR-05 | Driver documents and personal data shall be protected and retained only as required by an approved retention policy. | Confirmed outcome; policy pending |
| NFR-06 | First-release flows shall support Arabic, English, and French with user language selection and usable Arabic right-to-left layouts. | Confirmed |
| NFR-07 | Operationally important failures (dispatch, location, cash recording, translation, support, SOS delivery) shall be detectable and investigated from a secure audit trail. | Confirmed outcome |
| NFR-08 | Critical trip, setting, and cash records shall be recoverable after a failure under agreed backup and recovery targets. | Confirmed outcome; targets pending |
| NFR-09 | Administrative changes to eligibility, pricing, currency, and SOS configuration shall be authenticated, authorized, and auditable. | Confirmed |
| NFR-10 | Public launch shall follow review of Lebanon-specific transport, safety, consumer, privacy, tax, and payment obligations by appropriate local advisers and operators. This document makes no claim that a particular licence or process is already secured. | Pending external validation |
| NFR-11 | Rider, driver, and admin experiences shall adapt to supported phone, tablet/pad, and kiosk screen sizes without losing essential actions, legibility, accessibility, or session privacy. The supported kiosk operating model must be selected before its acceptance test is finalized. | Confirmed responsiveness; kiosk scope pending |
| NFR-12 | The three-second driver-offer rule shall be evaluated on real phones and variable mobile networks. The platform shall clearly show when an offer has expired; any change to the business window requires owner approval. | Confirmed rule; test conditions pending |

## 8. Key business acceptance scenarios

| Scenario | Expected business outcome | Requirements |
| --- | --- | --- |
| Language selection | Rider and driver switch among Arabic, English, French; the ride journey remains understandable in the chosen language. | BR-03–04, NFR-06 |
| Driver approval | Unapproved/suspended driver cannot receive a new offer; approved driver in an enabled category/area can become available. | BR-05–08 |
| Platform fare | Admin-selected platform mode shows the configured amount/currency before a rider confirms. | BR-14–15, BR-24–26 |
| Driver proposal | Admin-selected driver-proposal mode presents the offered price to the rider and requires acceptance before booking confirmation. | BR-14, BR-16, BR-26 |
| Sequential driver offers | Driver A alone receives a request; after three seconds without acceptance, A's offer ends before driver B receives one. A late acceptance fails. If there is no other driver, A may receive a fresh offer, with no overlap. | BR-12–13, BR-17–18, NFR-12 |
| Lost connection | After reconnecting, the rider/driver sees the existing ride state and does not accidentally create another ride. | BR-18–22, NFR-02 |
| Contact and cash | Once confirmed, calling is available; at completion cash is the enabled payment method and its reported collection is recorded. | BR-27–31 |
| SOS configuration | Admin enables one or several SOS choices; the apps show exactly those choices and make the selected action clear. | BR-34–37, NFR-09 |
| Reciprocal reviews | Each participant can review the other after completion, once per trip per direction. | BR-38–40 |
| Admin settings change | Updated fare/currency/SOS settings affect the intended subsequent rides without rewriting an already agreed ride. | BR-24–26, BR-35, BR-41–44 |
| Future payment disabled | OMT, Wish/Whish, and bank remain unavailable for collection until separately enabled and integrated. | BR-28–29 |
| Staged city launch | Admin enables an initial area; requests in that area work and requests outside active coverage clearly explain unavailability. | BR-10, BR-45 |
| Saved place | Rider saves Home and Mama's Home, reuses one in a later request, edits one, and deletes one. | BR-46 |
| Help after a ride | Rider opens a lost-item case; driver opens a separate mess/damage case with evidence; support tracks each to a reasoned resolution without an automatic rider charge. | BR-33, BR-47–49 |
| Responsive devices | Essential rider, driver, and admin journeys remain usable at representative supported phone, tablet, and kiosk sizes, subject to the approved kiosk flow. | NFR-11 |

## 9. Open decisions required before HLD is approved

| ID | Decision to make | Why it matters |
| --- | --- | --- |
| OD-01 | Confirm the activation order and exact boundaries for the initial staged rollout among Zgharta, Ehden, Batroun, Jbeil, Beirut, Jounieh, Tripoli/Tarablos, Koura, Bcharre, and any other areas. Confirm that the owner's “eden,” “baton,” and “tarablos” mean Ehden, Batroun, and Tripoli respectively; these are proposed name normalizations, not silent product decisions. | Availability, maps, operations, and driver onboarding. |
| OD-02 | Confirm exactly which car/taxi, motorcycle, and tuk-tuk classes and local driver/vehicle documents are eligible. | Approval and category availability. |
| OD-03 | Define the platform fare formula and configured amounts: base fare, kilometre rate, time/waiting, minimum, changes during a ride, cancellation/no-show, and rounding. | Quote, settlement, and disputes. |
| OD-04 | Define driver-proposal rules: simultaneous proposals, bid expiry, ability to counter, permitted bounds, and when the ride becomes confirmed. | Rider choice and dispatch integrity. |
| OD-05 | Define USD/LBP switch and conversion policy, including whether an admin enters an exchange rate or separate currency tariffs, and which currency cash is collected in. | Price consistency and cash records. |
| OD-06 | Decide whether Wasselne takes a commission on cash trips, its calculation, and collection/settlement process. | Driver obligations and financial reconciliation. |
| OD-07 | Confirm whether “Wish” means **Whish Money** and define what “bank” will mean before those methods are activated. | Future integration scope. |
| OD-08 | Set phone-number disclosure and expiry policy after confirmation and the allowed chat window. | Privacy and safety. |
| OD-09 | Define who operates support and responds to SOS, supported emergency contact mechanism, trusted-contact notification channel, and permitted custom actions. | An SOS control must have a real response path. |
| OD-10 | Define review format, visibility, moderation, and dispute/appeal process. | Fairness and trust. |
| OD-11 | Select authentication approach, measurable response/availability targets, retention periods, backup/recovery goals, and admin language scope. | HLD quality and operational choices. |
| OD-12 | Decide how a driver enters a proposed fare while the driver has only three seconds to accept an offer, and how long the rider has to accept that price before the request can move on. | Both confirmed business rules must coexist without overlapping driver offers. |
| OD-13 | Define the maximum reoffer attempts and rider wait time when there is no other eligible driver; specify when the rider sees “no driver available.” | Avoid indefinite three-second offer loops. |
| OD-14 | Confirm the kiosk use case (public rider booking, staffed booking, or other), supported hardware/OS and session privacy/identity rules. | Responsiveness and safe completion of kiosk journeys. |
| OD-15 | Set lost-property contact/return procedure, driver mess/damage evidence rules, claim deadline, disputes/appeals, and any approved remedy or charge policy. | Fair, actionable help after a ride. |

These are **open decisions, not silent default values**. The BRS may be approved as a requirements baseline with these decisions tracked; the HLD must not assert resolved policies for them until the owner answers.

## 10. Requirements traceability matrix — BRS baseline

At BRS stage there are no approved HLD/LLD elements to map. Each approved HLD component and LLD design element will receive an identifier and cite the relevant BR/NFR IDs in this matrix. “Pending” is deliberate and will be replaced during the corresponding approved document stage. No design element should appear without at least one parent requirement, and no approved first-release requirement should lack a design and verification link by release readiness.

| Requirement IDs | Business goal(s) | BRS acceptance evidence | HLD element | LLD element | Verification |
| --- | --- | --- | --- | --- | --- |
| BR-01–04, NFR-06 | BG-01, BG-03 | Language selection | Pending | Pending | Pending |
| BR-05–08 | BG-02, BG-04 | Driver approval | Pending | Pending | Pending |
| BR-09–13 | BG-01, BG-02 | Request/offer and unavailable cases | Pending | Pending | Pending |
| BR-14–16, BR-24–26 | BG-01, BG-04 | Platform fare, driver proposal, settings change | Pending | Pending | Pending |
| BR-17–23, NFR-02–03 | BG-01, BG-02, BG-03 | Competing responses, reconnect, completed ride | Pending | Pending | Pending |
| BR-27–29 | BG-05 | Contact/cash and future-payment-disabled scenarios | Pending | Pending | Pending |
| BR-30–33 | BG-03 | Contact and translated chat/support journey | Pending | Pending | Pending |
| BR-34–37 | BG-03, BG-04 | SOS configuration and incident response | Pending | Pending | Pending |
| BR-38–40 | BG-03, BG-04 | Reciprocal reviews | Pending | Pending | Pending |
| BR-41–44 | BG-04 | Admin settings change and audit | Pending | Pending | Pending |
| BR-45 | BG-01, BG-04 | Staged city launch | Pending | Pending | Pending |
| BR-46 | BG-01 | Saved place | Pending | Pending | Pending |
| BR-47–49 | BG-03, BG-04 | Help after a ride | Pending | Pending | Pending |
| NFR-01, NFR-07–08, NFR-12 | BG-01–05 | Measured load, three-second offers, incident and recovery evidence | Pending | Pending | Pending |
| NFR-04–05, NFR-09–10 | BG-02–04 | Access/privacy review and local validation | Pending | Pending | Pending |
| NFR-11 | BG-01–04 | Responsive device journeys | Pending | Pending | Pending |

**Completeness check:** BR-01 through BR-49 and NFR-01 through NFR-12 each appear in at least one row. The requirements-to-design mapping will be expanded to individual element IDs once HLD and LLD exist.

## 11. Reference material and approval gate

Examples of comparable journeys were reviewed from public, provider-owned materials: [Uber rider safety](https://www.uber.com/ae/en/ride/safety/), [Bolt Lebanon driver-document overview](https://bolt.eu/en/support/articles/4406002031762/), [Yango rider safety](https://yango.com/en_int/lp/safety/latam/rider/), [TaxiF service overview](https://www.taxif.com/en), [Uber reciprocal ratings](https://help.uber.com/riders/article/understanding-ratings?nodeId=fa1eb77f-ad79-4607-9651-72b932be30b7), and [Careem reciprocal ratings](https://help.careem.com/hc/en-us/articles/1500011064241-Why-can-Captains-rate-me). The proposed standardized spellings of Lebanese places were checked against the [Lebanese Directorate General of Local Administrations and Councils municipality list](https://www.dglac.gov.lb/en/municipalities) and still require owner confirmation for intended coverage. These references do not supersede the owner's requirements.

**Owner review requested:** confirm/correct the first-release scope, the strict sequential three-second dispatch rule, staged areas, saved places, post-trip help, device coverage, both fare-setting modes, cash and disabled-payment behavior, review policy direction, and the listed open decisions. After BRS approval, proceed to the **HLD only**. No HLD, LLD, or architecture diagram is approved or authored by this BRS.
