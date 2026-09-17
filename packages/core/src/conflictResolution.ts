import type { IncomingWrite, RecordState, ResolutionResult, ResolutionStrategy } from "./types";
import { dominates, merge as mergeClocks } from "./vectorClock";
import { applyDelta, emptyPNCounter } from "./pnCounter";
import { hasFieldConflict, mergeDisjointFields } from "./fieldMerge";

function emptyRecordState(): RecordState {
  return { fields: {}, fieldLastWriter: {}, vectorClock: {} };
}

function applyCounterDelta(state: RecordState, incoming: IncomingWrite): RecordState {
  if (!incoming.counterDelta) return state;
  const pnCounter = applyDelta(
    state.pnCounter ?? emptyPNCounter(),
    incoming.clientId,
    incoming.counterDelta.type,
    incoming.counterDelta.amount,
  );
  return { ...state, pnCounter };
}

/**
 * Resolves one incoming write against the item's current state. Pure and
 * side-effect-free: packages/core does no I/O, so the caller (the
 * conflict-resolver Lambda) is responsible for idempotent-consumer
 * de-duplication via `write_dedup` before this is ever invoked — resolve()
 * assumes it is never called twice with the literal same operation already
 * reflected in `current` (see docs/02-ARCHITECTURE.md's Idempotent Consumer
 * pattern and Phase 5's write_dedup gate).
 *
 * Branching:
 * - `dominates(incoming, current)` → a clean, causally-ordered apply.
 * - Otherwise (concurrent, or a stale write behind current in every entry —
 *   edge case A-2) → counter deltas still apply directly via `applyDelta`
 *   (commutative regardless of ordering); field writes go through
 *   `hasFieldConflict` first, since blindly overwriting isn't safe unless
 *   the incoming write strictly dominates.
 *
 * On `needs_review`, `state` still carries the counter delta and any
 * disjoint field writes from this same incoming write applied — a pending
 * conflict on one field must never block unrelated stock or field updates
 * (edge cases B-4/B-5, PRD US-5). The conflicting field itself is left at
 * its current value; the caller stores `field`/`candidates` alongside it.
 */
export function resolve(current: RecordState | undefined, incoming: IncomingWrite): ResolutionResult {
  const base = current ?? emptyRecordState();
  const cleanApply = dominates(incoming.vectorClock, base.vectorClock);
  // Concurrent writes carrying a counter delta are labeled by that delta
  // first (pn_counter_merge) even if they also carry fields — not a shape
  // any real transaction produces today (API spec transactions are either
  // sale/restock or field_update), but a defined tie-break in case that
  // ever changes.
  const strategy: ResolutionStrategy = cleanApply
    ? "clean_apply"
    : incoming.counterDelta
      ? "pn_counter_merge"
      : "field_merge";

  let next = applyCounterDelta(base, incoming);
  next = { ...next, vectorClock: mergeClocks(base.vectorClock, incoming.vectorClock) };

  if (!incoming.fields) {
    return { kind: "applied", state: next, strategy };
  }

  if (!cleanApply) {
    const conflictField = hasFieldConflict(base, incoming.fields);
    if (conflictField) {
      const safeFields = Object.fromEntries(
        Object.entries(incoming.fields).filter(([field]) => field !== conflictField),
      );
      next = mergeDisjointFields(next, { clientId: incoming.clientId, fields: safeFields });
      return {
        kind: "needs_review",
        state: next,
        field: conflictField,
        candidates: [
          { clientId: base.fieldLastWriter[conflictField], value: base.fields[conflictField] },
          { clientId: incoming.clientId, value: incoming.fields[conflictField] },
        ],
      };
    }
  }

  next = mergeDisjointFields(next, { clientId: incoming.clientId, fields: incoming.fields });
  return { kind: "applied", state: next, strategy };
}
