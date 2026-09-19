import { useEffect, useState } from "react";
import type { QueueDisplayEntry } from "../state/ShopContext";
import { useShopContext } from "../state/ShopContext";
import { CheckCircleIcon } from "./icons";

const RECONCILED_DISMISS_MS = 4000;
const FADE_OUT_MS = 300;

const STATUS_LABEL: Record<QueueDisplayEntry["status"], string> = {
  queued: "Queued",
  replaying: "Replaying…",
  reconciled: "Reconciled",
};

const STATUS_STYLE: Record<QueueDisplayEntry["status"], string> = {
  queued: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  replaying: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  reconciled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

export interface QueueDrawerProps {
  entries: QueueDisplayEntry[];
}

/** Pending local transactions, transitioning Queued → Replaying… → Reconciled as they move through the pipeline. */
export function QueueDrawer({ entries }: QueueDrawerProps) {
  const { dispatch } = useShopContext();
  const [leavingKeys, setLeavingKeys] = useState<Set<string>>(new Set());

  // Reconciled entries are terminal: they get a brief fadeOutDown (defined
  // in index.css) just before removal, so the drawer doesn't accumulate
  // forever during a long demo but also doesn't just pop entries away.
  useEffect(() => {
    const reconciled = entries.filter((entry) => entry.status === "reconciled");
    const fadeTimers = reconciled.map((entry) =>
      setTimeout(() => {
        setLeavingKeys((prev) => new Set(prev).add(entry.idempotencyKey));
      }, RECONCILED_DISMISS_MS - FADE_OUT_MS),
    );
    const removeTimers = reconciled.map((entry) =>
      setTimeout(() => dispatch({ type: "queue_entry_removed", idempotencyKey: entry.idempotencyKey }), RECONCILED_DISMISS_MS),
    );
    return () => {
      fadeTimers.forEach(clearTimeout);
      removeTimers.forEach(clearTimeout);
    };
  }, [entries, dispatch]);

  if (entries.length === 0) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">Nothing queued — everything is synced.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li
          key={entry.idempotencyKey}
          className={`flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900 ${
            leavingKeys.has(entry.idempotencyKey) ? "animate-[fadeOutDown_300ms_ease-in_forwards]" : ""
          }`}
        >
          <span className="text-slate-700 dark:text-slate-300">
            {entry.type} · {entry.itemId}
          </span>
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[entry.status]}`}>
            {entry.status === "reconciled" && <CheckCircleIcon className="h-3 w-3" />}
            {entry.status === "replaying" && (
              <span className="h-2 w-2 animate-spin rounded-full border-[1.5px] border-sky-400 border-t-sky-800" />
            )}
            {STATUS_LABEL[entry.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}
