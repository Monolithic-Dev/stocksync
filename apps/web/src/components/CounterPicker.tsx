import { useState } from "react";
import { ArrowRightIcon } from "./icons";

export interface CounterPickerProps {
  onEnter: (shopId: string, counterId: string) => void;
}

const DEFAULT_SHOP_ID = "demo-shop";

const PRESET_COUNTERS = [
  { id: "counter_a", label: "Counter A" },
  { id: "counter_b", label: "Counter B" },
];

/**
 * The demo's real entry point: two preset counters matching the README's
 * shareable-link scenario (?shop_id=demo-shop&counter_id=counter_a / _b),
 * plus a custom-ID escape hatch for anyone who wants to point this at a
 * different shop/counter pair.
 */
export function CounterPicker({ onEnter }: CounterPickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [shopId, setShopId] = useState(DEFAULT_SHOP_ID);
  const [counterId, setCounterId] = useState("");

  return (
    <div id="try-it" className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-bold text-slate-900">Try it yourself</h2>
      <p className="mt-1 text-sm text-slate-600">
        Open this in two browser windows as two different counters, take one offline, sell the same item from both —
        then reconnect and watch it converge.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {PRESET_COUNTERS.map((counter) => (
          <button
            key={counter.id}
            type="button"
            onClick={() => onEnter(DEFAULT_SHOP_ID, counter.id)}
            className="flex flex-col items-center gap-1 rounded-lg border-2 border-indigo-200 bg-indigo-50 px-4 py-4 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-100 active:scale-95"
          >
            <span className="text-lg font-bold text-indigo-900">{counter.label}</span>
            <span className="text-xs text-indigo-600">{DEFAULT_SHOP_ID}</span>
          </button>
        ))}
      </div>

      {!showCustom ? (
        <button
          type="button"
          onClick={() => setShowCustom(true)}
          className="mt-4 text-sm text-slate-500 underline decoration-dotted hover:text-slate-700"
        >
          Use a custom shop / counter ID instead
        </button>
      ) : (
        <form
          className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (counterId.trim()) onEnter(shopId.trim() || DEFAULT_SHOP_ID, counterId.trim());
          }}
        >
          <input
            value={shopId}
            onChange={(event) => setShopId(event.target.value)}
            placeholder="shop id"
            aria-label="Shop ID"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={counterId}
            onChange={(event) => setCounterId(event.target.value)}
            placeholder="counter id"
            aria-label="Counter ID"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
