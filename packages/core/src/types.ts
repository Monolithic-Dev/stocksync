/** A logical clock: how many operations the server has seen from each client. */
export type VectorClock = Record<string, number>;

/**
 * State-based PN-Counter: two grow-only buckets, one per operation sign,
 * each keyed by the client that contributed to it. `value()` in
 * pnCounter.ts derives the current count; nothing here is ever decremented
 * directly, which is what makes the merge commutative and associative.
 */
export type PNCounterState = {
  increments: Record<string, number>;
  decrements: Record<string, number>;
};

export type RecordState = {
  fields: Record<string, unknown>;
  fieldLastWriter: Record<string, string>;
  vectorClock: VectorClock;
  pnCounter?: PNCounterState;
};

export type CounterDelta = {
  type: "increment" | "decrement";
  amount: number;
};

export type IncomingWrite = {
  clientId: string;
  vectorClock: VectorClock;
  fields?: Record<string, unknown>;
  counterDelta?: CounterDelta;
};

export type FieldConflictCandidate = {
  clientId: string;
  value: unknown;
};

/**
 * How an `applied` result was reached — surfaced so callers (the audit
 * log, primarily) can record *why* a write succeeded without re-deriving
 * dominance/concurrency themselves. `clean_apply`: the incoming write's
 * vector clock dominated — a plain, causally-ordered apply, no merging
 * involved. `pn_counter_merge` / `field_merge`: the write was concurrent
 * with the stored state and applied via the corresponding safe-under-
 * concurrency path (see conflictResolution.ts).
 */
export type ResolutionStrategy = "clean_apply" | "pn_counter_merge" | "field_merge";

export type ResolutionResult =
  | { kind: "applied"; state: RecordState; strategy: ResolutionStrategy }
  | {
      kind: "needs_review";
      state: RecordState;
      field: string;
      candidates: FieldConflictCandidate[];
    };

/**
 * Wire-level DTOs for the `POST /transactions` and `GET /sync` boundary
 * (04-API-SPEC.md §1), shared between apps/api's handlers and apps/web's
 * client so the two can never silently disagree on a field name — see
 * 06-FOLDER-STRUCTURE.md's rationale for why this lives in packages/core
 * rather than being redefined independently on each side.
 */
export type TransactionType = "sale" | "restock" | "field_update";

export interface TransactionInput {
  idempotency_key: string;
  item_id: string;
  type: TransactionType;
  quantity?: number;
  field?: string;
  value?: unknown;
  client_vector_clock?: VectorClock;
  client_timestamp?: string;
  /** Set only when this transaction is one line item of a checkout (19b) — groups its audit_log entry with the rest of the order. Purely additive: the write pipeline and resolve() neither require nor inspect it. */
  order_id?: string;
}

export type TransactionResultStatus = "queued" | "duplicate";

export interface TransactionResultDTO {
  idempotency_key: string;
  status: TransactionResultStatus;
}

export interface ConflictCandidateDTO {
  counter_id: string;
  value: unknown;
  client_timestamp?: string;
  server_timestamp?: string;
}

export interface ConflictCandidatesDTO {
  field: string;
  overlap_seconds: number;
  values: ConflictCandidateDTO[];
  bedrock_explanation?: string;
}

export interface SyncItem {
  item_id: string;
  name?: string;
  stock: number;
  price?: number;
  shelf_location?: string;
  supplier?: string;
  /** ISO date (YYYY-MM-DD). Field-level merged like price/shelf_location — no new conflict-resolution logic (15b). */
  expiry_date?: string;
  field_last_writer: Record<string, string>;
  conflict_status: "none" | "needs_review";
  conflict_candidates?: ConflictCandidatesDTO;
  /**
   * True once a decrement has taken `stock` negative (edge case B-1) — the
   * server never clamps to zero, since that would hide a real physical
   * discrepancy. Surfaced so the UI can flag it visibly rather than only
   * being visible in raw DynamoDB data.
   */
  stock_anomaly?: boolean;
  /**
   * Not part of 04-API-SPEC.md's documented GET /sync example, but
   * necessary for the client to work correctly: without it, a client can
   * only send a `client_vector_clock` containing its own component, which
   * makes `dominates()` reject even a genuinely sequential second write
   * from the same counter the moment any *other* counter has touched the
   * item at all (it looks concurrent, since the client's clock doesn't
   * know about that other component) — silently mislabeling ordinary
   * same-counter edits as conflicts. The client seeds its next write's
   * clock from this field, per the standard vector-clock protocol of
   * "advance your own component on top of the last state you observed."
   */
  vector_clock: VectorClock;
}

export interface AuditHistoryEntry {
  timestamp: string;
  counter_id: string;
  action: string;
  resolution_strategy?: string;
  details: unknown;
}

/**
 * Server → client push over the WebSocket API (04-API-SPEC.md §2).
 * `vector_clock` is carried on both variants for the same reason it's on
 * `SyncItem` — see that field's doc comment.
 */
/**
 * Tier 2 catalog DTOs (19b, 03-DATABASE-SCHEMA.md §8.1-8.4) — static
 * product/category/supplier metadata and checkout-order summaries.
 * Deliberately separate from InventoryRecordItem/SyncItem: none of this
 * data is subject to concurrent-offline-edit conflicts the way live
 * stock/price state is, so plain last-write-wins (no vector clock, no
 * PN-Counter) is the correct, deliberate choice — see senior-architect's
 * guidance on when CRDT-level rigor is and isn't warranted.
 */
export interface Product {
  product_id: string;
  shop_id: string;
  name: string;
  sku?: string;
  category_id?: string;
  supplier_id?: string;
  base_price?: number;
  created_at: string;
  updated_at: string;
}

export interface Category {
  category_id: string;
  shop_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  supplier_id: string;
  shop_id: string;
  name: string;
  lead_time_days?: number;
  created_at: string;
  updated_at: string;
}

export interface OrderLineItem {
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface Order {
  order_id: string;
  shop_id: string;
  counter_id: string;
  line_items: OrderLineItem[];
  total_amount: number;
  status: "completed" | "refunded";
  created_at: string;
}

export type WsPushMessage =
  | {
      type: "record_updated";
      item_id: string;
      stock?: number;
      price?: number;
      shelf_location?: string;
      expiry_date?: string;
      stock_anomaly?: boolean;
      field_last_writer?: Record<string, string>;
      vector_clock: VectorClock;
    }
  | {
      type: "needs_review";
      item_id: string;
      field: string;
      overlap_seconds: number;
      values: ConflictCandidateDTO[];
      bedrock_explanation: string | null;
      vector_clock: VectorClock;
    };
