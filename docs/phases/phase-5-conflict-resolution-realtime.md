# Phase 5: Conflict Resolution Engine & Real-Time Push

**This is the highest-risk phase in the entire build — it gets 2 days, not 1, for a reason.** Everything that makes this project's pitch true or false lives here.

## Header

**Goal:** Every message on the write queue is resolved correctly (clean apply, PN-Counter merge, field merge, or `needs_review` flag) via `packages/core`'s `resolve()`, committed atomically across three tables, and pushed live to connected clients via WebSocket.

**Preconditions:** Phase 2 complete (`resolve()` fully tested). Phase 3 complete (tables + Streams + queue deployed). Phase 4 complete (correctly-grouped, deduplicated messages landing on the write queue).

**Implements:** `02-ARCHITECTURE.md` §3.5/§4.2/§4.3/§4.4/§4.5/§9 (failure modes), `01-PRD.md` FR-4 through FR-11, US-1 through US-6, `04-API-SPEC.md` §1 response shape and §2 (WebSocket contract), `07-EDGE-CASES.md` B-1 through B-5, D-1 through D-3.

---

## Task Breakdown

### Part A — Conflict Resolution (Day 1 of this phase)

1. **`apps/api/src/handlers/conflictResolver.ts`**:
   - Triggered by the write queue (SQS event source, not Streams — the queue delivers the *intent*, this Lambda performs the *resolution*; Streams on `inventory_records` is used separately for Part B's real-time push, triggered by the state change this Lambda itself writes).
   - For each SQS record: `GetCommand` the current `inventory_records` item by `pk = SHOP#<shop_id>#ITEM#<item_id>`, `sk = CURRENT`. If it doesn't exist yet, treat as an implicit clean apply against an empty `RecordState`.
   - Call `resolve(currentState, incomingWrite)` from `packages/core` — **all decision logic lives there**, this handler only marshals data in and out.
   - Branch on the result:
     - `applied` → proceed to the atomic commit (step 2).
     - `needs_review` → still commit atomically, but write `conflict_status: "needs_review"` and both `candidates` into `inventory_records`, and a `conflict_detected` action into `audit_log` instead of `field_update`/`sale`/`restock`.
   - **Handle edge case B-1 explicitly:** if a resolved decrement would take `value(pnCounter)` negative, do not clamp to zero — write the negative value and flag it visibly (add `stock_anomaly: true` to the item) so it surfaces as a real signal rather than being silently hidden. Document this choice in a code comment referencing this decision.

2. **Atomic commit via `TransactWriteItems`** (not three sequential calls):
   ```typescript
   await ddb.send(new TransactWriteCommand({
     TransactItems: [
       { Update: { TableName: "inventory_records", Key: { pk, sk: "CURRENT" }, /* new state */ } },
       { Put: { TableName: "audit_log", Item: auditEntry } },
       { Update: { TableName: "write_dedup", Key: { idempotency_key }, /* status: applied|needs_review */ } },
     ],
   }));
   ```
   This is the fix for the non-atomic-writes bug already caught once in this project (see `senior-architect` skill) — do not regress to separate `PutCommand`/`UpdateCommand` calls.

3. **Idempotent re-invocation:** since SQS can redeliver a message after the visibility timeout, confirm re-running the same message through this handler twice produces the same final state both times — this falls out naturally from `resolve()`'s own idempotency (Phase 2) plus checking `write_dedup`'s status before reprocessing an already-`applied` idempotency key.

4. **`infra/cdk/lib/constructs/SyncEngine.ts`** (extend):
   - Add `conflictResolverFn`, event-sourced from the write queue (`SqsEventSource`).
   - Grants: `recordsTable.grantReadWriteData(conflictResolverFn)`, `auditLogTable.grantWriteData(conflictResolverFn)`, `writeDedupTable.grantWriteData(conflictResolverFn)` — and, once Part B is wired, `wsConnectionsTable.grantReadData(conflictResolverFn)` for the push step.

### Part B — Real-Time WebSocket Push (Day 2 of this phase)

5. **`infra/cdk/lib/constructs/RealtimeApi.ts`** (extend from Phase 4):
   - Add `apigwv2.WebSocketApi` with `$connect` and `$disconnect` routes.
   - `apps/api/src/handlers/wsConnect.ts`: on connect, write `{ connection_id, shop_id, counter_id, connected_at }` to `ws_connections` (values come from the connection query string, per `04-API-SPEC.md` §2's `wss://...?shop_id=X&counter_id=Y`).
   - `apps/api/src/handlers/wsDisconnect.ts`: delete the row by `connection_id`.

6. **`apps/api/src/handlers/wsPush.ts`** — shared helper called from `conflictResolver.ts` after a successful commit:
   - Query `ws_connections` via the `ShopConnectionsIndex` GSI for all connections matching the shop.
   - For each, `PostToConnectionCommand` with either a `record_updated` or `needs_review` payload (exact shapes per `04-API-SPEC.md` §2).
   - **Handle edge case D-1:** catch `GoneException` per-connection, delete that stale row from `ws_connections`, and continue pushing to the rest — one dead connection must never abort the whole push loop.
   - **Handle edge case D-3** (stated as a policy, not built at this scale): push in parallel (`Promise.allSettled`), not sequentially — irrelevant at demo scale but costs nothing to do correctly now.

7. **Tests** (`apps/api/test/conflictResolver.test.ts`, against DynamoDB Local + a local SQS-equivalent or direct handler invocation with a synthetic event):
   - **The canonical scenario, exactly as in `01-PRD.md` US-3:** seed stock at 50; send decrements 5, 2 (client A) and 3 (client B) in both possible arrival orders; assert final `value()` is 40 in both cases, and `audit_log` shows exactly 3 entries correctly attributed.
   - US-4 (field-merge): concurrent writes to `price` (client A) and `shelf_location` (client B) both land; `conflict_status` stays `none`.
   - US-5 (needs-review): concurrent writes to `price` with different values produce `conflict_status: needs_review` with both candidates preserved, and stock (unaffected) continues updating normally in the same test run.
   - US-6 (malformed message): a message with a missing required field lands in the DLQ (verify via `aws sqs receive-message` on the DLQ, not just an assumption) and does not block subsequent valid messages for other items.
   - Re-invoking the resolver on an already-`applied` idempotency key produces no further state change (idempotency test).
   - `wsPush` continues pushing to remaining connections after one throws `GoneException` (mock this specific failure).

## Real-World Engineering Concerns

- **This phase is where the project's core correctness claim either holds or doesn't.** Budget extra manual testing time beyond the automated suite — run the canonical scenario by hand, repeatedly, with real delays between steps, not just as a fast synthetic test.
- **Race window between `Get` and `TransactWrite`** in step 1/2: two SQS messages for the *same* item can't actually process concurrently, because they share a `MessageGroupId` and SQS FIFO serializes delivery within a group — this is *why* Phase 4's grouping decision matters here, not just an abstract concern.
- **Graceful degradation for WebSocket push:** if `wsPush` fails entirely (e.g. the `ws_connections` table is briefly unavailable), the core resolution and commit must have already succeeded — push is additive, never a dependency of correctness.

## Definition of Done

- [ ] All tests in step 7 pass, including both arrival orders of the canonical scenario.
- [ ] `aws dynamodb get-item` on the test item after the canonical scenario shows `stock: 40` (or the PN-Counter-derived equivalent) exactly.
- [ ] A manually malformed SQS message (missing `item_id`) ends up in the DLQ, confirmed via the AWS console, without blocking other items' processing (confirmed by sending a valid message for a *different* item immediately after and seeing it process normally).
- [ ] A connected WebSocket client (tested via `wscat` or a small test script) receives a `record_updated` push within a few seconds of a `curl`-triggered transaction.
- [ ] Killing one WebSocket connection mid-test and then triggering another transaction still successfully pushes to the remaining live connection.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| The canonical scenario passes in one arrival order but not the reverse | This is exactly the kind of bug the two-order test in step 7 exists to catch — if it fails, the vector-clock comparison or PN-Counter merge in `packages/core` has an ordering-sensitivity bug that Phase 2's property tests should have caught; go back to Phase 2 before patching here |
| WebSocket push implementation eats significantly more than its allotted time | Per `09-BUILD-PLAN.md`, this is the first thing to cut if behind schedule — fall back to `GET /sync` polling on reconnect (already speced in `04-API-SPEC.md`) for the demo; it tells the same correctness story with less risk |
| `TransactWriteItems` has a 100-item limit and 4MB payload limit | Irrelevant at this project's scale (3 items per transaction), but worth knowing before ever batching multiple record updates into one transaction call |

## Time Budget

**2 days** (the only phase with more than one day budgeted, deliberately). If Day 2 (Part B, WebSocket) is at risk, cut it entirely and ship `GET /sync`-on-reconnect only — do not let WebSocket debugging eat into Phase 6/7's time. Part A (resolution + atomic commit) is never cut; it's the actual product.

## Handoff

Phase 6 can now assume: a fully correct, fully tested resolution pipeline exists behind the write queue, commits atomically, and (if Part B wasn't cut) pushes live updates over WebSocket. The client only needs to submit writes and either listen for pushes or poll `GET /sync`. Tag: `phase-5-complete`.
