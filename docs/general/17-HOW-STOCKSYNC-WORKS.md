# How StockSync Works — What We're Building, How, and Which AWS Services Do What

This is the "explain it to me from zero" document. It covers what the
project is, how a single sale travels through the system, and — for every
AWS service in the stack — what it is, what we use it for, why we chose it
over the alternatives, and what would break without it.

Everything here describes the code that actually exists in this repo.
Where something is planned but not built, or built but not yet deployed to
real AWS, that is stated explicitly.

---

## 1. What we are building

**StockSync is an offline-first inventory sync engine for small shops
(kirana stores) that run more than one billing counter.**

The problem: two counters share one flaky internet connection. If the
connection drops and both counters keep selling the same item, the naive
approach (each counter pushes its own copy of "stock = N" when it
reconnects) lets whichever counter syncs *last* silently overwrite the
other's sales. One counter's sales vanish from the record, stock counts are
wrong, and the owner finds out too late.

StockSync guarantees that when both counters reconnect — in any order,
after any length of time offline — the shop ends up with **one correct,
shared stock count where every sale is counted exactly once**.

Example (the demo scenario, used throughout the docs):

- Item "Parle-G" starts at stock **50**.
- Counter A and Counter B both go offline.
- Counter A sells 5, then 2. Counter B sells 3.
- Both reconnect (A first, or B first — doesn't matter).
- Final stock is **40** (50 − 5 − 2 − 3). Both counters see 40. The audit
  log shows all three sales, attributed to the right counter.

We ship a deliberately thin client, **StockSync Counter**, only to make
that guarantee visible on screen. The product is the sync engine underneath.

---

## 2. The core ideas (in plain language)

### 2.1 Stock is not a number — it's two counters

If stock were one overwritable number, "A sets 45, B sets 47" has no right
answer. Instead we store stock as a **PN-Counter** (a kind of CRDT —
Conflict-free Replicated Data Type):

```
stock = base_stock + (sum of all restocks) − (sum of all sales)
```

Restocks go into an `increments` map and sales into a `decrements` map,
each keyed by counter (`{ counter_a: 7, counter_b: 3 }`). Merging two
counters' updates is just addition, so the result is the same regardless
of the order updates arrive in. That property (commutative and
associative) is proven in `packages/core/tests/pnCounter.property.test.ts`
with property-based tests that throw random operation orderings at the
merge function.

### 2.2 Vector clocks decide "conflict or not"

Every item carries a **vector clock**: `{ counter_a: 2, counter_b: 1 }`,
meaning "the server has seen 2 operations from A and 1 from B". When a
write arrives with its own clock, we compare:

- Incoming clock has seen everything the stored one has (plus more) → it
  **cleanly follows** the current state. Apply it.
- Neither has seen the other's changes → they are **concurrent**. Now we
  need a strategy.

### 2.3 Three strategies for concurrent writes

| What was written | Strategy | Result |
|---|---|---|
| Stock changes (sales/restocks) | PN-Counter merge | Always safe, both apply |
| Different fields (A edits price, B edits shelf location) | Field-level merge | Both apply, no conflict |
| **Same field, different values** (A: ₹10, B: ₹12) | **Flag `needs_review`** | We never guess. Both values are preserved and a human picks |

The system never silently resolves a genuine disagreement. That is a hard
requirement, not a fallback.

### 2.4 Idempotency — retries are safe

Every transaction carries a client-generated **idempotency key**. If the
same key arrives twice (network retry, double click, client resubmit after
a dropped response), the second one is recognised and ignored. A sale is
never counted twice.

### 2.5 Per-item ordering

All writes touching the same item are processed **one at a time, in
order**, regardless of which counter sent them. Different items are
processed in parallel. This is what makes "no two writes race on the same
item" true, and it is the job of the SQS FIFO queue (Section 4).

### 2.6 AI is advisory, never the decider

When two prices conflict, Amazon Bedrock writes a plain-language
explanation ("both counters changed this price about five minutes apart
while offline — likely two people updating it independently"). It never
picks a value. If Bedrock is slow or down, the conflict is still flagged
and both raw values are still shown.

---

## 3. How one sale travels through the system

```
 Counter (React app)                                       AWS
 ┌──────────────────────┐
 │ 1. Operator clicks   │
 │    "Sell 1"          │
 │ 2. Optimistic update │
 │    on screen         │
 │ 3. Online?           │
 │    yes → POST        │ ──► API Gateway (HTTP API)
 │    no  → save to     │            │
 │          IndexedDB   │            ▼
 │          queue       │     Lambda: write-intake
 └──────────────────────┘     4. validate payload (positive qty, batch ≤100)
        ▲                     5. check write_dedup table: seen this key?
        │                          yes → return "duplicate", stop
        │                          no  → record key as "queued"
        │                     6. send to SQS FIFO queue
        │                          MessageGroupId = item_id
        │                                   │
        │                                   ▼
        │                     Lambda: conflict-resolver (triggered by SQS)
        │                     7. read current item from inventory_records
        │                     8. call resolve() from packages/core
        │                          → clean apply / merged / needs_review
        │                     9. ONE atomic TransactWriteItems:
        │                          • update inventory_records
        │                          • append audit_log entry
        │                          • mark write_dedup as applied
        │                    10. push result to all connected counters
        │                          (WebSocket, via ws_connections table)
        │                    11. if price conflict: ask Bedrock for an
        │                          explanation, store it, push again
        │                                   │
        └───────────── WebSocket push ◄─────┘
   12. Screen updates to the server's authoritative state
```

Key design points in that flow:

- **Step 4–6 return immediately.** write-intake does not wait for
  resolution, so the counter feels fast. The response only says `queued` or
  `duplicate`; the real outcome arrives via WebSocket push or the next
  `GET /sync`.
- **Step 9 is atomic.** Record, audit entry, and idempotency status update
  together or not at all. A crash mid-way can never leave the stock updated
  with no audit trail.
- **Offline path:** when the counter is offline, step 3 stores the
  transaction (with its idempotency key) in IndexedDB. On reconnect the
  client replays the queue in creation order as one batch. If a request
  was sent but the response was lost, the replay reuses the *same* key, so
  the server dedups it.

### 3.1 Worked example with real numbers

Item starts: `base_stock = 50`, `vector_clock = {}`.

1. A (offline) sells 5 → clock `{a:1}`; sells 2 → `{a:2}`.
2. B (offline) sells 3 → clock `{b:1}`.
3. A reconnects first. Its two writes arrive in order; each cleanly
   follows the stored clock. `decrements = {a: 7}`, stock 43, clock `{a:2}`.
4. B reconnects. Its clock `{b:1}` hasn't seen `{a:2}` and vice versa —
   concurrent. It's a stock change, so PN-Counter merge applies:
   `decrements = {a:7, b:3}`, stock **40**, clock `{a:2, b:1}`.
5. If B had reconnected first, the same final numbers result.

---

## 4. The AWS services — what, why, and what breaks without it

The whole backend is **serverless**: no servers to run or patch, and
everything scales to zero cost when idle. All of it is defined as code with
AWS CDK in `infra/cdk`.

### 4.1 AWS Lambda — the compute

**What it is:** runs a function in response to an event, billed per
millisecond, no server to manage.

**What we use it for (11 functions, Node.js 22, TypeScript):**

| Function | Triggered by | Job |
|---|---|---|
| `writeIntake` | `POST /transactions` | Validate, dedup, enqueue |
| `conflictResolver` | SQS queue | Run the merge logic, atomic commit, push, Bedrock |
| `syncQuery` | `GET /sync` | Return current state of every item |
| `auditQuery` | `GET /audit/{item_id}` | Return an item's full history |
| `conflictResolve` | `POST /conflicts/{id}/resolve` | Human picks a value for a flagged conflict |
| `wsConnect` / `wsDisconnect` | WebSocket `$connect` / `$disconnect` | Track live connections |
| `productsCrud`, `categoriesCrud`, `suppliersCrud` | `/products`, `/categories`, `/suppliers` | Catalog CRUD |
| `checkout` | `POST /checkout` | Multi-item cart → batch of sales through write-intake |

**Why Lambda, not containers/EC2/ECS:** traffic is bursty and tiny (a few
counters); API Gateway already does the routing, so there's no long-lived
process to justify a framework or a cluster; and it sits inside the AWS
always-free tier at this scale.

**Design note:** the Lambdas are thin. All decision logic lives in
`packages/core` — plain TypeScript with **no AWS dependency** — so it can be
tested in milliseconds with property-based tests and no cloud resources.
Each Lambda only marshals data in and out.

### 4.2 Amazon DynamoDB — the database

**What it is:** a managed key-value/document database with single-digit
millisecond reads and writes, on-demand billing (no capacity planning).

**What we use it for (8 tables):**

| Table | Purpose |
|---|---|
| `inventory_records` | Live state of each item: stock (PN-counter internals), price, shelf location, expiry, vector clock, conflict status. Has a GSI `ShopConflictIndex` for "all items for a shop" |
| `write_dedup` | Idempotency keys already seen (auto-expires after 7 days via DynamoDB TTL) |
| `audit_log` | Append-only history of every transaction and conflict decision, sorted by time |
| `ws_connections` | Which WebSocket connections are live, per shop (GSI by shop) |
| `products`, `categories`, `suppliers` | Tier 2 catalog (last-write-wins) |
| `orders` | Checkout receipts/summaries (never a second source of truth for stock) |

**Why DynamoDB, not Postgres/RDS:** our access patterns are few and known
in advance (get an item, check a key, append an event, list by shop);
on-demand capacity needs zero tuning; and it gives us **`TransactWriteItems`**
— multi-table atomic writes — which is the mechanism behind the
"record + audit + idempotency commit together" guarantee.

**What breaks without it:** there's nowhere to keep item state, and the
atomicity guarantee disappears.

**Note:** DynamoDB Streams is enabled on `inventory_records` (the CDK table
definition turns it on) but no consumer reads it today; the resolver is
driven by SQS, not Streams. It's available for future event-driven
extensions.

### 4.3 Amazon SQS FIFO — ordering and back-pressure

**What it is:** a managed message queue. The FIFO variant guarantees
ordering *within a message group* and supports deduplication.

**What we use it for:** the write queue between write-intake and the
resolver. Two settings matter:

- **`MessageGroupId = item_id`** (never the counter id). All writes to one
  item are delivered strictly one at a time, in order, even if ten counters
  send them at once. Grouping by *sender* instead is a bug this project hit
  once in an earlier design: two counters editing the same item raced in
  parallel Lambda invocations.
- **`MessageDeduplicationId` = the client's idempotency key**, with
  content-based dedup deliberately *off*. Two genuinely separate "sell 1"
  actions look identical by content and must not be merged by SQS.

**Dead-letter queue (DLQ):** a second FIFO queue. A message that fails
processing 5 times is moved there instead of blocking the queue behind it —
so one malformed transaction can never freeze billing for other items.

**Why SQS and not "call the resolver directly":** without the queue there
is no per-item ordering guarantee, no retry-on-crash, and no isolation of
poison messages. Remove SQS and the core correctness claim breaks.

### 4.4 Amazon API Gateway — REST and WebSocket front door

**What it is:** a managed HTTP/WebSocket entry point that routes requests
to Lambdas.

**We use two APIs:**

- **HTTP API (REST):** `POST /transactions`, `GET /sync`, `GET /audit/{item_id}`,
  `POST /conflicts/{item_id}/resolve`, the CRUD routes, and `POST /checkout`.
- **WebSocket API:** the client opens one long-lived connection; the server
  can push `record_updated` / `needs_review` messages the moment a write
  resolves, so a counter that just reconnected sees the reconciled state
  immediately instead of polling.

**Connection lifecycle:** `$connect` writes a row to `ws_connections`;
`$disconnect` deletes it. If a push fails because the client vanished
without a clean disconnect (browser crash), the resolver catches the "gone"
error, deletes the stale row, and carries on pushing to the others — one
dead connection never aborts the rest.

**Why not client-side polling:** push is cheaper and gives an instant
"you're back, here's what changed" moment.

### 4.5 Amazon Bedrock — the plain-language explanation

**What it is:** managed access to foundation models through one API, with
no model hosting or training.

**What we use it for:** exactly one narrow thing — when two counters set
different **prices**, the conflict-resolver calls Claude 3 Haiku
(`anthropic.claude-3-haiku-20240307-v1:0`) with both values, who set them,
and roughly how long they were both offline, and asks for a 1–2 sentence
plain-language explanation shown next to the raw values.

**Guardrails (all enforced in code and tests):**

- Runs **after** the conflict is already flagged, committed, and pushed —
  never on the correctness path.
- 4-second timeout; any failure returns "no explanation" and the UI shows
  both raw values regardless.
- Advisory only: the UI never offers the explanation as a selectable
  answer. A human always picks.
- IAM is scoped to `bedrock:InvokeModel` on that single model, not `*`.

**Why Bedrock, not SageMaker/a trained model:** there's no training data
and none is needed; a pre-trained model behind one API call is the only
model-touching feature the design allows.

**One manual step:** Bedrock requires you to request access to the model in
the AWS console (Bedrock → Model access) before the first call works. Do
this before `cdk deploy`.

### 4.6 Amazon CloudWatch — operating it

**What it is:** metrics, logs, dashboards.

**What we use it for:** custom metrics `ConflictRate` (emitted by the
resolver on every `needs_review`) and `IdempotencyHitRate` (emitted by
write-intake on every duplicate), plus SQS queue depth and DLQ depth on a
dashboard (the `Observability` construct). A non-empty DLQ is the leading
indicator of a malformed-input bug. All handlers log structured JSON via
Lambda Powertools with the item/transaction id attached, so a write can be
traced across intake → queue → resolver → push.

### 4.7 AWS IAM — least privilege

Every Lambda gets only the permissions it needs, granted per table by CDK.
Examples: write-intake can touch `write_dedup` and send to SQS but
**cannot** write `inventory_records`; the resolver can read/write the
record, append (not read) audit entries, and read (not write) connections.
There are no wildcard resources on DynamoDB or SQS actions; a CDK test
asserts this.

### 4.8 AWS CDK / CloudFormation — infrastructure as code

The entire stack (tables, queues, Lambdas, APIs, dashboard, IAM) is
TypeScript in `infra/cdk`. `cdk deploy` synthesizes CloudFormation and
creates ~99 resources; `cdk synth` shows the plan without touching AWS.
Same language as the app, so types are shared and there's no separate
templating layer.

### 4.9 AWS Amplify Hosting — the frontend (separate deploy)

Hosts the React app (`apps/web`). It is **not** part of `cdk deploy`. After
the CDK deploy you copy its two output URLs (`HttpApiUrl`, `WebSocketUrl`)
into Amplify's environment variables as `VITE_API_BASE_URL` and
`VITE_WEBSOCKET_URL`. Get these wrong and the app builds fine but can't
reach the backend — it just looks blank.

### 4.10 Services we deliberately do NOT use (yet)

Cognito (auth), SNS/SES (notifications), Transcribe (voice entry),
EventBridge (scheduled analytics), Rekognition (shelf photos). These are
roadmap items named in the README's "Where this goes next" — described,
not built.

---

## 5. The client (StockSync Counter)

React 18 + Vite + Tailwind, TypeScript. It has **no merge logic** — it
displays what the server says.

- **Offline queue:** IndexedDB (via `idb`). Survives tab close; resumes on
  reload.
- **Real online/offline toggle** in the UI (not a DevTools trick) so the
  demo is controlled and repeatable.
- **Optimistic updates:** a sale shows immediately marked "(pending)", and
  is overwritten by the server's authoritative state when it arrives. It is
  allowed even if local stock looks too low — the local view may be stale.
- **Queue drawer:** Queued → Replaying → Reconciled per transaction.
- **Attribution badges:** which counter last changed each field.
- **Conflict review panel:** both raw values, overlap time, the Bedrock
  explanation (or "Generating explanation…"), and a pick-one action.
- **Audit timeline** with an expandable "Why?" showing the vector clocks
  compared and a plain-language decision.
- **Extras:** barcode/QR scan (pre-fills an action), expiry-date tracking,
  Products and Checkout pages (`?page=products|checkout`).
- **Never trusts its own clock for logic:** ordering is decided only by
  vector clocks; client timestamps are for display and the advisory
  "how long were they offline" figure.

---

## 6. Tier 2: catalog and checkout

Products, categories, suppliers, and orders are **plain last-write-wins**
data, deliberately *not* run through the CRDT machinery — a supplier's
phone number isn't live, concurrently-edited state. That's a conscious
choice: not every write needs CRDT-level rigor.

**Checkout** is the important part: it does *not* introduce a second write
path. `POST /checkout` turns each cart line into a standard `sale`
transaction and calls the real write-intake handler in-process, so every
checkout gets the same idempotency, ordering, and conflict guarantees as a
manual sale. Idempotency keys are deterministic
(`checkout:<order_id>:<product_id>`), so retrying a dropped checkout never
double-sells. The `order_id` is carried into each audit entry so a cart's
line items are grouped in the trail.

---

## 7. What happens when things go wrong

| Failure | Behaviour |
|---|---|
| Client retries the same write | Deduped by idempotency key; no double count |
| Resolver Lambda crashes mid-run | SQS redelivers; the dedup status check makes reprocessing safe |
| Malformed message | Retried up to 5 times, then moved to the DLQ; other items unaffected |
| Two counters reconnect at the same instant | Same item → processed strictly one after the other |
| WebSocket client vanished uncleanly | Stale connection row deleted; others still receive the push |
| Bedrock slow/failing | Conflict still flagged; explanation simply absent |
| Stock would go negative | Written as-is and flagged `stock_anomaly` (not clamped to 0 — clamping would hide a real discrepancy) |
| Client clock is wrong | Irrelevant to ordering; only vector clocks decide |

**Consistency model, stated plainly:** per-item causal consistency. Writes
to the *same* item are strictly ordered; writes to *different* items have no
ordering relationship, by design — two different items' stock counts have
nothing to reconcile.

---

## 8. Cost

At demo scale everything except Bedrock sits inside AWS's always-free
allowances (Lambda, DynamoDB on-demand, SQS, API Gateway, CloudWatch basics).
Bedrock is pay-per-token but is called only on price conflicts, so cost is
negligible — though heavy rehearsal is worth a glance at the bill. Set a
budget alarm (~$20) on day one. The classic accidental cost trap is a NAT
Gateway; this stack has no VPC and never needs one.

---

## 9. Local development vs. real AWS

- **Local (no AWS needed):** `apps/api/src/local/server.ts` runs the *real*
  Lambda handlers behind Express, with DynamoDB Local, an in-memory
  per-item FIFO standing in for SQS, and a `ws` server standing in for API
  Gateway WebSocket. Only the transport is swapped; zero business logic is
  reimplemented.
- **Real AWS:** `cdk deploy` creates everything. Copy `.env.example` →
  `.env.local`, fill in the CDK outputs, and `npm run seed:demo` populates
  the real tables.
- Local validation is not the same as proven on AWS: real DynamoDB/SQS
  timing, IAM boundaries, and cold starts only show up after a real deploy.
  Rehearse the demo scenario against the deployed stack before recording.

---

## 9.1 Honest limitations

- **No real auth.** `x-api-key` is sent by the client but not enforced
  server-side; CORS is open. There is no per-shop authorization
  (edge case E-1, a stated known limitation).
- **A second conflicting write on an already-flagged field** re-flags
  against the original two candidates rather than accumulating a third
  (edge case B-5, a deliberate scope cut).
- **`overlap_seconds` is approximate** — derived from client clocks, which
  can be wrong. It is advisory context for the explanation, never used by
  the resolver.
- **Nothing is deployed to real AWS yet** as of this writing.

---

## 10. Glossary

- **CRDT:** a data structure whose concurrent updates merge without
  conflicts.
- **PN-Counter:** a CRDT counter built from two grow-only counters
  (increments, decrements) so it can go up and down.
- **Vector clock:** per-client counters used to tell whether one write has
  seen another.
- **Idempotency key:** a client-generated id that makes retries safe.
- **FIFO / message group:** queue ordering guaranteed per group.
- **DLQ:** dead-letter queue, where repeatedly failing messages go.
- **TransactWriteItems:** DynamoDB's all-or-nothing multi-item write.
- **Serverless:** managed services that scale to zero and bill per use.
- **IaC:** infrastructure defined as code (here, AWS CDK).
