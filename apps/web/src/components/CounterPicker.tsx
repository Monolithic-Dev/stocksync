import { useState } from "react";
import { ArrowRightIcon } from "./icons";

export interface CounterPickerProps {
  onEnter: (counterId: string) => void;
}

const PRESET_COUNTERS = [
  { id: "counter_a", label: "Counter A" },
  { id: "counter_b", label: "Counter B" },
];

/**
 * Post-login step (App.tsx, once a user is signed in) — which physical
 * counter this browser session is running as. Shop identity is no longer
 * picked here (it comes from the signed-in account's custom:shop_id
 * claim); this only ever asks for counter_id, matching the two-window
 * conflict demo's README scenario (open two counters of the *same*
 * signed-in shop, take one offline, sell the same item from both).
 */
export function CounterPicker({ onEnter }: CounterPickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [counterId, setCounterId] = useState("");

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Which counter is this?</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Open this in a second window as the other counter to try the offline-conflict demo — take one offline, sell
        the same item from both, then reconnect and watch it converge.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {PRESET_COUNTERS.map((counter) => (
          <button
            key={counter.id}
            type="button"
            onClick={() => onEnter(counter.id)}
            className="flex flex-col items-center gap-1 rounded-lg border-2 border-indigo-200 bg-indigo-50 px-4 py-4 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-100 active:scale-95 dark:border-indigo-900 dark:bg-indigo-950/50 dark:hover:border-indigo-700 dark:hover:bg-indigo-900/50"
          >
            <span className="text-lg font-bold text-indigo-900 dark:text-indigo-300">{counter.label}</span>
          </button>
        ))}
      </div>

      {!showCustom ? (
        <button
          type="button"
          onClick={() => setShowCustom(true)}
          className="mt-4 text-sm text-slate-500 underline decoration-dotted hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Use a custom counter ID instead
        </button>
      ) : (
        <form
          className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (counterId.trim()) onEnter(counterId.trim());
          }}
        >
          <input
            value={counterId}
            onChange={(event) => setCounterId(event.target.value)}
            placeholder="counter id"
            aria-label="Counter ID"
            className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={!counterId.trim()}
            className="flex items-center justify-center gap-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-40"
          >
            Enter <ArrowRightIcon className="h-3.5 w-3.5" />
          </button>
        </form>
      )}
    </div>
  );
}
