import { useEffect, useRef } from "react";
import { connectWebSocket, parseWsPushMessage } from "../api/client";
import { useShopContext } from "../state/ShopContext";

const RECONNECT_DELAY_MS = 2000;

/**
 * Live push transport for record_updated/needs_review (04-API-SPEC.md
 * §2). Only connects while `isOnline` is true — a real offline device
 * wouldn't receive WebSocket pushes either, so the demo's manual
 * connectivity toggle closing this connection is the correct behavior,
 * not a bug to route around.
 */
export function useWebSocketSync(shopId: string, counterId: string, isOnline: boolean): void {
  const { dispatch } = useShopContext();
  const socketRef = useRef<WebSocket | undefined>(undefined);

  useEffect(() => {
    if (!isOnline) {
      socketRef.current?.close();
      socketRef.current = undefined;
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect(): void {
      if (cancelled) return;
      const socket = connectWebSocket(shopId, counterId);
      socketRef.current = socket;

      socket.addEventListener("message", (event) => {
        const raw = typeof event.data === "string" ? event.data : "";
        const message = parseWsPushMessage(raw);
        if (message) dispatch({ type: "ws_message", message });
      });

      socket.addEventListener("close", () => {
        if (cancelled) return;
        // A dropped connection while still "online" is a transient
        // network blip, not a signal to give up — keep retrying so a
        // real reconnect resumes live updates without a page reload.
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = undefined;
    };
  }, [shopId, counterId, isOnline, dispatch]);
}
