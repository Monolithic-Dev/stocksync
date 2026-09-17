# StockSync — System Architecture

This document is the technical source of truth. If code and this
document disagree, update whichever one is wrong immediately — don't let
them drift.

---

## 1. Architecture Goals

1. Every core correctness guarantee (Section 2 of the PRD's functional
   requirements) must map to a specific AWS mechanism that would visibly
   break if removed — this is what "built on AWS" means at an
   architectural level, not just "uses some AWS services."
2. The conflict-resolution logic must be implementable and testable as
   plain, framework-free TypeScript, independent of AWS — see
   `06-FOLDER-STRUCTURE.md` for why this matters as much as the AWS
   design itself.
3. Nothing in this design should require paid AWS capacity at
   hackathon-demo scale.

### 1.1 Design Patterns Used

This architecture explicitly implements several recognized distributed systems patterns to solve the concurrent-offline problem:
- **Conflict-free Replicated Data Type (CRDT)**: Specifically a PN-Counter for stock counts to ensure commutativity.
- **Vector Clocks**: For causal conflict detection on non-additive fields like price.
- **Idempotent Consumer**: Deduping retried writes via `write_dedup` and client-generated idempotency keys.
- **Event-Driven Architecture**: Decoupling write intake from conflict resolution using SQS FIFO.
- **Graceful Degradation**: If Bedrock fails or times out, the system falls back to a raw conflict flag without blocking the core workflow.

---

## 2. High-Level Diagram

```
                         CLIENT LAYER
     ┌───────────────────────────────────────────────────┐
     │        StockSync Counter (React web client)         │
     │        (Hosted on AWS Amplify)                      │
     │  - IndexedDB offline write queue                    │
     │  - Connectivity toggle + queue drawer                │
     │  - Live stock display + attribution badges           │
     └────────────┬──────────────────────────▲─────────────┘
                  │ HTTPS (POST /transactions) │ WSS (live push)
                  ▼                            │
     ┌───────────────────────────────────────────────────┐
     │                Amazon API Gateway                   │
     │           (REST ingress + WebSocket push)           │
     └────────────┬──────────────────────────▲─────────────┘
                  ▼                            │
     ┌─────────────────────────────┐          │
     │ Lambda: write-intake          │         │
     │ - validates payload           │          │
     │ - checks write_dedup table    │          │
     └────────────┬────────────────┘          │
                  │ enqueue                    │
                  ▼                            │
     ┌─────────────────────────────┐          │
     │ SQS FIFO queue                │          │
     │ MessageGroupId = record_id    │          │
     │ + Dead-Letter Queue attached   │         │
     └────────────┬────────────────┘          │
                  ▼                            │
     ┌─────────────────────────────┐          │
     │ Lambda: conflict-resolver     │          │
     │ (imports packages/core for     │         │
     │  all merge logic — see 06)     │         │
     │ - reads current record state   │          │
     │ - compares vector clocks        │         │
     │ - applies PN-counter merge /    │          │
     │   field-merge / flag-for-review │         │
     │ - TransactWriteItems: record +  │         │
     │   audit_log + write_dedup        │        │
     │ - calls Bedrock for price        │        │
     │   conflicts needing explanation  │        │
     │ - pushes result over WebSocket   │        │
     └────────────┬────────────────┘          │
                  │                             │
                  ▼                            ▲
     ┌───────────────────────────────────────────┐
     │                Amazon DynamoDB              │
     │  inventory_records / write_dedup /          │
     │  audit_log / ws_connections                 │
     │  (full schema in 03-DATABASE-SCHEMA.md)     │
     └───────────────────────────────────────────┘
```

---

## 3. Component Responsibilities

### 3.1 StockSync Counter (client)

Responsible for: capturing user actions (sell/restock), queueing them
locally when offline, replaying them in order on reconnect, rendering
live state, and surfacing conflicts for human resolution. Contains no
merge logic itself — it displays what the server tells it and applies
straightforward optimistic local updates while offline. Hosted on **AWS Amplify** for fast, edge-optimized delivery.

### 3.2 API Gateway

REST API for `POST /transactions`, `GET /sync`, `GET /audit/{item_id}`,
`POST /conflicts/{id}/resolve`. WebSocket API for `$connect`,
`$disconnect`, and pushing `record_updated` / `needs_review` events.

### 3.3 Lambda: write-intake

The only component allowed to write to `write_dedup` on the "first seen"
path. Validates the payload shape, checks for a duplicate idempotency
key, and if new, enqueues to SQS. Returns immediately — this Lambda does
not wait for resolution, keeping the client's perceived latency low.

### 3.4 SQS FIFO queue (grouped by `record_id`)

Guarantees strict, sequential processing of every transaction touching a
given inventory item, regardless of which counter sent it or how many
counters are concurrently active. This is the mechanism that makes
FR-3 in the PRD true. A Dead-Letter Queue is attached so a message that
fails processing repeatedly (see edge cases doc) is set aside instead of
blocking everything behind it.

### 3.5 Lambda: conflict-resolver

The core of the system. Reads the item's current state (including its
vector clock and PN-counter internals), determines whether the incoming
write is a clean apply or a genuine concurrent conflict, and applies the
correct strategy. All of the actual decision logic is imported from
`packages/core` (see folder structure doc) rather than written inline —
this Lambda is a thin AWS-specific wrapper around portable business
logic. Writes the result, the audit entry, and the dedup confirmation
atomically via `TransactWriteItems`. If a price conflict needs human
review, additionally calls Bedrock (non-blocking to the core write) to
generate an explanation, then pushes the result to all connected
WebSocket clients registered for that item/shop.

### 3.6 DynamoDB

Four tables, detailed fully in `03-DATABASE-SCHEMA.md`:
`inventory_records`, `write_dedup`, `audit_log`, `ws_connections`.

### 3.7 Amazon Bedrock

Called exactly once per genuine same-field conflict, with a small,
tightly-scoped prompt (see `04-API-SPEC.md` for the exact
request/response shape used internally). Never on the critical path for
correctness — the conflict is flagged and both values are shown
regardless of whether this call succeeds, times out, or is skipped.

### 3.8 Amazon Transcribe

Used for the voice-based transaction entry feature. Converts a short audio clip (Hindi/Tamil) from the client into text before Bedrock parses it into a structured transaction payload.

### 3.9 CloudWatch

Custom metrics: `ConflictRate`, `IdempotencyHitRate`, `QueueDepth`,
`ResolutionLatency`. A simple dashboard assembled from these for the
demo's brief "we thought about operability" beat.

---

## 4. Detailed Data Flows

### 4.1 Normal online sale (happy path)

1. Client sends `POST /transactions` with one transaction.
2. Write-intake Lambda checks `write_dedup` — not found, proceeds.
3. Enqueues to SQS FIFO (`MessageGroupId = record_id`).
4. Conflict-resolver Lambda picks it up, sees the incoming vector clock
   dominates the stored one cleanly (no concurrent writer), applies
   directly.
5. `TransactWriteItems` updates `inventory_records`, `audit_log`,
   `write_dedup` together.
6. Result pushed over WebSocket to any connected client watching this
   item (including the sender, for consistency of the live display).

### 4.2 Offline queue and reconnect (single counter, no conflict)

1. Client detects offline state (via `navigator.onLine` and/or a failed
   request), routes new transactions to the local IndexedDB queue
   instead of the network.
2. On reconnect, client calls `POST /transactions` with the full queued
   batch, in the order they were created.
3. Server processes each in order (SQS FIFO preserves this since they
   share a `MessageGroupId`), all clean applies since no other counter
   touched this item concurrently.
4. Client's queue drawer transitions each entry from `Queued` to
   `Replaying` to `Reconciled` as responses arrive.

### 4.3 Concurrent conflict across counters (the core scenario)

Detailed with real numbers in `01-PRD.md` US-3. Mechanically: both
counters' queued writes eventually funnel into the same SQS FIFO
message group (the shared `record_id`), so even though they originated
from different clients at different times, the conflict-resolver
processes them one at a time, comparing each incoming write's vector
clock against the current stored state, and merges each via the
PN-counter's simple, order-independent addition.

### 4.4 Same-field conflict with Bedrock assist

1. Conflict-resolver detects two concurrent writes to the same field
   (e.g. `price`) with different values.
2. Marks `conflict_status: needs_review`, stores both candidate values
   in `inventory_records`.
3. Writes an `audit_log` entry documenting the conflict.
4. Asynchronously invokes Bedrock with both values and their context
   (who set them, when, and the exact `overlap_seconds` calculated using the `client_timestamp` to show "how concurrent was this really") to generate a context-aware, plain-language
   explanation.
5. Pushes a `needs_review` WebSocket event to connected clients,
   including the explanation once available (or without it, if Bedrock
   hasn't returned yet — the UI does not block on this).
6. A human resolves via `POST /conflicts/{id}/resolve`, which is a
   simple, non-concurrent write (only one person can resolve a given
   flagged conflict) directly updating `inventory_records` and appending
   a final `audit_log` entry.

### 4.5 WebSocket connection lifecycle

1. `$connect`: client connects with its counter/shop identity; Lambda
   writes a row to `ws_connections` (connection ID, shop ID, item
   subscriptions).
2. On any resolution event, the conflict-resolver looks up all
   `ws_connections` rows for the relevant shop and attempts to push to
   each.
3. If a push fails with a stale-connection error (the client
   disconnected without a clean `$disconnect`), the corresponding row is
   deleted from `ws_connections` — this prevents repeated failed pushes
   to dead connections from accumulating.
4. `$disconnect`: Lambda removes the connection's row directly.

---

## 5. The Conflict Resolution Algorithm

### 5.1 Vector clocks

Each item carries `vector_clock: { [counter_id]: sequence_number }`.
Comparing an incoming write's clock (`V_in`) to the stored clock
(`V_cur`):

- **Dominates:** every entry in `V_in` ≥ the corresponding entry in
  `V_cur`, with at least one strictly greater → apply cleanly.
- **Concurrent:** neither dominates → genuine conflict, apply the
  relevant resolution strategy below.

### 5.2 PN-Counter for stock

Stock is not stored as a single overwritable number. It's derived from
two internal grow-only counters:

```
stock = base_stock + total_increments - total_decrements
```

Each counter (`total_increments`, `total_decrements`) is itself a map of
`{ counter_id: cumulative_amount }`, so merging two counters' updates is
just taking the max of each counter's own contribution (since each
counter's own sequence is already ordered by the FIFO queue) and summing
across counters. This is what makes the merge **commutative and
associative** — provable with a property-based test, see
`08-TESTING-STRATEGY.md`.

### 5.3 Field-level merge

Each field independently tracks `field_last_writer` and its own
"version" implicitly via the overall vector clock comparison. If two
concurrent writes touch disjoint field sets, both are applied — this
requires no special data structure, just checking field-set overlap
before deciding a real conflict exists.

### 5.4 Escalation for genuine same-field conflicts

If the overlapping field set is non-empty and the values differ, this is
the one case with no safe automatic resolution. The system always
chooses to flag rather than guess — see PRD FR-6, this is a hard
requirement, not a fallback behavior to optimize away later.

---

## 6. Consistency Model (be explicit about this)

StockSync provides **per-item causal consistency**, not global
linearizability across the whole shop's inventory. This means:

- All writes to the *same* item are strictly ordered and causally
  consistent (thanks to per-item FIFO + vector clocks).
- Writes to *different* items have no ordering guarantee relative to
  each other — this is intentional and correct, since two different
  items' stock counts have no real relationship to reconcile.

Stating this explicitly matters — it's the difference between a design
that looks accidental and one that reads as a deliberate, understood
trade-off, which is exactly what separates a senior-level design
document from an ad hoc one.

---

## 7. Security

- All API requests require an API key (hackathon-appropriate; a real
  product would use Cognito, noted as a natural next step but out of
  scope per the PRD).
- Each Lambda's IAM role is scoped to only the specific DynamoDB tables
  and SQS queue it needs — the write-intake Lambda cannot write directly
  to `inventory_records`, for instance, only to `write_dedup` and SQS.
- DynamoDB tables use encryption at rest (default AWS-managed keys are
  sufficient for this scope).
- No secrets (API keys, Bedrock credentials) are stored in client-side
  code; all Bedrock calls happen server-side, inside the
  conflict-resolver Lambda.

---

## 8. Scalability and Cost

At hackathon-demo scale (a handful of counters, a few hundred
transactions), every service used sits inside AWS's always-free monthly
allowances (Lambda, DynamoDB, SQS, API Gateway all have generous free
tiers). Bedrock is pay-per-token but called only on the rare
same-field-conflict path, so expect negligible cost even with heavy
rehearsal.

If this were extended toward production: DynamoDB's on-demand capacity
mode already scales automatically per-partition; the main scaling
question would become SQS FIFO throughput per message group (3,000
messages/second per group with batching), which is far beyond what any
single item's transaction rate would need in a real shop.

---

## 9. Failure Modes and Recovery

| Failure | Behavior |
|---|---|
| Client sends the same write twice (retry after timeout) | Deduped via idempotency key; second attempt returns the cached prior result, no double-count |
| Conflict-resolver Lambda crashes mid-execution | SQS re-delivers the message after the visibility timeout; resolution logic is designed to be safely re-run (idempotent at the resolution level, not just the intake level) |
| A malformed transaction is submitted | Routed to the Dead-Letter Queue after exhausting retries, does not block other messages in the queue |
| WebSocket push to a disconnected client | Stale connection row is cleaned up from `ws_connections`, does not retry indefinitely |
| Bedrock call fails or times out | The conflict is still flagged and both raw values are still shown; the explanation field is simply absent or shown as "unavailable" |
| Two counters reconnect at literally the same instant | SQS FIFO's per-group sequential processing means one is still fully resolved before the other begins — there is no true simultaneous processing of the same item, by design |

---

## 10. Platform Layer (Tier 2 — see `11-PHASED-SCOPE.md`)

Everything above is the engine. This section describes what's built
around it. The guiding constraint carried over from Section 1: nothing
here should require paid AWS capacity at demo scale, and nothing here
should introduce a second path for writing transaction data — checkout,
voice entry, and any future write path all still terminate at
`POST /transactions`.

### 10.1 Authentication and multi-tenancy

**Amazon Cognito User Pool** issues JWTs for owners, managers, and
counter staff. API Gateway's Cognito authorizer validates the token on
every request (replacing the hackathon-simple API-key auth described in
Section 7 for these new endpoints). Each user's token carries their
`shop_id` and `role` as custom claims, which Lambda handlers use to scope
every query — a manager at Shop A can never read or write Shop B's data,
enforced at the handler level, not just the UI level.

### 10.2 CRUD Lambdas

A small, uniform set of handlers (`productsCrud.ts`, `categoriesCrud.ts`,
`suppliersCrud.ts`, `shopsCrud.ts`, `usersCrud.ts`) backing standard
REST resource endpoints. These are intentionally simple — direct
DynamoDB reads/writes with authorization checks, no business logic
resembling the conflict-resolution engine, because none of this data is
subject to concurrent-offline-edit conflicts the way live inventory
counts are (a supplier's contact info being edited by two people at
once is a real but low-stakes case, handled with simple last-write-wins,
explicitly — not every write in the system needs CRDT-level rigor, and
saying so explicitly is itself good engineering judgment).

### 10.3 Checkout flow

The client assembles a cart (multiple product/quantity pairs), and on
checkout submits them as one `POST /transactions` call with multiple
`sale`-type entries sharing a single `order_id` for grouping in the
audit trail and analytics. No new Lambda is needed for the core write —
only a thin `checkoutSummary.ts` handler that groups the resulting
`write_dedup`/`audit_log` entries by `order_id` for the receipt view.

### 10.4 Analytics pipeline

An **EventBridge Scheduler** rule triggers a `dailyRollup.ts` Lambda once
per day (and can be triggered manually for demo purposes). It queries
each shop's `audit_log` for the prior day, aggregates sales/revenue per
item, and writes the result to a `daily_analytics` table (see
`03-DATABASE-SCHEMA.md` Section 8). The dashboard reads only from this
rollup table, never scanning the full audit log live — this keeps
dashboard reads fast and cheap regardless of audit log size.

### 10.5 Notifications

A `notificationCheck.ts` Lambda, also EventBridge-scheduled (or
triggered directly from the conflict-resolver for the immediate
"conflict needs review" case), checks stock levels against each
product's configured threshold and checks for stale `needs_review`
conflicts, publishing to an **SNS topic** subscribed by SES for email
delivery. Every notification sent is logged to `notifications_log` for
auditability.

### 10.6 AI assistant (natural-language shop queries)

A `askAssistant.ts` Lambda receives a natural-language question,
performs a small set of predetermined DynamoDB queries based on
detected intent (e.g. "today's sales" → query `daily_analytics` for
today; "low stock" → query `inventory_records` filtered by threshold),
and passes the retrieved data plus the original question to Bedrock as
context, instructing it to answer only from the provided data. This is
deliberately **not** a general-purpose agent with open-ended tool access
— constraining it to a small, known set of retrieval functions keeps
answers grounded and avoids the complexity (and risk) of a fully
autonomous agent for a 10-day build.

### 10.7 AI reorder suggestions

A `reorderSuggestions.ts` Lambda (callable on-demand from the dashboard)
reads a product's recent daily sales velocity from `daily_analytics` and
its supplier's lead time from the `suppliers` table, and asks Bedrock to
reason over these numbers to suggest a reorder quantity and rough
timing, explained in plain language. This is explicitly framed to the
user as an LLM-assisted suggestion, not a statistically trained
forecast, both because that's technically accurate and because it keeps
the project's "no heavy ML" constraint honest.

### 10.8 Voice-based transaction entry

Client records a short audio clip, uploaded to a `voiceTransaction.ts`
Lambda which calls **Amazon Transcribe** (synchronous, short-audio mode
is sufficient at this scale), passes the resulting text to Bedrock with
a prompt constraining it to output a structured transaction matching the
`POST /transactions` schema exactly, then submits that structured result
through the standard transaction pipeline — reusing all of Sections 3–9
unchanged.

### 10.9 Multi-environment deployment

The infrastructure is defined using **AWS CDK** (TypeScript) — see
`05-TECH-STACK.md` Section 3 for why CDK over SAM/Terraform for this
project. The `StocksyncStack` is parameterized by an environment context
(`dev`, `staging`, `prod`) passed as construct props, each getting its
own isolated set of the core tables, API Gateway stage, and Cognito User
Pool. GitHub Actions deploys to `staging` automatically on merge to
`main`, and to `prod` only after a manual approval gate — a standard,
low-effort pattern that reads as real engineering process rather than a
single-environment hackathon script. The client application is
independently deployed via **AWS Amplify Hosting**.
