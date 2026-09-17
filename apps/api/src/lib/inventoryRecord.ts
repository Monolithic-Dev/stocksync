import type { PNCounterState, RecordState, VectorClock } from "@stocksync/core";

/**
 * Non-stock fields subject to the field-level merge machinery. `name` and
 * `base_stock` are set once at item creation and never touched by
 * field_update transactions in any documented scenario, so they're passed
 * through untouched rather than folded into RecordState.fields.
 */
export const MERGEABLE_FIELDS = ["price", "shelf_location", "supplier"] as const;
export type MergeableField = (typeof MERGEABLE_FIELDS)[number];

export interface ConflictCandidateItem {
  counter_id: string;
  value: unknown;
  client_timestamp?: string;
  server_timestamp: string;
}

export interface ConflictCandidatesItem {
  field: string;
  overlap_seconds: number;
  values: ConflictCandidateItem[];
  bedrock_explanation?: string;
}

/** The inventory_records item shape, per docs/03-DATABASE-SCHEMA.md §2. */
export interface InventoryRecordItem {
  pk: string;
  sk: "CURRENT";
  shop_id: string;
  item_id: string;
  name?: string;
  base_stock: number;
  pn_counter: PNCounterState;
  stock: number;
  price?: number;
  shelf_location?: string;
  supplier?: string;
  vector_clock: VectorClock;
  field_last_writer: Record<string, string>;
  conflict_status: "none" | "needs_review";
  conflict_candidates?: ConflictCandidatesItem;
  stock_anomaly?: boolean;
  updated_at: string;
}

export function inventoryRecordKey(shopId: string, itemId: string): { pk: string; sk: "CURRENT" } {
  return { pk: `SHOP#${shopId}#ITEM#${itemId}`, sk: "CURRENT" };
}

/** Undefined input (no item exists yet) maps to undefined — resolve() already treats that as an empty RecordState. */
export function toRecordState(item: InventoryRecordItem | undefined): RecordState | undefined {
  if (!item) return undefined;

  const fields: Record<string, unknown> = {};
  for (const field of MERGEABLE_FIELDS) {
    if (item[field] !== undefined) fields[field] = item[field];
  }

  return {
    fields,
    fieldLastWriter: item.field_last_writer ?? {},
    vectorClock: item.vector_clock ?? {},
    pnCounter: item.pn_counter,
  };
}

function stockValue(pnCounter: PNCounterState | undefined, baseStock: number): number {
  if (!pnCounter) return baseStock;
  const increments = Object.values(pnCounter.increments).reduce((sum, n) => sum + n, 0);
  const decrements = Object.values(pnCounter.decrements).reduce((sum, n) => sum + n, 0);
  return baseStock + increments - decrements;
}

/**
 * Builds the next inventory_records item from a resolve() result, the
 * prior item (if any), and the write's shop/item identity. Always writes
 * `shop_id`/`conflict_status` as real top-level attributes — the
 * ShopConflictIndex GSI (Phase 3) partitions on `shop_id` directly, which
 * only works if it's a genuine attribute, not just a pk substring.
 */
export function buildNextItem(params: {
  shopId: string;
  itemId: string;
  priorItem: InventoryRecordItem | undefined;
  nextState: RecordState;
  now: string;
}): InventoryRecordItem {
  const { shopId, itemId, priorItem, nextState, now } = params;
  const baseStock = priorItem?.base_stock ?? 0;
  // edge case B-1: a decrement that would take stock negative is written
  // as-is (never clamped to zero) and flagged via stock_anomaly, so a real
  // discrepancy surfaces as a visible signal instead of being hidden.
  const stock = stockValue(nextState.pnCounter, baseStock);

  const item: InventoryRecordItem = {
    ...inventoryRecordKey(shopId, itemId),
    shop_id: shopId,
    item_id: itemId,
    name: priorItem?.name,
    base_stock: baseStock,
    pn_counter: nextState.pnCounter ?? { increments: {}, decrements: {} },
    stock,
    vector_clock: nextState.vectorClock,
    field_last_writer: nextState.fieldLastWriter,
    // Preserve whatever conflict_status/conflict_candidates already exist
    // by default — a clean apply on one field must never clear a pending
    // conflict on a different field (edge case B-4). Callers overwrite
    // these two explicitly when this write itself creates or resolves one.
    conflict_status: priorItem?.conflict_status ?? "none",
    conflict_candidates: priorItem?.conflict_candidates,
    updated_at: now,
  };

  for (const field of MERGEABLE_FIELDS) {
    const value = nextState.fields[field];
    if (value !== undefined) {
      (item as Record<MergeableField, unknown>)[field] = value;
    }
  }

  // Always set explicitly (not just when true) — otherwise a stock level
  // that recovers back to non-negative (e.g. a restock after the anomaly)
  // would leave a stale `stock_anomaly: true` from the prior write forever,
  // since nothing would ever overwrite it back to false.
  item.stock_anomaly = stock < 0;

  return item;
}
