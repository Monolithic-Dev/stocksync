import type { AuditHistoryEntry, SyncItem, TransactionInput, TransactionResultDTO, WsPushMessage } from "@stocksync/core";

// Vite exposes only VITE_-prefixed env vars to client code. Falling back to
// "" keeps local dev usable before a real API Gateway URL is configured —
// requests simply fail with a clear network error instead of a build-time
// crash.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";
const WEBSOCKET_URL: string = import.meta.env.VITE_WEBSOCKET_URL ?? "";
const API_KEY: string = import.meta.env.VITE_API_KEY ?? "";

function headers(): HeadersInit {
  return { "content-type": "application/json", "x-api-key": API_KEY };
}

export interface TransactionsResponse {
  results: TransactionResultDTO[];
}

/** POST /transactions (04-API-SPEC.md §1) — submits a batch as one request. */
export async function postTransactions(
  shopId: string,
  counterId: string,
  transactions: TransactionInput[],
): Promise<TransactionsResponse> {
  const response = await fetch(`${API_BASE_URL}/transactions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ shop_id: shopId, counter_id: counterId, transactions }),
  });
  if (!response.ok) {
    throw new Error(`POST /transactions failed: ${response.status}`);
  }
  return (await response.json()) as TransactionsResponse;
}

export interface SyncResponse {
  items: SyncItem[];
}

/** GET /sync (04-API-SPEC.md §1) — the reconnect/initial-load read path. */
export async function getSync(shopId: string, counterId: string): Promise<SyncResponse> {
  const params = new URLSearchParams({ shop_id: shopId, counter_id: counterId });
  const response = await fetch(`${API_BASE_URL}/sync?${params.toString()}`, { headers: headers() });
  if (!response.ok) {
    throw new Error(`GET /sync failed: ${response.status}`);
  }
  return (await response.json()) as SyncResponse;
}

export interface AuditResponse {
  item_id: string;
  history: AuditHistoryEntry[];
}

/** GET /audit/{item_id} (04-API-SPEC.md §1) — powers AuditLogView. */
export async function getAudit(itemId: string, shopId: string): Promise<AuditResponse> {
  const params = new URLSearchParams({ shop_id: shopId });
  const response = await fetch(`${API_BASE_URL}/audit/${encodeURIComponent(itemId)}?${params.toString()}`, {
    headers: headers(),
  });
  if (!response.ok) {
    throw new Error(`GET /audit/${itemId} failed: ${response.status}`);
  }
  return (await response.json()) as AuditResponse;
}

/**
 * Opens the WebSocket connection for this counter (04-API-SPEC.md §2).
 * Returns the raw WebSocket — useWebSocketSync owns reconnect/lifecycle
 * logic, this function's only job is building the correctly-shaped URL.
 */
export function connectWebSocket(shopId: string, counterId: string): WebSocket {
  const params = new URLSearchParams({ shop_id: shopId, counter_id: counterId });
  return new WebSocket(`${WEBSOCKET_URL}?${params.toString()}`);
}

export interface ConflictResolveResponse {
  item_id: string;
  field: string;
  status: "resolved";
  value: unknown;
}

/**
 * POST /conflicts/{item_id}/resolve (04-API-SPEC.md §1) — not implemented
 * server-side until Phase 8's conflictResolve.ts lands; ConflictReviewPanel
 * calls this now per the phase-6 task breakdown so the "pick one" action
 * is already wired once that handler exists, rather than adding it later.
 */
export async function postConflictResolve(
  itemId: string,
  shopId: string,
  field: string,
  chosenValue: unknown,
  resolvedBy: string,
): Promise<ConflictResolveResponse> {
  const response = await fetch(`${API_BASE_URL}/conflicts/${encodeURIComponent(itemId)}/resolve`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ shop_id: shopId, field, chosen_value: chosenValue, resolved_by: resolvedBy }),
  });
  if (!response.ok) {
    throw new Error(`POST /conflicts/${itemId}/resolve failed: ${response.status}`);
  }
  return (await response.json()) as ConflictResolveResponse;
}

export function parseWsPushMessage(raw: string): WsPushMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      (parsed.type === "record_updated" || parsed.type === "needs_review")
    ) {
      return parsed as WsPushMessage;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
