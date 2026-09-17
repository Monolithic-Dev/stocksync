import { useCallback, useEffect } from "react";
import { useShopContext } from "../state/ShopContext";

export interface ConnectivityState {
  isOnline: boolean;
  toggleOffline: () => void;
}

/**
 * Wraps navigator.onLine AND a manual override held in ShopContext, since
 * a real demo needs a repeatable, in-UI way to go offline — DevTools
 * network throttling isn't a controllable, repeatable demo mechanism
 * (phase-6 doc). Effective connectivity is "online" only when the browser
 * reports connectivity AND the user hasn't manually forced offline mode.
 */
export function useConnectivity(): ConnectivityState {
  const { state, dispatch } = useShopContext();

  useEffect(() => {
    const handleOnline = () => dispatch({ type: "browser_online_changed", online: true });
    const handleOffline = () => dispatch({ type: "browser_online_changed", online: false });
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [dispatch]);

  const toggleOffline = useCallback(() => dispatch({ type: "toggle_offline" }), [dispatch]);

  return { isOnline: state.connectivity.browserOnline && !state.connectivity.manualOffline, toggleOffline };
}
