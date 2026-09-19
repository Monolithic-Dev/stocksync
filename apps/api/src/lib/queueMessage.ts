import type { TransactionType, VectorClock } from "@stocksync/core";

export type { TransactionType };

/** The message landing on the write queue — everything the conflict-resolver needs to build an IncomingWrite. */
export interface QueuedTransactionMessage {
  shop_id: string;
  counter_id: string;
  idempotency_key: string;
  item_id: string;
  type: TransactionType;
  quantity?: number;
  field?: string;
  value?: unknown;
  client_vector_clock?: VectorClock;
  client_timestamp?: string;
  /** See TransactionInput.order_id — purely additive, threaded through unchanged. */
  order_id?: string;
}
