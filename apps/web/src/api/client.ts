import type {
  AuditHistoryEntry,
  Category,
  Product,
  Supplier,
  SyncItem,
  TransactionInput,
  TransactionResultDTO,
  WsPushMessage,
} from "@stocksync/core";
import { getTokens } from "../lib/tokenStore";

// Vite exposes only VITE_-prefixed env vars to client code. Falling back to
// "" keeps local dev usable before a real API Gateway URL is configured —
// requests simply fail with a clear network error instead of a build-time
// crash.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";
const WEBSOCKET_URL: string = import.meta.env.VITE_WEBSOCKET_URL ?? "";
const API_KEY: string = import.meta.env.VITE_API_KEY ?? "";

function headers(): HeadersInit {
  const idToken = getTokens()?.idToken;
  return {
    "content-type": "application/json",
    "x-api-key": API_KEY,
    ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
  };
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
  const idToken = getTokens()?.idToken;
  const params = new URLSearchParams({
    shop_id: shopId,
    counter_id: counterId,
    ...(idToken ? { token: idToken } : {}),
  });
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

// ---- Tier 2 CRUD (19b, 04-API-SPEC.md §5.1) — one thin client per
// resource, all built on the same shape since products/categories/
// suppliers share an identical REST pattern server-side (crudTable.ts). ----

function crudApi<T>(resourcePath: string) {
  return {
    list: async (shopId: string, extraParams: Record<string, string> = {}): Promise<T[]> => {
      const params = new URLSearchParams({ shop_id: shopId, ...extraParams });
      const response = await fetch(`${API_BASE_URL}/${resourcePath}?${params.toString()}`, { headers: headers() });
      if (!response.ok) throw new Error(`GET /${resourcePath} failed: ${response.status}`);
      const { items } = (await response.json()) as { items: T[] };
      return items;
    },
    create: async (shopId: string, fields: Partial<T>): Promise<T> => {
      const response = await fetch(`${API_BASE_URL}/${resourcePath}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ shop_id: shopId, ...fields }),
      });
      if (!response.ok) throw new Error(`POST /${resourcePath} failed: ${response.status}`);
      return (await response.json()) as T;
    },
    update: async (shopId: string, id: string, fields: Partial<T>): Promise<T> => {
      const response = await fetch(`${API_BASE_URL}/${resourcePath}/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ shop_id: shopId, ...fields }),
      });
      if (!response.ok) throw new Error(`PUT /${resourcePath}/${id} failed: ${response.status}`);
      return (await response.json()) as T;
    },
    remove: async (shopId: string, id: string): Promise<void> => {
      const params = new URLSearchParams({ shop_id: shopId });
      const response = await fetch(`${API_BASE_URL}/${resourcePath}/${encodeURIComponent(id)}?${params.toString()}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!response.ok) throw new Error(`DELETE /${resourcePath}/${id} failed: ${response.status}`);
    },
  };
}

export const productsApi = crudApi<Product>("products");
export const categoriesApi = crudApi<Category>("categories");
export const suppliersApi = crudApi<Supplier>("suppliers");

export interface CheckoutLineItem {
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface CheckoutResponse {
  order_id: string;
  total_amount: number;
  status: "completed";
}

/** POST /checkout (19b, 04-API-SPEC.md §5.2). */
export async function postCheckout(
  shopId: string,
  counterId: string,
  lineItems: CheckoutLineItem[],
): Promise<CheckoutResponse> {
  const response = await fetch(`${API_BASE_URL}/checkout`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ shop_id: shopId, counter_id: counterId, line_items: lineItems }),
  });
  if (!response.ok) {
    throw new Error(`POST /checkout failed: ${response.status}`);
  }
  return (await response.json()) as CheckoutResponse;
}

export interface StaffInviteResponse {
  email: string;
  role: "manager" | "counter_staff";
  shop_id: string;
}

/** POST /staff (owner-only — server-side enforced via authContext.ts's canInviteStaff, this is just the client call). */
export async function postStaffInvite(email: string, role: "manager" | "counter_staff"): Promise<StaffInviteResponse> {
  const response = await fetch(`${API_BASE_URL}/staff`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, role }),
  });
  if (!response.ok) {
    throw new Error(`POST /staff failed: ${response.status}`);
  }
  return (await response.json()) as StaffInviteResponse;
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
