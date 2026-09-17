import { useEffect } from "react";
import type { QueueDisplayEntry } from "../state/ShopContext";
import { useShopContext } from "../state/ShopContext";

const RECONCILED_DISMISS_MS = 4000;

const STATUS_LABEL: Record<QueueDisplayEntry["status"], string> = {
  queued: "Queued",
  replaying: "Replaying…",
  reconciled: "Reconciled",
};

const STATUS_STYLE: Record<QueueDisplayEntry["status"], string> = {
  queued: "bg-slate-100 text-slate-700",
  replaying: "bg-sky-100 text-sky-800",
  reconciled: "bg-emerald-100 text-emerald-800",
};

export interface QueueDrawerProps {
  entries: QueueDisplayEntry[];
}

/** Pending local transactions, transitioning Queued → Replaying… → Reconciled as they move through the pipeline. */
export function QueueDrawer({ entries }: QueueDrawerProps) {
  const { dispatch } = useShopContext();

  // Reconciled entries are terminal — a static label satisfies the DoD
  // (per phase-6's time-budget note, this is the polish item to cut
  // first, so no animation, just a plain timed dismissal so the drawer
  // doesn't accumulate forever during a long demo).
  useEffect(() => {
    const timers = entries
      .filter((entry) => entry.status === "reconciled")
      .map((entry) =>
        setTimeout(() => dispatch({ type: "queue_entry_removed", idempotencyKey: entry.idempotencyKey }), RECONCILED_DISMISS_MS),
      );
    return () => timers.forEach(clearTimeout);
  }, [entries, dispatch]);

  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">Nothing queued — everything is synced.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li
          key={entry.idempotencyKey}
          className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <span className="text-slate-700">
            {entry.type} · {entry.itemId}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[entry.status]}`}>
            {STATUS_LABEL[entry.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}
