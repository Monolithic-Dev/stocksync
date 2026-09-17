import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShopProvider, useShopContext } from "../../src/state/ShopContext";
import { useOfflineQueue } from "../../src/hooks/useOfflineQueue";
import { clearPending, listPending } from "../../src/offline/db";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

function useHarness(isOnline: boolean) {
  const shop = useShopContext();
  const queue = useOfflineQueue("demo-shop", "counter_a", isOnline);
  return { shop, queue };
}

function setup(isOnline: boolean) {
  const rendered = renderHook(() => useHarness(isOnline), { wrapper: ShopProvider });

  act(() => {
    rendered.result.current.shop.dispatch({
      type: "sync_loaded",
      items: [{ item_id: "parle-g", stock: 40, field_last_writer: {}, conflict_status: "none", vector_clock: { counter_a: 1 } }],
    });
  });

  return rendered;
}

afterEach(async () => {
  vi.restoreAllMocks();
  const pending = await listPending();
  await Promise.all(pending.map((entry) => clearPending(entry.idempotencyKey)));
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("useOfflineQueue", () => {
  it("submits directly and marks the entry reconciled when online", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ results: [{ idempotency_key: "whatever", status: "queued" }] }),
    );

    const { result } = setup(true);

    await act(async () => {
      await result.current.queue.submitTransaction({ itemId: "parle-g", type: "sale", quantity: 5 });
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.shop.state.queue).toHaveLength(1);
    expect(result.current.shop.state.queue[0].status).toBe("reconciled");
    // Optimistic stock delta applied immediately.
    expect(result.current.shop.state.items["parle-g"].stock).toBe(35);

    const pending = await listPending();
    expect(pending).toHaveLength(0);
  });

  it("enqueues to IndexedDB instead of calling fetch when offline", async () => {
    const { result } = setup(false);

    await act(async () => {
      await result.current.queue.submitTransaction({ itemId: "parle-g", type: "sale", quantity: 5 });
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.shop.state.queue[0].status).toBe("queued");
    expect(result.current.shop.state.items["parle-g"].stock).toBe(35);
    expect(result.current.shop.state.items["parle-g"].optimistic).toBe(true);

    const pending = await listPending();
    expect(pending).toHaveLength(1);
  });

  it("falls back to the durable queue under the same idempotency key when the online submit fails (edge case C-1)", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network drop"));

    const { result } = setup(true);

    await act(async () => {
      await result.current.queue.submitTransaction({ itemId: "parle-g", type: "sale", quantity: 5 });
    });

    expect(result.current.shop.state.queue[0].status).toBe("queued");
    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].idempotencyKey).toBe(result.current.shop.state.queue[0].idempotencyKey);
  });

  it("replayQueue submits every pending entry as one batch, oldest first, and clears each on success", async () => {
    const { result } = setup(false);

    await act(async () => {
      await result.current.queue.submitTransaction({ itemId: "parle-g", type: "sale", quantity: 5 });
    });
    await act(async () => {
      await result.current.queue.submitTransaction({ itemId: "parle-g", type: "restock", quantity: 2 });
    });

    const queuedKeys = result.current.shop.state.queue.map((entry) => entry.idempotencyKey);
    expect(queuedKeys).toHaveLength(2);

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ results: queuedKeys.map((key) => ({ idempotency_key: key, status: "queued" as const })) }),
    );

    await act(async () => {
      await result.current.queue.replayQueue();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((requestInit as RequestInit).body as string) as { transactions: { idempotency_key: string }[] };
    expect(body.transactions.map((t) => t.idempotency_key)).toEqual(queuedKeys);

    await waitFor(async () => {
      expect(await listPending()).toHaveLength(0);
    });
    expect(result.current.shop.state.queue.every((entry) => entry.status === "reconciled")).toBe(true);
  });

  it("resumes a queue left over from a previous session on mount (edge case C-2)", async () => {
    const seeded = setup(false);
    await act(async () => {
      await seeded.result.current.queue.submitTransaction({ itemId: "parle-g", type: "sale", quantity: 1 });
    });
    expect(seeded.result.current.shop.state.queue).toHaveLength(1);

    // A fresh render (its own ShopProvider tree) simulates reopening the
    // tab — IndexedDB persists across that, ShopContext's in-memory state
    // does not.
    const reopened = renderHook(() => useHarness(false), { wrapper: ShopProvider });

    await waitFor(() => {
      expect(reopened.result.current.shop.state.queue).toHaveLength(1);
    });
    expect(reopened.result.current.shop.state.queue[0].status).toBe("queued");
  });
});
