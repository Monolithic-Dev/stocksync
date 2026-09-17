# Phase 2: Core Conflict-Resolution Logic (`packages/core`)

## Header

**Goal:** `packages/core` fully implemented and passing its full test suite — including property-based proofs of PN-Counter commutativity — with **zero AWS dependency**. This is the actual engineering substance of the project; everything from Phase 4 onward is a thin adapter around it.

**Preconditions:** Phase 1 complete (`packages/core/` folder exists, root TypeScript tooling works).

**Implements:** `02-ARCHITECTURE.md` §5 (the conflict resolution algorithm), `01-PRD.md` FR-4/FR-5/FR-6 and NFR "Correctness" (commutativity must be *proven*, not asserted), `06-FOLDER-STRUCTURE.md`'s `packages/core` tree, `08-TESTING-STRATEGY.md` §2.

---

## Task Breakdown

1. **`packages/core/src/types.ts`** — define the shared types every other file imports:
   - `VectorClock = Record<string, number>`
   - `PNCounterState = { increments: Record<string, number>; decrements: Record<string, number> }`
   - `RecordState = { fields: Record<string, unknown>; fieldLastWriter: Record<string, string>; vectorClock: VectorClock; pnCounter?: PNCounterState }`
   - `IncomingWrite = { clientId: string; vectorClock: VectorClock; fields?: Record<string, unknown>; counterDelta?: { type: "increment" | "decrement"; amount: number } }`

2. **`packages/core/src/vectorClock.ts`**:
   - `dominates(a: VectorClock, b: VectorClock): boolean` — true if `a` has seen everything `b` has, plus at least one more.
   - `isConcurrent(a: VectorClock, b: VectorClock): boolean` — true if neither dominates and they aren't identical.
   - `merge(a: VectorClock, b: VectorClock): VectorClock` — per-key max.
   - **Error handling:** a clock referencing a `clientId` never seen before must be treated as implicitly `0` for that key, never thrown as an error (edge case A-5 in `07-EDGE-CASES.md`).

3. **`packages/core/src/pnCounter.ts`**:
   - `value(state: PNCounterState): number` — `sum(increments) - sum(decrements)`.
   - `applyDelta(state, clientId, type, amount): PNCounterState` — pure, returns a new state.
   - `merge(a: PNCounterState, b: PNCounterState): PNCounterState` — per-client-id max on each bucket (increments, decrements independently). **This reconciles two independently-accumulated state snapshots (e.g. the associativity property test's two sub-lists) — it is not how a single incoming operation gets applied.** `counterDelta.amount` is a per-transaction quantity, not a running total, so `max()`-ing it against `current`'s already-accumulated total for that client would silently drop the operation whenever the new quantity is smaller than what that client has already contributed (the common case). `applyDelta` is the only function `resolve()` should call to incorporate a live incoming counter delta — see the note below.

4. **`packages/core/src/fieldMerge.ts`**:
   - `hasFieldConflict(current: RecordState, incomingFields: Record<string, unknown>): string | null` — returns the conflicting field name, or `null` if none. **Must return `null` if the concurrent values are identical** (edge case B-3) — a same-value concurrent write is not a real conflict.
   - `mergeDisjointFields(current, incoming): RecordState` — applies non-conflicting field writes.

5. **`packages/core/src/conflictResolution.ts`** — the orchestrator:
   - `resolve(current: RecordState, incoming: IncomingWrite): ResolutionResult` where `ResolutionResult = { kind: "applied"; state: RecordState } | { kind: "needs_review"; field: string; candidates: unknown[] }`.
   - Logic: if `dominates(incoming.vectorClock, current.vectorClock)` → clean apply (merge clocks, apply counter delta and/or fields directly). Else if `isConcurrent(...)` → **counter deltas always apply via `applyDelta`, exactly as in the dominates branch** (PN-counter addition is commutative by construction, so concurrency changes nothing about how a counter delta is incorporated — `pnCounter.merge`'s max-based reconciliation is never invoked from this path, only from tests that merge two independently-built states); field writes go through `hasFieldConflict` first — disjoint fields merge, same-field-different-value returns `needs_review`. Vector-clock dominance vs. concurrency only changes the strategy for **field** writes; it is irrelevant to how counter deltas are applied.
   - **Must be idempotent**: re-running `resolve` with the same `current` and `incoming` twice produces the same result both times (needed because SQS/Streams can redeliver — see Phase 5's failure-mode handling).

6. **`packages/core/src/index.ts`** — re-export everything (`export * from "./types"` etc.).

7. **Unit tests** (`packages/core/tests/`, Vitest):
   - `vectorClock.test.ts`: `dominates` returns true for a clean superset clock; `isConcurrent` returns true for two clocks where neither dominates; a clock with an unseen client ID doesn't throw.
   - `pnCounter.test.ts`: reproduces the canonical scenario from `01-PRD.md` US-3 exactly — start 50, apply decrements 5, 2, 3 from two different client IDs in any interleaving, assert final `value()` is 40.
   - `conflictResolution.test.ts`: `resolve()` on a clean-apply case returns `applied` with merged clock; on a disjoint-field concurrent case returns `applied` with both fields present; on a same-field-different-value concurrent case returns `needs_review` with both candidates; on a same-field-*same*-value concurrent case returns `applied`, not `needs_review`.

8. **Property-based tests** (`pnCounter.property.test.ts`, using `fast-check`):
   - **Commutativity:** generate a random array of `{clientId, type, amount}` operations (3+ distinct client IDs), apply in original order and in reverse order, assert `value()` is identical both times.
   - **Associativity:** split the same operation list into two arbitrary sub-lists, build two independent `PNCounterState`s, `merge()` them, assert the result equals applying the full list to one state directly.
   - This is the test suite that proves the CRDT's defining guarantee — not optional polish, this is what makes the "PN-Counter" claim true rather than aspirational.

## Real-World Engineering Concerns

- **Purity is a hard constraint, not a preference.** No `import` from `aws-sdk` or any I/O anywhere in `packages/core` — if a future change needs one, that's an architecture violation (see `senior-architect` skill).
- **Idempotency of `resolve()` itself**, not just of the intake dedup layer — this matters because Phase 5's Lambda can be re-invoked by DynamoDB Streams' at-least-once delivery.

## Definition of Done

- [ ] `npm test --workspace=packages/core` passes, 0 failures.
- [ ] The property-based commutativity test runs at least 100 generated cases per `fast-check`'s default and passes on all of them.
- [ ] Deliberately reintroducing a known-bad version (a plain G-Counter that can't decrement) causes the property test to fail — confirmed once, then reverted — proving the test actually catches the bug class it claims to (per `senior-qa` skill's "has this test ever failed" standard).
- [ ] No file under `packages/core/src` imports anything from `@aws-sdk/*`.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| Vector clock comparison logic has an off-by-one in the "strictly greater in at least one" check | Write the `dominates`/`isConcurrent` unit tests *before* the property tests — get the simple cases airtight first |
| Property-based test generator produces unrealistic operation sequences (e.g. astronomically large amounts) | Bound `fc.integer({ min: 1, max: 20 })` for amounts — realistic sale/restock quantities, not adversarial edge values that don't reflect the actual domain |

## Time Budget

**1 day.** If this runs long, the property-based tests are the last thing to cut — they're the highest-value, lowest-cost-to-skip-wrongly part of this phase. If truly out of time, ship with the example-based unit tests only and add property tests on Day 9's hardening pass, but flag this explicitly rather than silently dropping it.

## Handoff

Phase 3 (and every phase after it) can now assume: a fully correct, fully tested, pure `resolve()` function exists and is importable as `import { resolve } from "core"`. No Lambda handler needs to reimplement any merge logic — it only calls this. Tag: `phase-2-complete`.
