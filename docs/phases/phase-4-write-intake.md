# Phase 4: Write Intake & Ordering Pipeline

## Header

**Goal:** `POST /transactions` is live behind API Gateway, deduplicates retried writes correctly, and enqueues new writes onto the SQS FIFO queue grouped by the affected item — not the sending counter.

**Preconditions:** Phase 2 complete (`packages/core` types available to import). Phase 3 complete (`write_dedup` table and write queue deployed).

**Implements:** `04-API-SPEC.md` §1 (`POST /transactions`), `01-PRD.md` FR-1/FR-2/FR-3, `02-ARCHITECTURE.md` §3.3/§4.1, `07-EDGE-CASES.md` A-1 through A-5 (concurrency/ordering) and E-2/E-3 (batch size, signed quantity).

---

## Task Breakdown

1. **`apps/api/src/lib/dynamo.ts`** — thin AWS SDK v3 client setup: `DynamoDBClient` wrapped in `DynamoDBDocumentClient.from(...)`, exported once and reused (not re-instantiated per invocation).

2. **`apps/api/src/lib/logger.ts`** — `Logger` from `@aws-lambda-powertools/logger`, `serviceName: "write-intake"`.

3. **`apps/api/src/handlers/writeIntake.ts`**:
   - Parse and validate the request body against the `04-API-SPEC.md` §1 shape: `shop_id`, `counter_id`, `transactions[]` where each entry has `idempotency_key`, `item_id`, `type` (`sale`/`restock`/`field_update`), and either `quantity` (sale/restock) or `field`+`value` (field_update).
   - **Validation, inline, not deferred:** reject with `400 invalid_payload` if `idempotency_key` or `item_id` is missing on any entry; reject if `type` is `sale`/`restock` and `quantity` isn't a positive number (edge case E-3 — the client never sends a signed quantity, `type` determines sign); cap batch size at 100 transactions per request, `400` if exceeded (edge case E-2).
   - For each transaction: check `write_dedup` by `idempotency_key` (`GetCommand`). If found, return the `cached_response` verbatim — **do not re-process** (this is what makes retries safe).
   - If not found: write a `queued` row to `write_dedup` with a 7-day `ttl`, then `SendMessageCommand` to the write queue with `MessageGroupId: transaction.item_id` (never `counter_id` — this is the fix for the exact race condition documented in `senior-architect`'s "already caught" list) and `MessageDeduplicationId: transaction.idempotency_key`.
   - Return `200` with per-transaction `{ idempotency_key, status: "queued" | "duplicate" }`.

4. **`infra/cdk/lib/constructs/SyncEngine.ts`** (extend from Phase 3):
   - Add the `writeIntakeFn` (`NodejsFunction`, entry `apps/api/src/handlers/writeIntake.ts`).
   - `writeDedupTable.grantReadWriteData(writeIntakeFn)` and `queue.grantSendMessages(writeIntakeFn)` — **and nothing else**. This function must not be able to touch `inventory_records` or `audit_log` directly (least-privilege, per `aws-solution-architect`).

5. **`infra/cdk/lib/constructs/RealtimeApi.ts`** (REST portion only in this phase — WebSocket comes in Phase 5):
   - `apigwv2.HttpApi` with a route `POST /transactions` → `HttpLambdaIntegration` → `writeIntakeFn`.
   - CORS preflight open (`allowOrigins: ["*"]`) — acceptable for a demo, flagged in `07-EDGE-CASES.md` E-1 as a known limitation to tighten if this went beyond a hackathon.

6. **Unit/integration tests** (`apps/api/test/writeIntake.test.ts`, against DynamoDB Local per `08-TESTING-STRATEGY.md` §3 — not a mocked SDK client):
   - Submitting a transaction with a new `idempotency_key` creates exactly one `write_dedup` row and enqueues exactly one SQS message.
   - Submitting the *same* `idempotency_key` twice returns `duplicate` on the second call and does not enqueue a second message.
   - A payload missing `item_id` returns `400`.
   - A `sale` transaction with `quantity: -5` returns `400` (edge case E-3).
   - A batch of 101 transactions returns `400` (edge case E-2).
   - The SQS message's `MessageGroupId` equals the transaction's `item_id`, confirmed by inspecting the mocked/local queue's received message attributes — this is the test that would have caught the counter-id-grouping bug if it existed.

7. **Manual verification:** `curl -X POST` the deployed endpoint twice with the same idempotency key, confirm the second response is `duplicate` and the SQS console shows only one message ever enqueued.

## Real-World Engineering Concerns

- **Idempotency, concretely.** This is the entire point of this phase — a network retry from a flaky counter connection must never double-enqueue.
- **No merge logic here.** This handler enqueues; it does not call `resolve()` from `packages/core` — that's Phase 5's job. Keeping this handler thin is deliberate (see `06-FOLDER-STRUCTURE.md`'s reasoning for the `packages/core` split).
- **Timeout/retry behavior:** if `SendMessageCommand` fails after the `write_dedup` row is already written as `queued`, the client's retry (same idempotency key) will find the existing row and return its `queued` status rather than erroring — acceptable, since the write will still be processed once whatever transient SQS issue clears, or investigated manually if it doesn't.

## Definition of Done

- [ ] `POST /transactions` deployed and reachable at a real API Gateway URL.
- [ ] All tests in step 6 pass against DynamoDB Local.
- [ ] Sending the same transaction twice via curl returns `queued` then `duplicate`, confirmed by inspecting actual HTTP responses, not just reading the code.
- [ ] `aws sqs receive-message` on the write queue shows a message with `MessageGroupId` matching the `item_id` sent, not the `counter_id`.
- [ ] The `writeIntakeFn`'s IAM role, inspected via `aws iam get-role-policy`, has no permissions on `inventory_records` or `audit_log`.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| `MessageGroupId` accidentally set to `counter_id` by copy-paste from an earlier draft | The test in step 6 that asserts on `MessageGroupId` specifically exists to catch exactly this — don't skip it even under time pressure |
| DynamoDB Local behaves subtly differently from real DynamoDB for TTL-based items | TTL expiry isn't actually exercised in a short hackathon test run — don't spend time trying to simulate the 7-day expiry, just confirm the `ttl` attribute is set correctly on write |

## Time Budget

**1 day.** If this runs long, cut the CDK infrastructure test additions and rely on the manual curl verification (step 7) instead — but do not cut the `MessageGroupId` assertion in the integration test suite; it's the single highest-value test in this phase given the project's history with this exact bug class.

## Handoff

Phase 5 can now assume: valid, deduplicated, correctly-item-grouped messages are landing on the write queue reliably. It only needs to consume them and resolve. Tag: `phase-4-complete`.
