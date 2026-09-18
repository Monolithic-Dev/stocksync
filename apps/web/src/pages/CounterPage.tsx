import { useEffect, useMemo, useState } from "react";
import type { ConflictCandidatesDTO } from "@stocksync/core";
import { useShopContext, type DisplayItem } from "../state/ShopContext";
import { useConnectivity } from "../hooks/useConnectivity";
import { useOfflineQueue } from "../hooks/useOfflineQueue";
import { useReplayOnReconnect } from "../offline/replay";
import { useWebSocketSync } from "../hooks/useWebSocketSync";
import { getSync } from "../api/client";
import { ItemCard } from "../components/ItemCard";
import { ConnectivityToggle } from "../components/ConnectivityToggle";
import { QueueDrawer } from "../components/QueueDrawer";
import { ConflictReviewPanel } from "../components/ConflictReviewPanel";
import { AuditLogView } from "../components/AuditLogView";
import { BarcodeScanButton } from "../components/BarcodeScanButton";
import { AlertTriangleIcon, BoxIcon, ClockHistoryIcon, ScanIcon } from "../components/icons";

function useQueryParam(name: string, fallback: string): string {
  return useMemo(() => new URLSearchParams(window.location.search).get(name) ?? fallback, [name, fallback]);
}

function hasConflictCandidates(
  item: DisplayItem,
): item is DisplayItem & { conflict_candidates: ConflictCandidatesDTO } {
  return item.conflict_status === "needs_review" && item.conflict_candidates !== undefined;
}

/**
 * Assembles the offline queue, connectivity toggle, live items, conflict
 * review, and audit trail into one screen representing "one counter." The
 * demo runs two browser windows of this same page with different
 * counter_id query params (?shop_id=...&counter_id=...).
 */
export function CounterPage() {
  const shopId = useQueryParam("shop_id", "demo-shop");
  const counterId = useQueryParam("counter_id", "counter_a");

  const { state, dispatch } = useShopContext();
  const { isOnline, toggleOffline } = useConnectivity();
  const { submitTransaction, replayQueue } = useOfflineQueue(shopId, counterId, isOnline);
  useReplayOnReconnect(isOnline, replayQueue);
  useWebSocketSync(shopId, counterId, isOnline);

  const [auditItemId, setAuditItemId] = useState<string | undefined>(undefined);
  const [scannedItemId, setScannedItemId] = useState<string | undefined>(undefined);

  useEffect(() => {
    getSync(shopId, counterId)
      .then((response) => dispatch({ type: "sync_loaded", items: response.items }))
      .catch(() => dispatch({ type: "sync_failed" }));
  }, [shopId, counterId, dispatch]);

  const items = Object.values(state.items).sort((a, b) => a.item_id.localeCompare(b.item_id));
  const conflictedItems = items.filter(hasConflictCandidates);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <BoxIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight text-slate-900 sm:text-xl">StockSync Counter</h1>
            <p className="flex items-center gap-1.5 text-sm text-slate-500">
              <span>{shopId}</span>
              <span className="text-slate-300">·</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{counterId}</span>
            </p>
          </div>
        </div>
        <ConnectivityToggle isOnline={isOnline} onToggle={toggleOffline} />
      </header>

      {state.syncStatus === "loading" && (
        <p className="mb-4 flex items-center gap-2 text-sm text-slate-400">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
          Loading inventory…
        </p>
      )}
      {state.syncStatus === "error" && (
        <p className="mb-4 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" />
          Couldn't load inventory. Check the connection and try again.
        </p>
      )}

      {conflictedItems.length > 0 && (
        <section className="mb-6 space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <AlertTriangleIcon className="h-4 w-4" />
            Needs your review
          </h2>
          {conflictedItems.map((item) => (
            <ConflictReviewPanel
              key={item.item_id}
              itemId={item.item_id}
              shopId={shopId}
              counterId={counterId}
              candidates={item.conflict_candidates}
              onResolved={() => {
                // The authoritative outcome arrives via the next GET /sync
                // or WebSocket push — this panel doesn't optimistically
                // clear itself, since a human decision on a real conflict
                // deserves server confirmation before the UI moves on.
              }}
            />
          ))}
        </section>
      )}

      <section className="mb-4">
        {/* Pre-fills the sell/restock choice per 13a's spec — a scan
            resolves an item_id, it never assumes which action the
            counter wants (or a quantity), so both remain the same
            explicit clicks as picking the item from the list below. */}
        <BarcodeScanButton items={items} onResolved={(itemId) => setScannedItemId(itemId)} />
        {scannedItemId && (
          <div className="mt-2 flex animate-[fadeIn_150ms_ease-out] items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 p-2 text-sm">
            <ScanIcon className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="flex-1 text-indigo-900">
              Scanned: <span className="font-medium">{items.find((item) => item.item_id === scannedItemId)?.name ?? scannedItemId}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                void submitTransaction({ itemId: scannedItemId, type: "sale", quantity: 1 });
                setScannedItemId(undefined);
              }}
              className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-slate-700 active:scale-95"
            >
              Sell 1
            </button>
            <button
              type="button"
              onClick={() => {
                void submitTransaction({ itemId: scannedItemId, type: "restock", quantity: 1 });
                setScannedItemId(undefined);
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 active:scale-95"
            >
              Restock 1
            </button>
            <button
              type="button"
              onClick={() => setScannedItemId(undefined)}
              className="text-xs text-indigo-400 hover:text-indigo-600"
            >
              Cancel
            </button>
          </div>
        )}
      </section>

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <ItemCard
            key={item.item_id}
            item={item}
            highlighted={item.item_id === scannedItemId}
            onSell={(itemId) => void submitTransaction({ itemId, type: "sale", quantity: 1 })}
            onRestock={(itemId) => void submitTransaction({ itemId, type: "restock", quantity: 1 })}
            onFieldUpdate={(itemId, field, value) => void submitTransaction({ itemId, type: "field_update", field, value })}
          />
        ))}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <BoxIcon className="h-4 w-4 text-slate-400" />
          Pending queue
        </h2>
        <QueueDrawer entries={state.queue} />
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <ClockHistoryIcon className="h-4 w-4 text-slate-400" />
          Audit trail
        </h2>
        <div className="mb-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item.item_id}
              type="button"
              onClick={() => setAuditItemId(item.item_id)}
              className={`rounded-md border px-2 py-1 text-xs ${
                auditItemId === item.item_id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.item_id}
            </button>
          ))}
        </div>
        {auditItemId ? (
          <AuditLogView itemId={auditItemId} shopId={shopId} />
        ) : (
          <p className="text-sm text-slate-400">Pick an item to view its history.</p>
        )}
      </section>
    </div>
  );
}
