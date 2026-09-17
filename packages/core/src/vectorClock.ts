import type { VectorClock } from "./types";

/** A clock referencing a client we've never seen is implicitly 0 for that client (edge case A-5) — never throw. */
function seen(clock: VectorClock, clientId: string): number {
  return clock[clientId] ?? 0;
}

function clientIdsOf(a: VectorClock, b: VectorClock): string[] {
  return Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
}

/** True if `a` has seen everything `b` has, plus at least one strictly-greater entry. */
export function dominates(a: VectorClock, b: VectorClock): boolean {
  let strictlyGreater = false;
  for (const clientId of clientIdsOf(a, b)) {
    const aValue = seen(a, clientId);
    const bValue = seen(b, clientId);
    if (aValue < bValue) return false;
    if (aValue > bValue) strictlyGreater = true;
  }
  return strictlyGreater;
}

export function clocksEqual(a: VectorClock, b: VectorClock): boolean {
  return clientIdsOf(a, b).every((clientId) => seen(a, clientId) === seen(b, clientId));
}

/** True if neither clock dominates the other and they aren't identical — a genuine concurrent write. */
export function isConcurrent(a: VectorClock, b: VectorClock): boolean {
  return !dominates(a, b) && !dominates(b, a) && !clocksEqual(a, b);
}

/** Per-key max — the standard vector clock merge, used to advance the stored clock after any apply. */
export function merge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = {};
  for (const clientId of clientIdsOf(a, b)) {
    result[clientId] = Math.max(seen(a, clientId), seen(b, clientId));
  }
  return result;
}
