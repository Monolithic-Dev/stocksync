import { useEffect } from "react";
import type { TransactionInput, TransactionType, VectorClock } from "@stocksync/core";
import { clearPending, enqueue, listPending } from "../offline/db";
import { postTransactions } from "../api/client";
import { useShopContext } from "../state/ShopContext";

export interface SubmitTransactionParams {
  itemId: string;
  type: TransactionType;
  quantity?: number;
  field?: string;
  value?: unknown;
}

export interface OfflineQueueApi {
  submitTransaction: (params: SubmitTransactionParams) => Promise<void>;
  replayQueue: () => Promise<void>;
}

function nextVectorClock(current: VectorClock | undefined, counterId: string): VectorClock {
  return { ...current, [counterId]: (current?.[counterId] ?? 0) + 1 };
}

function stockDeltaFor(params: SubmitTransactionParams): number | undefined {
  if (params.type === "sale") return -(params.quantity ?? 0);
  if (params.type === "restock") return params.quantity ?? 0;
  return undefined;
}

/**
 * Owns the offline-queue lifecycle: submit (online or queued), replay on
 * reconnect, and resuming any queue left over from a previous tab session
 * (edge case C-2). `isOnline` is passed in rather than read via
 * useConnectivity directly so callers share exactly one connectivity
 * source (CounterPage's) instead of each hook instance racing its own.
 */
export function useOfflineQueue(shopId: string, counterId: string, isOnline: boolean): OfflineQueueApi {
  const { state, dispatch } = useShopContext();

  async function submitTransaction(params: SubmitTransactionParams): Promise<void> {
    const idempotencyKey = crypto.randomUUID();
    const nextClock = nextVectorClock(state.items[params.itemId]?.vector_clock, counterId);

    const payload: TransactionInput = {
      idempotency_key: idempotencyKey,
      item_id: params.itemId,
      type: params.type,
      quantity: params.quantity,
      field: params.field,
      value: params.value,
      client_vector_clock: nextClock,
      client_timestamp: new Date().toISOString(),
    };

    // Optimistic local update — never blocks on the network. Applies even
    // if the locally-known stock would go negative (edge case F-1): the
    // local view may be stale, and the server is the sole authority on
    // whether that's actually a problem (via stock_anomaly).
    dispatch({
      type: "optimistic_write",
      itemId: params.itemId,
      vectorClock: nextClock,
      stockDelta: stockDeltaFor(params),
      field: params.field,
      value: params.value,
    });

    if (!isOnline) {
      await enqueue(idempotencyKey, payload);
      dispatch({
        type: "queue_entry_added",
        entry: { idempotencyKey, itemId: params.itemId, type: params.type, status: "queued" },
      });
      return;
    }

    dispatch({
      type: "queue_entry_added",
      entry: { idempotencyKey, itemId: params.itemId, type: params.type, status: "replaying" },
    });
    try {
      await postTransactions(shopId, counterId, [payload]);
      dispatch({ type: "queue_entry_status", idempotencyKey, status: "reconciled" });
    } catch {
      // edge case C-1: a request whose response never arrived (network
      // dropped mid-request, or we were never really online) must resubmit
      // under the SAME idempotency key on the next replay, never a new
      // one — falling back to the durable local queue with this exact
      // payload/key is exactly that.
      await enqueue(idempotencyKey, payload);
      dispatch({ type: "queue_entry_status", idempotencyKey, status: "queued" });
    }
  }

  async function replayQueue(): Promise<void> {
    const pending = await listPending();
    if (pending.length === 0) return;

    for (const entry of pending) {
      dispatch({ type: "queue_entry_status", idempotencyKey: entry.idempotencyKey, status: "replaying" });
    }

    try {
      // Oldest first, as one batch — listPending() already returns them
      // in creation order.
      const { results } = await postTransactions(
        shopId,
        counterId,
        pending.map((entry) => entry.payload),
      );

      for (const result of results) {
        // POST /transactions only ever returns "queued" or "duplicate"
        // (writeIntake.ts is deliberately thin — it enqueues, it doesn't
        // resolve). Either status means the server has durably accepted
        // the write, which is all the *local* queue cares about: this is
        // a divergence from the phase-6 doc's assumption of four possible
        // statuses coming back synchronously, corrected to match what
        // Phase 4 actually built. "Reconciled" here means "handed off to
        // the durable pipeline," not "conflict-resolved" — the eventual
        // resolution arrives separately via GET /sync or the WebSocket
        // push and updates ShopContext's items independently of the queue
        // drawer's per-entry lifecycle.
        await clearPending(result.idempotency_key);
        dispatch({ type: "queue_entry_status", idempotencyKey: result.idempotency_key, status: "reconciled" });
      }
    } catch {
      // Still offline, or the request failed outright — leave everything
      // queued for the next reconnect attempt.
      for (const entry of pending) {
        dispatch({ type: "queue_entry_status", idempotencyKey: entry.idempotencyKey, status: "queued" });
      }
    }
  }

  // Resume any pending queue left over from a previous tab session (edge
  // case C-2) — a closed-then-reopened tab with unsent transactions must
  // not render the "everything is synced" state.
  useEffect(() => {
    let cancelled = false;
    listPending()
      .then((pending) => {
        if (cancelled || pending.length === 0) return;
        dispatch({
          type: "queue_restored",
          entries: pending.map((entry) => ({
            idempotencyKey: entry.idempotencyKey,
            itemId: entry.payload.item_id,
            type: entry.payload.type,
            status: "queued" as const,
          })),
        });
      })
      .catch(() => {
        // IndexedDB unavailable (private browsing, etc.) — the queue
        // simply starts empty; there's nothing meaningful to recover.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount to resume whatever IndexedDB already holds
  }, []);

  return { submitTransaction, replayQueue };
}
