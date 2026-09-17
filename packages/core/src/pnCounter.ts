import type { PNCounterState } from "./types";

export function emptyPNCounter(): PNCounterState {
  return { increments: {}, decrements: {} };
}

function sumBucket(bucket: Record<string, number>): number {
  return Object.values(bucket).reduce((total, amount) => total + amount, 0);
}

/** stock = sum(increments) - sum(decrements) — never a directly-overwritable number. */
export function value(state: PNCounterState): number {
  return sumBucket(state.increments) - sumBucket(state.decrements);
}

/**
 * Applies one client's operation as a cumulative addition to its own bucket
 * entry. This is the ONLY function `resolve()` calls to incorporate a live
 * incoming counter delta — commutative by construction, so it's correct
 * whether the incoming write's vector clock dominates or is concurrent with
 * the stored state. Never use `merge()` (below) for this.
 */
export function applyDelta(
  state: PNCounterState,
  clientId: string,
  type: "increment" | "decrement",
  amount: number,
): PNCounterState {
  if (type === "increment") {
    return {
      increments: { ...state.increments, [clientId]: (state.increments[clientId] ?? 0) + amount },
      decrements: state.decrements,
    };
  }
  return {
    increments: state.increments,
    decrements: { ...state.decrements, [clientId]: (state.decrements[clientId] ?? 0) + amount },
  };
}

function mergeBucket(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const clientId of new Set([...Object.keys(a), ...Object.keys(b)])) {
    result[clientId] = Math.max(a[clientId] ?? 0, b[clientId] ?? 0);
  }
  return result;
}

/**
 * Reconciles two INDEPENDENTLY-ACCUMULATED PNCounterState snapshots via
 * per-client-id max (state-based CRDT merge). This system has exactly one
 * authoritative record processed sequentially by one resolver per item, so
 * there is never a second snapshot to reconcile in production — `resolve()`
 * always uses `applyDelta` instead. `merge` exists to prove the algebra
 * (associativity) in the property-based tests, and for any future scenario
 * that genuinely needs to combine two divergent replicas.
 */
export function merge(a: PNCounterState, b: PNCounterState): PNCounterState {
  return {
    increments: mergeBucket(a.increments, b.increments),
    decrements: mergeBucket(a.decrements, b.decrements),
  };
}
