import { WifiIcon, WifiOffIcon } from "./icons";

export interface ConnectivityToggleProps {
  isOnline: boolean;
  onToggle: () => void;
}

/**
 * The real, visible, clickable online/offline switch — a first-class demo
 * control, not a debug checkbox (phase-6 doc, 10-DEMO-PLAN.md). DevTools
 * network throttling isn't a controllable, repeatable demo mechanism, so
 * this is the only way the demo ever goes offline.
 */
export function ConnectivityToggle({ isOnline, onToggle }: ConnectivityToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!isOnline}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition-colors active:scale-95 ${
        isOnline ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-rose-600 text-white hover:bg-rose-700"
      }`}
    >
      {isOnline ? <WifiIcon className="h-4 w-4" /> : <WifiOffIcon className="h-4 w-4" />}
      {isOnline ? "Online" : "Offline"}
      <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-white" : "bg-white animate-pulse"}`} />
    </button>
  );
}
