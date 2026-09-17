import { useEffect, useState } from "react";
import type { AuditHistoryEntry } from "@stocksync/core";
import { getAudit } from "../api/client";
import { VectorClockExplainer } from "./VectorClockExplainer";

export interface AuditLogViewProps {
  itemId: string;
  shopId: string;
}

function formatDetails(details: unknown): string {
  if (details === null || details === undefined) return "";
  if (typeof details === "object") return Object.entries(details as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(", ");
  return String(details);
}

/** The demo's proof-of-correctness screen — the full chronological history for one item (GET /audit/{item_id}). */
export function AuditLogView({ itemId, shopId }: AuditLogViewProps) {
  const [history, setHistory] = useState<AuditHistoryEntry[] | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHistory(undefined);
    setError(false);
    getAudit(itemId, shopId)
      .then((response) => {
        if (!cancelled) setHistory(response.history);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, shopId]);

  if (error) return <p className="text-sm text-rose-600">Couldn't load history for {itemId}.</p>;
  if (!history) return <p className="text-sm text-slate-400">Loading history…</p>;
  if (history.length === 0) return <p className="text-sm text-slate-400">No history yet for {itemId}.</p>;

  return (
    <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
      {history.map((entry, index) => (
        <li key={`${entry.timestamp}-${index}`} className="text-sm">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-slate-900">{entry.action}</span>
            <span className="text-xs text-slate-500">{entry.counter_id}</span>
            <span className="text-xs text-slate-400">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          </div>
          <p className="text-slate-600">{formatDetails(entry.details)}</p>
          <details>
            <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">Why?</summary>
            <VectorClockExplainer entry={entry} />
          </details>
        </li>
      ))}
    </ol>
  );
}
