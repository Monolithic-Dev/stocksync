# StockSync — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| Document status | Draft for build |
| Owner | [your name] |
| Track | AWS First Commit — Ship It |
| Timeline | 10 days, idea to deployed + demoed |
| Version | 1.0 |

---

## 1. Executive Summary

StockSync is a backend inventory-sync engine that lets multiple billing
counters in a small shop (kirana) record sales and restocks independently
— including while offline — and guarantees the shop's stock counts and
item details reconcile to a single, mathematically correct, trustworthy
state the moment connectivity returns. It is proven with a minimal
billing client, **StockSync Counter**, that exists to make the engine's
correctness demonstrable, not to be a sellable point-of-sale product.

---

## 2. Problem Statement

### 2.1 Who has this problem

Small shops in India increasingly run more than one billing point — a
second counter during busy hours, or an owner tracking stock from a
personal phone alongside a counter employee — sharing a single, often
unreliable internet connection.

### 2.2 What happens today without this

- **No offline support:** billing stops or fails during an outage.
- **Naive offline queuing:** both counters queue sales locally, and
  whichever counter's sync lands last silently overwrites the shared
  stock count instead of both sales being reflected — one counter's
  sales are effectively lost from the record.

### 2.3 Cost of not solving it

Wrong stock counts cause real business harm: late reordering because the
system believes stock exists that doesn't, or telling a customer an item
is available when it isn't. For thin-margin small retail, this is a
recurring, compounding cost, not a one-time inconvenience.

### 2.4 Existing Solutions — What's Already Out There

The most important competitor here isn't a hackathon project, but real products in the market:

| Solution | What it actually does | What it doesn't claim |
|---|---|---|
| **Khatabook** | Markets "multi-device sync" and "online/offline mode" directly. | Public material describes a cloud-backed record accessed from multiple devices (the "edit later when online" pattern). Nothing mentions two devices *simultaneously* offline, editing the *same* record, and reconciling gracefully. |
| **OkCredit** | Digital-ledger category, multi-language, reminders. | Same gap — no public claim of concurrent-offline-conflict handling. |
| **CRDTs generally** | The underlying technique is real, used, and well-documented (Figma, Google Docs). | Not applied to retail inventory in anything we found — the *technique* isn't ours, the *application* is. |

Handling "two devices both went offline and both edited the *same* record before either knew about the other" — and proving that both edits survive correctly — is the actual hard distributed-systems problem that sets StockSync apart.

### 2.5 Why this is a distributed-systems problem, not a networking problem

The hard part is not "the connection is unreliable" (retries solve that).
The hard part is: two independent devices changed the same shared number
while neither could see the other's change, and both must reconnect to
exactly one correct, shared truth. This requires a data structure that
can combine independent, order-agnostic changes correctly — which is
precisely what a **CRDT (specifically a PN-Counter)** is designed to
guarantee for count-like data.

---

## 3. Goals and Success Criteria

### 3.1 Product goals (this build)

- G1. Any number of counters can record sales/restocks offline, of any
  duration, and reconcile to a provably correct final stock count.
- G2. Genuinely independent changes (different fields, e.g. price vs
  shelf location) never conflict with each other.
- G3. Genuinely ambiguous changes (same field, different values, both
  offline) are never silently resolved — they are flagged for a human.
- G4. The system is demonstrably reliable under a live, repeated
  conflict scenario — not just correct in theory.
- G5. AWS services are structurally load-bearing to the core guarantees,
  not decorative additions.

### 3.2 Hackathon success criteria (how this maps to judging)

| Judging criterion | How this PRD addresses it |
|---|---|
| Idea and Impact | Section 2 states a real, narrow problem with a concrete cost |
| Built on AWS | Section 6 (Architecture doc) ties each core guarantee to a specific AWS service that cannot be removed without breaking it |
| Learning | Section 12 names specific unfamiliar concepts learned (vector clocks, PN-counters, DynamoDB Streams, WebSocket lifecycle management) |
| Execution | Section 8 (acceptance criteria) and the testing strategy doc define what "working" concretely means, so it can be verified, not just claimed |
| The demo video | See `10-DEMO-PLAN.md` — built directly from the acceptance criteria in this PRD |

---

## 4. Personas

| Persona | Description | What they need from StockSync |
|---|---|---|
| Counter operator | Staff member billing customers at one of the shop's counters | Uninterrupted billing regardless of connectivity; confidence that a sale is recorded even if it hasn't synced yet |
| Shop owner | Owns the shop, may bill from a personal phone alongside staff | Trustworthy, reconciled stock numbers; visibility into any conflict that needs their decision |
| Hackathon judge (the real audience for the demo) | Evaluating against the stated rubric, watching a 3-minute video with no live Q&A | Needs the correctness claim to be provable on screen, and the AWS architecture's necessity to be explained in a sentence, not assumed |

---

## 5. Scope

### 5.1 In scope — the engine (this is the actual project)

- Offline write queueing per client
- Idempotent, deduplicated write intake
- Per-item strict ordering via SQS FIFO
- PN-Counter based stock resolution
- Field-level merge for independent field changes
- Mandatory human review for genuine same-field conflicts
- Atomic, all-or-nothing state + audit updates
- Dead-letter handling for malformed writes
- Live WebSocket push of reconciled state on reconnect
- Full, human-readable audit trail
- Plain-language explanation of a genuine price conflict via Amazon Bedrock
- Voice-based transaction entry in a regional language (Amazon Transcribe + Bedrock)
- Bedrock-driven reorder alerts based on recent sale velocity

### 5.2 In scope — the client (thin, deliberately)

- A screen per counter: item list (2–5 seeded items), sell/restock
  actions, live stock display
- Explicit online/offline toggle (a real, visible control — not just a
  DevTools trick) for a controlled, repeatable demo
- A queue drawer showing unsynced local transactions
- Animated per-transaction sync status
- Attribution badges showing which counter last changed a field
- A conflict-review screen for the needs-review case
- A timeline-style audit log UI (for the "Best UI" claim)
- Client-side Barcode/QR quick-entry for sales (no new AWS service needed)

### 5.3 Explicitly out of scope

- Real point-of-sale features: barcode scanning, receipts, GST invoicing,
  payments, discounts, multi-item carts
- A real product catalog (hundreds of SKUs) — 2–5 seeded items is enough
  to demonstrate every scenario
- User accounts/roles beyond a hardcoded identity per counter
- Multi-shop or franchise support
- Any machine learning or model training — Bedrock is used only as a
  narrow, pre-trained foundation-model API call
- Horizontal scale-testing or load-testing beyond what's needed to
  support a live demo reliably

### 5.4 Stretch scope (only after core scope is fully working and rehearsed)

- A CloudWatch dashboard shown briefly in the demo

---

## 6. Functional Requirements

Each requirement is written to be independently testable.

| ID | Requirement |
|---|---|
| FR-1 | The system SHALL accept a sale or restock transaction from a counter via `POST /transactions`, whether the counter is online or was previously offline. |
| FR-2 | The system SHALL assign each transaction a client-generated idempotency key, and SHALL treat a resubmission of the same key as a no-op that still returns a success response. |
| FR-3 | The system SHALL process all transactions affecting the same inventory item in the exact order they were made by their originating counter, regardless of which counter or how many counters submitted transactions concurrently. |
| FR-4 | The system SHALL model each item's stock count as a PN-Counter, such that the final merged stock count is correct regardless of the order or overlap in which concurrent increments (restocks) and decrements (sales) were made. |
| FR-5 | The system SHALL merge concurrent changes to different fields of the same item (e.g. price and shelf location) without conflict, preserving both changes. |
| FR-6 | The system SHALL detect when two concurrent writes change the same field of the same item to different values, and SHALL NOT automatically resolve this — it SHALL mark the item `needs_review` and preserve both conflicting values. |
| FR-7 | When a `needs_review` conflict is detected on the price field, the system SHALL call Amazon Bedrock to generate a plain-language explanation of the conflict, and SHALL display this alongside both raw values to the resolving user. |
| FR-8 | The system SHALL update an item's live state, its audit trail entry, and its idempotency record as a single atomic operation, such that a failure partway through never leaves these three in an inconsistent state relative to each other. |
| FR-9 | The system SHALL isolate a transaction that cannot be processed (malformed payload, unexpected error) into a dead-letter queue, without blocking the processing of other transactions. |
| FR-10 | The system SHALL push the current, fully-reconciled state of any item that changed while a counter was offline, to that counter, immediately upon reconnection, via WebSocket. |
| FR-11 | The system SHALL maintain a complete, human-readable, append-only audit log of every transaction and every conflict-resolution decision, queryable per item. |
| FR-12 | The client SHALL queue transactions locally (IndexedDB) when offline, and SHALL replay them in the order they were created once connectivity is restored. |
| FR-13 | The client SHALL visibly indicate connectivity state and the number of unsynced queued transactions at all times. |
| FR-14 | The client SHALL display, for each field of an item, which counter most recently changed it. |

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Correctness | The PN-Counter merge result MUST be identical regardless of the order in which concurrent transactions are eventually processed (commutativity) — this MUST be proven with an automated property-based test, not just asserted. |
| Reliability | No single malformed transaction may block the processing queue for any other item or counter. |
| Consistency model | The system provides causal consistency per item (via vector clocks / PN-counter state), not linearizability across the whole store — this MUST be stated explicitly in the architecture doc and understood by anyone extending the system later. |
| Latency | A transaction made while online should be reflected in the live stock display within 2 seconds under normal conditions — this is a demo-quality target, not a production SLA. |
| Auditability | Every state-changing operation must be traceable in the audit log with enough detail to explain, after the fact, exactly why the final state is what it is. |
| Security | All API calls require an API key or equivalent credential; DynamoDB tables and Lambda environment variables containing any secret must not be publicly readable; IAM roles follow least-privilege (each Lambda only has permissions for the specific tables/actions it needs). |
| Cost | The entire system must run within AWS's always-free monthly tier at hackathon-demo scale — no service choice should require paid capacity for the scope defined in Section 5. |
| Observability | Conflict rate, idempotency hit rate, and queue depth must be visible via CloudWatch, even if only checked manually rather than alarmed on, for this build. |

---

## 8. User Stories and Acceptance Criteria

### US-1: Normal online sale
**As** a counter operator, **I want** to record a sale while online **so
that** the stock count updates immediately.

- **Given** Counter A is online and an item has stock of 50
- **When** Counter A sells 5 units
- **Then** the stock count becomes 45 within 2 seconds, and the audit log
  shows one new entry attributed to Counter A

### US-2: Offline sale, later synced
**As** a counter operator, **I want** to keep billing while offline **so
that** connectivity issues don't stop business.

- **Given** Counter A is offline
- **When** Counter A sells 5 units
- **Then** the transaction is queued locally and shown in the queue
  drawer as "Queued," and the local display still reflects the sale
  optimistically
- **When** Counter A reconnects
- **Then** the transaction replays, the queue drawer shows "Reconciled,"
  and the server-side stock count reflects the sale

### US-3: Concurrent offline sales on the same item (the core scenario)
**As** a shop owner, **I want** two counters' offline sales of the same
item to both be reflected **so that** neither counter's sales are lost.

- **Given** an item with stock of 50, and Counters A and B are both
  offline
- **When** Counter A sells 5 then 2 units, and Counter B sells 3 units,
  all while offline
- **When** both counters reconnect, in either order
- **Then** the final stock count is 40 (50 − 5 − 2 − 3), regardless of
  which counter reconnected first
- **And** the audit log shows all three individual sales, correctly
  attributed

### US-4: Independent field changes (field-level merge)
**As** a shop owner, **I want** unrelated concurrent edits to not
conflict **so that** the system doesn't over-flag harmless changes.

- **Given** an item, and Counters A and B are both offline
- **When** Counter A updates the item's shelf location, and Counter B
  updates the item's supplier name
- **When** both reconnect
- **Then** both changes are present in the final item state, with no
  conflict flagged

### US-5: Genuine same-field conflict (the critical case)
**As** a shop owner, **I want** to be asked when the system can't safely
guess **so that** I never get a silently wrong price.

- **Given** an item, and Counters A and B are both offline
- **When** Counter A sets the price to ₹10, and Counter B sets the price
  to ₹12
- **When** both reconnect
- **Then** the item is marked `needs_review`, both values (₹10 and ₹12)
  are preserved and shown, and Bedrock's plain-language explanation is
  displayed
- **And** the stock count (unaffected by this conflict) continues to
  update normally in the meantime

### US-6: Malformed transaction doesn't block the queue
**As** a shop owner, **I want** one bad transaction to not freeze the
whole system **so that** a single bug doesn't stop all billing.

- **Given** a malformed transaction is submitted (e.g. missing required
  field)
- **When** it's processed
- **Then** it is routed to the dead-letter queue, and subsequent valid
  transactions for the same or other items continue processing normally

---

## 9. Feature List (for reference — full detail in the architecture and demo docs)

**Core engine:** offline queueing, idempotent intake, per-item ordering,
PN-Counter resolution, field-level merge, mandatory conflict flagging,
atomic writes, dead-letter handling, live push, full audit trail.

**Standout / differentiating features:** Bedrock price-conflict
assistant, voice-based transaction entry, Bedrock reorder alerts, animated per-transaction sync states, attribution badges,
an explicit in-UI network kill switch for a controlled demo, timeline-style audit log UI, and client-side barcode/QR scanning.

**Stretch:** CloudWatch dashboard shown in-demo.

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A subtle race condition surfaces only under specific timing during the live demo recording | High — the entire pitch is "we handle this correctly" | Property-based tests for PN-counter commutativity; rehearse the exact demo scenario at least 10 times before recording |
| Scope creep into real POS features | Medium — burns build time without improving judging outcomes | Section 5.3 is the explicit reference to check against before adding any feature |
| WebSocket push flakiness (stale connections) | Medium — could visibly break the "live reconnect" demo moment | `ws_connections` table with proper `$connect`/`$disconnect` lifecycle handling (see architecture doc) |
| Team spends too long on UI polish | Medium — trades execution-hardening time for a "nice to have" | Best-UI polish (Section 5.2 items) is timeboxed to Day 8 in the build plan, after the core scenario is solid |
| Bedrock latency or errors during the live demo | Low-medium — could stall the conflict-review screen | The needs-review flag and both raw values are shown immediately regardless of whether Bedrock's explanation has returned yet — Bedrock is additive, never blocking |

---

## 11. Milestones

See `09-BUILD-PLAN.md` for the full day-by-day breakdown. High-level:

- Days 1–2: Infra scaffolding + write intake + idempotency
- Days 3–5: Conflict detection + all three resolution strategies
- Day 6: Thin client with offline queueing
- Day 7: Core conflict scenario rehearsed until reliable
- Day 8: WebSocket push, audit UI, Bedrock integration, UI polish
- Day 9: Hardening, edge-case pass, demo script + dry run
- Day 10: Record, write up, deploy final, submit

---

## 12. What We Expect to Learn (for the "Learning" judging criterion)

- Vector clocks and causal consistency, applied to a concrete problem
  rather than only in the abstract
- CRDTs, specifically PN-Counters, and why they're the mathematically
  correct structure for this exact type of data
- DynamoDB Streams as an event-sourcing mechanism, and DynamoDB
  `TransactWriteItems` for cross-table atomicity
- API Gateway WebSocket connection lifecycle management
- Property-based testing as a technique for proving algebraic properties
  (commutativity/associativity) of merge logic, rather than only
  example-based unit tests

---

## 13. Open Questions and Assumptions

- **Assumption:** a hardcoded identity per counter (e.g. "Counter A,"
  "Counter B") is sufficient for the hackathon; real authentication is
  out of scope.
- **Assumption:** 2–5 seeded inventory items are sufficient to
  demonstrate every scenario in Section 8; a full catalog is not needed.
- **Open question:** should the `needs_review` conflict-resolution
  decision (once a human picks a value) itself be written back through
  the same write-intake pipeline, or via a separate, simpler endpoint?
  Current assumption: a separate, simpler endpoint (`POST
  /conflicts/{id}/resolve`), since it's a single, non-concurrent write by
  definition — see `04-API-SPEC.md`.

### 13.1 Known limitations (Phase 9 edge-case pass — `07-EDGE-CASES.md`)

Deliberately deferred, not silently missing:

- **E-1 (shop-scoped authorization):** the `x-api-key` header is a single,
  shared, hackathon-scoped credential — any holder of it can address any
  `shop_id`. A real product needs per-shop authorization (e.g. a
  Cognito-issued JWT whose `shop_id` claim is checked on every request, as
  already planned for the Tier-2 platform-layer endpoints in
  `04-API-SPEC.md` §5). Out of scope for this single-shop demo build.
- **B-5 (a fourth write to an already-conflicted field):** a second
  concurrent write to a field that's already `needs_review` re-flags
  against the *same original two candidates* rather than accumulating a
  third — see `conflictResolver.ts`'s `finalizeResult` for the code
  comment on this exact scope cut. The edge-case doc's "recommended" full
  behavior (add as a third candidate) is real future work, not an
  oversight.
- **D-3 (50+ WebSocket connections for one shop):** `wsPush.ts` already
  parallelizes pushes via `Promise.allSettled` rather than awaiting each
  connection sequentially, so the stated policy already holds — not
  load-tested at that scale, since it's unrealistic for this demo's
  2-counter scenario.

---

## 14. Platform Vision and Full Feature Set

Everything above (Sections 1–13) describes the sync engine — the part
that must be flawless and is what you're actually judged on. This
section describes the fuller platform built around it, so StockSync
reads as a complete, production-shaped product rather than a single
mechanism with a thin demo wrapper. **See `11-PHASED-SCOPE.md` for
exactly which of these are built for the hackathon versus described as
roadmap** — this section is the full vision; that document is the
execution discipline that keeps the vision from cannibalizing the core.

### 14.1 Full CRUD: the shop's actual data model

Beyond the fixed demo items, StockSync supports real management of:

- **Products** — name, SKU, category, supplier, base price, per-shop
- **Categories** — simple grouping for the product catalog
- **Suppliers** — contact info, typical lead time (used later by the
  reorder-suggestion AI feature)
- **Shops** — a shop is a real entity with an owner, not a hardcoded
  demo constant
- **Users** — owners, managers, and counter staff, authenticated via
  Amazon Cognito, each scoped to the shop(s) they belong to

This turns "Counter A" and "Counter B" from hardcoded demo labels into
real, authenticated users of a real multi-tenant system.

### 14.2 Checkout and orders — an e-commerce-shaped layer, built on the sync engine, not beside it

A counter operator can build a multi-item cart and complete a checkout.
Completing a checkout does not introduce a new, separate write path — it
submits a batch of `sale` transactions through the exact same
`POST /transactions` pipeline described in Sections 2–8, meaning every
correctness guarantee (idempotency, ordering, conflict resolution)
automatically applies to checkout the same way it applies to a single
manual sale. This is the direct answer to "don't just wrap offline sync
around one thin app" — the sync engine is the transaction substrate for
every write in the system, including this new, more realistic checkout
flow.

### 14.3 Analytics

A scheduled daily rollup (EventBridge-triggered Lambda) aggregates the
existing `audit_log` into per-shop, per-item daily sales and revenue
figures, surfaced on an owner-facing dashboard: top-selling items,
revenue trends, and current conflict rate. This reuses data the sync
engine was already producing — no new source of truth is introduced.

### 14.4 Notifications

Low-stock thresholds and unresolved `needs_review` conflicts trigger
owner notifications via SNS/SES (email, and optionally SMS via SNS). A
`notifications_log` table records what was sent and when, for
auditability.

### 14.5 AI features, expanded beyond the price-conflict assistant

- **Natural-language shop queries:** an owner can ask, in plain language,
  "how much did Counter B sell today" or "which items are running low,"
  and Bedrock answers using the shop's actual current data (fetched from
  DynamoDB and passed as context — a lightweight retrieval pattern, not
  a vector database or trained model).

### 14.6 DevOps maturity signals

Separate dev/staging/prod AWS CDK stacks, a CI/CD pipeline gate (tests must
pass before a staging deploy, manual approval before production) using AWS Amplify Hosting for the frontend, and
CloudWatch alarms wired to an SNS ops-alert topic (e.g. non-empty
dead-letter queue triggers an alert). These are cheap to add and are a
strong, low-risk signal of engineering maturity beyond the core
algorithm.

### 14.7 New functional requirements (Tier 2, additive to Section 6)

| ID | Requirement |
|---|---|
| FR-15 | The system SHALL support full CRUD operations on products, categories, suppliers, and shops, scoped per shop. |
| FR-16 | The system SHALL authenticate users via Amazon Cognito and authorize actions based on role (owner, manager, counter staff) and shop membership. |
| FR-17 | A checkout with multiple line items SHALL be submitted as a single batch through the existing `POST /transactions` endpoint, subject to the same idempotency, ordering, and conflict-resolution guarantees as any other transaction. |
| FR-18 | The system SHALL compute and store a daily per-shop, per-item sales and revenue rollup, derived from the existing audit log, without introducing a second source of truth for sales data. |
| FR-19 | The system SHALL send a notification when an item's stock falls below a configurable threshold, or when a conflict remains `needs_review` for longer than a configurable duration. |
| FR-20 | The system SHALL answer natural-language questions about a shop's current data by retrieving the relevant data and passing it as context to Bedrock, never by allowing Bedrock to answer from general knowledge about the shop's specific numbers. |
| FR-21 | The system SHALL support voice-based transaction entry by transcribing speech, parsing it into a structured transaction via Bedrock, and submitting it through the standard transaction pipeline — never as a separate, unvalidated write path. |
