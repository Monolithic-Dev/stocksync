import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import type { SyncItem, TransactionType, VectorClock, WsPushMessage } from "@stocksync/core";

export type QueueEntryStatus = "queued" | "replaying" | "reconciled";

export interface QueueDisplayEntry {
  idempotencyKey: string;
  itemId: string;
  type: TransactionType;
  status: QueueEntryStatus;
}

export interface DisplayItem extends SyncItem {
  /** True while this item's displayed stock/fields reflect an unconfirmed
   * local queue entry rather than the server's last-known state — cleared
   * the moment a real sync/push confirms (or corrects) it. */
  optimistic?: boolean;
}

export interface ShopState {
  items: Record<string, DisplayItem>;
  queue: QueueDisplayEntry[];
  syncStatus: "loading" | "ready" | "error";
  connectivity: { browserOnline: boolean; manualOffline: boolean };
}

export type ShopAction =
  | { type: "sync_loaded"; items: SyncItem[] }
  | { type: "sync_failed" }
  | { type: "ws_message"; message: WsPushMessage }
  | { type: "optimistic_write"; itemId: string; vectorClock: VectorClock; stockDelta?: number; field?: string; value?: unknown }
  | { type: "queue_entry_added"; entry: QueueDisplayEntry }
  | { type: "queue_entry_status"; idempotencyKey: string; status: QueueEntryStatus }
  | { type: "queue_entry_removed"; idempotencyKey: string }
  | { type: "queue_restored"; entries: QueueDisplayEntry[] }
  | { type: "browser_online_changed"; online: boolean }
  | { type: "toggle_offline" };

const initialState: ShopState = {
  items: {},
  queue: [],
  syncStatus: "loading",
  connectivity: { browserOnline: navigator.onLine, manualOffline: false },
};

function placeholderItem(itemId: string): DisplayItem {
  return { item_id: itemId, stock: 0, field_last_writer: {}, conflict_status: "none", vector_clock: {} };
}

function reducer(state: ShopState, action: ShopAction): ShopState {
  switch (action.type) {
    case "sync_loaded": {
      const items: Record<string, DisplayItem> = {};
      for (const item of action.items) items[item.item_id] = item;
      return { ...state, items, syncStatus: "ready" };
    }

    case "sync_failed":
      return { ...state, syncStatus: "error" };

    case "ws_message": {
      const { message } = action;
      const existing = state.items[message.item_id] ?? placeholderItem(message.item_id);

      if (message.type === "record_updated") {
        const nextItem: DisplayItem = {
          ...existing,
          ...(message.stock !== undefined ? { stock: message.stock } : {}),
          ...(message.price !== undefined ? { price: message.price } : {}),
          ...(message.shelf_location !== undefined ? { shelf_location: message.shelf_location } : {}),
          ...(message.stock_anomaly !== undefined ? { stock_anomaly: message.stock_anomaly } : {}),
          field_last_writer: { ...existing.field_last_writer, ...(message.field_last_writer ?? {}) },
          conflict_status: "none",
          conflict_candidates: undefined,
          vector_clock: message.vector_clock,
          optimistic: false,
        };
        return { ...state, items: { ...state.items, [message.item_id]: nextItem } };
      }

      // needs_review
      const nextItem: DisplayItem = {
        ...existing,
        conflict_status: "needs_review",
        conflict_candidates: {
          field: message.field,
          overlap_seconds: message.overlap_seconds,
          values: message.values,
          bedrock_explanation: message.ai_summary ?? undefined,
        },
        vector_clock: message.vector_clock,
        optimistic: false,
      };
      return { ...state, items: { ...state.items, [message.item_id]: nextItem } };
    }

    case "optimistic_write": {
      const existing = state.items[action.itemId];
      if (!existing) return state; // nothing to optimistically render on top of before the first sync completes
      const nextItem: DisplayItem = {
        ...existing,
        stock: action.stockDelta !== undefined ? existing.stock + action.stockDelta : existing.stock,
        // Advances this item's local clock baseline so the *next* queued
        // write for the same item (before any server round-trip) builds
        // on this one instead of racing it — see useOfflineQueue.
        vector_clock: action.vectorClock,
        optimistic: true,
      };
      if (action.field) {
        (nextItem as unknown as Record<string, unknown>)[action.field] = action.value;
      }
      return { ...state, items: { ...state.items, [action.itemId]: nextItem } };
    }

    case "queue_entry_added":
      return { ...state, queue: [...state.queue, action.entry] };

    case "queue_entry_status":
      return {
        ...state,
        queue: state.queue.map((entry) =>
          entry.idempotencyKey === action.idempotencyKey ? { ...entry, status: action.status } : entry,
        ),
      };

    case "queue_entry_removed":
      return { ...state, queue: state.queue.filter((entry) => entry.idempotencyKey !== action.idempotencyKey) };

    case "queue_restored":
      return { ...state, queue: action.entries };

    case "browser_online_changed":
      return { ...state, connectivity: { ...state.connectivity, browserOnline: action.online } };

    case "toggle_offline":
      return { ...state, connectivity: { ...state.connectivity, manualOffline: !state.connectivity.manualOffline } };

    default:
      return state;
  }
}

interface ShopContextValue {
  state: ShopState;
  dispatch: Dispatch<ShopAction>;
}

const ShopContext = createContext<ShopContextValue | undefined>(undefined);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <ShopContext.Provider value={{ state, dispatch }}>{children}</ShopContext.Provider>;
}

export function useShopContext(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShopContext must be used within a ShopProvider");
  return ctx;
}
