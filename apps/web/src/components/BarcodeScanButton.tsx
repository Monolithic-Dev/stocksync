import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { DisplayItem } from "../state/ShopContext";
import { AlertTriangleIcon, ScanIcon } from "./icons";

export interface BarcodeScanButtonProps {
  items: DisplayItem[];
  onResolved: (itemId: string) => void;
}

type ScanState = "idle" | "scanning" | "not_recognized" | "permission_denied";

/**
 * Camera-based barcode/QR quick-entry (Tier 2 item 2.9, FR-23). Resolves a
 * scanned code to a real item_id by exact match against the already-loaded
 * item list, then hands off to the caller — this component never calls
 * submitTransaction itself and never creates a new transaction type, it's
 * purely an alternate way to pick an item_id for the existing sell/restock
 * buttons, so all of Phase 4's validation applies completely unchanged.
 *
 * Matches against item_id only for now: Tier 1's SyncItem has no `sku`
 * field (that lives on Tier 2's not-yet-built `products` table) — extend
 * the match to also check `sku` once that exists.
 */
export function BarcodeScanButton({ items, onResolved }: BarcodeScanButtonProps) {
  const [state, setState] = useState<ScanState>("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (state !== "scanning") return;

    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (cancelled || !result) return;
        const code = result.getText();
        const match = items.find((item) => item.item_id === code);
        if (!match) {
          setState("not_recognized"); // never guess — fall back to manual selection
          return;
        }
        controlsRef.current?.stop();
        setState("idle");
        onResolved(match.item_id);
      })
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      })
      .catch(() => {
        if (!cancelled) setState("permission_denied");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [state, items, onResolved]);

  if (state === "scanning") {
    return (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-2">
        <video ref={videoRef} data-testid="scan-video" className="w-full rounded-md" muted playsInline />
        <button
          type="button"
          onClick={() => setState("idle")}
          className="mt-2 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setState("scanning")}
        className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
      >
        <ScanIcon className="h-4 w-4" />
        Scan barcode/QR
      </button>
      {state === "not_recognized" && (
        <p data-testid="scan-not-recognized" className="mt-1.5 flex items-center gap-1 text-xs text-amber-700">
          <AlertTriangleIcon className="h-3 w-3 shrink-0" />
          Item not recognized — pick it from the list below instead.
        </p>
      )}
      {state === "permission_denied" && (
        <p data-testid="scan-permission-denied" className="mt-1.5 flex items-center gap-1 text-xs text-rose-700">
          <AlertTriangleIcon className="h-3 w-3 shrink-0" />
          Camera access denied — pick the item from the list below instead.
        </p>
      )}
    </div>
  );
}
