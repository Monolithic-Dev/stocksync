import { useEffect, useRef } from "react";

/**
 * Fires `replayQueue` on the rising edge of `isOnline` (false → true).
 * `isOnline` is a derived value (browser connectivity AND the manual
 * toggle — see useConnectivity/ShopContext), so watching its transition
 * here already covers both reconnect triggers the phase-6 doc calls
 * for — a real `window.addEventListener("online", ...)` event and the
 * manual toggle's "go online" click — without needing two separate
 * listeners that could otherwise both fire and double-replay.
 */
export function useReplayOnReconnect(isOnline: boolean, replayQueue: () => Promise<void>): void {
  const wasOnline = useRef(isOnline);

  useEffect(() => {
    if (isOnline && !wasOnline.current) {
      void replayQueue();
    }
    wasOnline.current = isOnline;
  }, [isOnline, replayQueue]);
}
