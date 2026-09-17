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

  useEffect(() => {
    getSync(shopId, counterId)
      .then((response) => dispatch({ type: "sync_loaded", items: response.items }))
      .catch(() => dispatch({ type: "sync_failed" }));
  }, [shopId, counterId, dispatch]);

  const items = Object.values(state.items).sort((a, b) => a.item_id.localeCompare(b.item_id));
  const conflictedItems = items.filter(hasConflictCandidates);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">StockSync Counter</h1>
          <p className="text-sm text-slate-500">
            {shopId} · {counterId}
          </p>
        </div>
        <ConnectivityToggle isOnline={isOnline} onToggle={toggleOffline} />
      </header>

      {state.syncStatus === "loading" && <p className="text-sm text-slate-400">Loading inventory…</p>}
      {state.syncStatus === "error" && (
        <p className="text-sm text-rose-600">Couldn't load inventory. Check the connection and try again.</p>
      )}

      {conflictedItems.length > 0 && (
        <section className="mb-6 space-y-3">
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
        <BarcodeScanButton
          items={items}
          onResolved={(itemId) => void submitTransaction({ itemId, type: "sale", quantity: 1 })}
        />
      </section>

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <ItemCard
            key={item.item_id}
            item={item}
            onSell={(itemId) => void submitTransaction({ itemId, type: "sale", quantity: 1 })}
            onRestock={(itemId) => void submitTransaction({ itemId, type: "restock", quantity: 1 })}
            onFieldUpdate={(itemId, field, value) => void submitTransaction({ itemId, type: "field_update", field, value })}
          />
        ))}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Pending queue</h2>
        <QueueDrawer entries={state.queue} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Audit trail</h2>
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
