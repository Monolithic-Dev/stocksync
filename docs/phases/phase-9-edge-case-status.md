# Phase 9 — Edge-Case Status

One-line status for every row in `docs/general/07-EDGE-CASES.md`, per that
phase's Definition of Done. Two real gaps were found and fixed during this
pass (marked ⚠ FIXED below); everything else was either already correct
by construction or already covered.

## A. Concurrency and Ordering

| ID | Status | Where |
|---|---|---|
| A-1 | Handled by design — SQS FIFO `MessageGroupId = item_id` | `infra/cdk/test/stocksync-stack.test.ts` ("provisions a FIFO write queue") |
| A-2 | Handled, tested — a stale write runs through the identical dominates/concurrent path, never special-cased | `packages/core/tests/conflictResolution.test.ts` ("A-2 a stale write") |
| A-3 | Handled, tested — generalizes to 3+ counters, not just 2 | `packages/core/tests/conflictResolution.test.ts` + `apps/api/test/conflictResolver.test.ts` ("three or more concurrent counters") |
| A-4 | ⚠ **FIXED** — `writeIntake.ts`'s batch handler used `Promise.all(transactions.map(...))`, letting two transactions for the *same* item race their own `SendMessageCommand` calls and reach SQS out of the client's submitted order. Fixed by grouping per-item and processing each item's transactions sequentially (`processBatch`), while still parallelizing across different items. | `apps/api/src/handlers/writeIntake.ts`, regression test in `apps/api/test/writeIntake.test.ts` ("edge case A-4") — confirmed the test fails against the old `Promise.all` code before the fix, passes after |
| A-5 | Handled, tested (pre-existing) | `packages/core/tests/vectorClock.test.ts` |

## B. Data Integrity and Correctness

| ID | Status | Where |
|---|---|---|
| B-1 | ⚠ **FIXED** — the server always computed `stock_anomaly` correctly, but it was never included in `GET /sync`'s response or the `record_updated` WebSocket push, so it was never actually visible in the UI, only in raw DynamoDB data. Fixed end to end: `SyncItem`/`WsPushMessage` types, `syncQuery.ts`, `conflictResolver.ts`'s push payload, `ShopContext.tsx`'s reducer, and a visible "Stock anomaly" badge + red stock value in `ItemCard.tsx`. Also fixed `buildNextItem` to explicitly clear the flag once stock recovers to non-negative (it previously only ever set it to `true`, never back to `false`). | `packages/core/src/types.ts`, `apps/api/src/lib/inventoryRecord.ts`, `apps/api/src/handlers/syncQuery.ts` + `conflictResolver.ts`, `apps/web/src/state/ShopContext.tsx` + `ItemCard.tsx`; tests in `apps/api/test/syncQuery.test.ts` and `apps/api/test/conflictResolver.test.ts` ("B-1 negative stock..."); visually verified via a Playwright screenshot against the local dev server (badge + red "-1" render correctly) |
| B-2 | Handled, tested — separate PN-Counter increment/decrement buckets mean this was never reachable as a field conflict | `packages/core/tests/conflictResolution.test.ts` ("B-2 a concurrent restock and sale") |
| B-3 | Handled, tested (pre-existing) | `packages/core/tests/fieldMerge.test.ts`, `conflictResolution.test.ts` |
| B-4 | Handled, tested (pre-existing) | `packages/core/tests/conflictResolution.test.ts` |
| B-5 | Deferred, documented — a second conflicting write on an already-`needs_review` field re-flags against the same original two candidates rather than accumulating a third. A deliberate scope cut, not an oversight. | `apps/api/src/handlers/conflictResolver.ts` (code comment), `docs/general/01-PRD.md` §13.1 |

## C. Network and Offline Client Behavior

| ID | Status | Where |
|---|---|---|
| C-1 | Handled, tested (pre-existing) | `apps/web/src/hooks/useOfflineQueue.ts`, `apps/web/test/offline/db.test.ts` |
| C-2 | Handled, tested (pre-existing) | `apps/web/test/hooks/useOfflineQueue.test.tsx` ("resumes a queue left over...") |
| C-3 | Handled by design (`GET /sync` is a plain current-state Query, never a history replay) + re-verified with a new test simulating 25 sequential writes | `apps/api/src/handlers/syncQuery.ts`, `apps/api/test/conflictResolver.test.ts` ("C-3 a very long offline period") |
| C-4 | Handled by construction — `IncomingWrite` (the pure `resolve()` function's input type) has no `client_timestamp` field at all; it is structurally impossible for core resolution logic to use wall-clock time for ordering. `client_timestamp` only ever flows into audit-log display and `overlap_seconds` computation. | `packages/core/src/types.ts` (`IncomingWrite`) |
| C-5 | Handled by design — verified by code reading: `useOfflineQueue.ts`'s `replayQueue()` marks each queue entry "reconciled" strictly from that transaction's own `POST /transactions` response, with zero dependency on `useWebSocketSync`'s connection state. Both hooks react to the same `isOnline` flip independently but don't coordinate — which is exactly what keeps them from being coupled. | `apps/web/src/hooks/useOfflineQueue.ts`, `apps/web/src/hooks/useWebSocketSync.ts` |

## D. WebSocket Lifecycle

| ID | Status | Where |
|---|---|---|
| D-1 | Handled, tested (pre-existing) | `apps/api/src/handlers/wsPush.ts`, `apps/api/test/wsPush.test.ts` |
| D-2 | Handled, tested — connections are keyed by `connection_id`, not `counter_id`; existing test re-annotated to call this out explicitly (it already proved this by using the same `counter_id` for two connections) | `apps/api/test/wsPush.test.ts` ("...including two tabs for the same counter") |
| D-3 | Deferred, documented — pushes already parallelize via `Promise.allSettled` (the policy this edge case asks for), just never load-tested at 50+ connections since that's unrealistic for this demo | `apps/api/src/handlers/wsPush.ts`, `docs/general/01-PRD.md` §13.1 |

## E. Security and Abuse

| ID | Status | Where |
|---|---|---|
| E-1 | Deferred, documented — shared `x-api-key`, no per-shop authorization | `docs/general/01-PRD.md` §13.1 (newly added this phase) |
| E-2 | Handled, tested (pre-existing) | `apps/api/test/writeIntake.test.ts` |
| E-3 | Handled, tested (pre-existing) | `apps/api/test/writeIntake.test.ts` |

## F. UI and UX

| ID | Status | Where |
|---|---|---|
| F-1 | Handled by design — `useOfflineQueue.ts`'s optimistic write applies the delta unconditionally (even to a locally-negative result), UI marks it `(pending)` | `apps/web/src/hooks/useOfflineQueue.ts` (code comment referencing F-1) |
| F-2 | Handled by design — confirmed via code search: no `toFixed`/`Math.round`/`toPrecision` anywhere in `apps/web/src`; values render exactly as received | n/a — absence confirmed |
| F-3 | Handled, tested (Phase 8) | `apps/web/src/components/ConflictReviewPanel.tsx`, `apps/api/test/conflictResolver.test.ts` |
| F-4 | Handled by design — `ShopContext.tsx`'s `ws_message` reducer unconditionally overwrites from the pushed server state (`conflict_status`, fields, `optimistic: false`) regardless of what the client previously believed | `apps/web/src/state/ShopContext.tsx` |

## G. AI (Bedrock) Specific

| ID | Status | Where |
|---|---|---|
| G-1 | Handled, tested (Phase 8) | `apps/api/src/lib/bedrock.ts`, `apps/api/test/bedrock.test.ts` |
| G-2 | Handled by design — prompt template asks for an explanation, never a decision; UI never offers the explanation as a selectable "accept this" | `.claude/skills/senior-prompt-engineer/references/bedrock-prompt-templates.md`, `ConflictReviewPanel.tsx` |
| G-3 | Handled by design — Bedrock call fires only after the core write is already committed and pushed, bounded by a 4s internal timeout | `apps/api/src/handlers/conflictResolver.ts`, `apps/api/src/lib/bedrock.ts` |

## Other Phase 9 tasks

- **CloudWatch dashboard**: `infra/cdk/lib/constructs/Observability.ts`, wired into `stocksync-stack.ts`. Two custom metrics (`ConflictRate` from `conflictResolver.ts`, `IdempotencyHitRate` from `writeIntake.ts`, both via `apps/api/src/lib/metrics.ts`) plus write-queue and DLQ depth widgets. **Pending**: confirming the dashboard shows real non-zero data from an actual deployed rehearsal run — blocked on live AWS access, same standing constraint as Phases 7–8.
- **Structured logging pass**: every handler with a meaningful failure/branch path uses `@aws-lambda-powertools/logger` (`write-intake`, `conflict-resolver`, `conflict-resolve`, `ws-push`, and — added this phase — `ws-connect`/`ws-disconnect`). No raw `console.log`/`console.error` anywhere under `apps/api/src` (confirmed by search); the local-only dev server (`apps/api/src/local/server.ts`) is exempt since it never ships.
- **IAM audit**: `npx cdk synth | grep` for `"Resource": "*"` on any `dynamodb:`/`sqs:` action — zero matches. Also covered by the `stocksync-stack.test.ts` "no wildcard IAM resources" test, extended this phase to also assert the new `bedrock:InvokeModel` grant is scoped to one model ARN.
- **Break it on purpose**: a malformed `POST /transactions` (missing `item_id`) manually confirmed to return `400 invalid_payload` immediately against the local dev server — it never reaches the write queue, so it can never land in the DLQ (that's a structurally distinct failure mode, confirmed by code path: validation happens entirely before `sqs.send` is ever called). WebSocket `GoneException` handling and the 3-concurrent-writer PN-Counter merge are both covered by the automated tests above.
