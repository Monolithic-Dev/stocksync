import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShopProvider, useShopContext } from "../../src/state/ShopContext";

function setup() {
  return renderHook(() => useShopContext(), { wrapper: ShopProvider });
}

describe("ShopContext reducer", () => {
  it("sync_loaded replaces items keyed by item_id", () => {
    const { result } = setup();

    act(() => {
      result.current.dispatch({
        type: "sync_loaded",
        items: [
          { item_id: "parle-g", stock: 40, field_last_writer: {}, conflict_status: "none", vector_clock: { counter_a: 1 } },
        ],
      });
    });

    expect(result.current.state.syncStatus).toBe("ready");
    expect(result.current.state.items["parle-g"].stock).toBe(40);
  });

  it("ws_message record_updated merges field_last_writer and clears any prior conflict", () => {
    const { result } = setup();

    act(() => {
      result.current.dispatch({
        type: "sync_loaded",
        items: [
          {
            item_id: "parle-g",
            stock: 40,
            field_last_writer: { price: "counter_a" },
            conflict_status: "needs_review",
            vector_clock: { counter_a: 1 },
          },
        ],
      });
    });

    act(() => {
      result.current.dispatch({
        type: "ws_message",
        message: {
          type: "record_updated",
          item_id: "parle-g",
          stock: 35,
          field_last_writer: { shelf_location: "counter_b" },
          vector_clock: { counter_a: 1, counter_b: 1 },
        },
      });
    });

    const item = result.current.state.items["parle-g"];
    expect(item.stock).toBe(35);
    expect(item.conflict_status).toBe("none");
    expect(item.field_last_writer).toEqual({ price: "counter_a", shelf_location: "counter_b" });
    expect(item.vector_clock).toEqual({ counter_a: 1, counter_b: 1 });
  });

  it("ws_message needs_review flags the item and carries the candidates", () => {
    const { result } = setup();

    act(() => {
      result.current.dispatch({
        type: "sync_loaded",
        items: [{ item_id: "parle-g", stock: 40, price: 10, field_last_writer: {}, conflict_status: "none", vector_clock: {} }],
      });
    });

    act(() => {
      result.current.dispatch({
        type: "ws_message",
        message: {
          type: "needs_review",
          item_id: "parle-g",
          field: "price",
          overlap_seconds: 300,
          values: [
            { counter_id: "counter_a", value: 10 },
            { counter_id: "counter_b", value: 12 },
          ],
          ai_summary: null,
          vector_clock: { counter_a: 1, counter_b: 1 },
        },
      });
    });

    const item = result.current.state.items["parle-g"];
    expect(item.conflict_status).toBe("needs_review");
    expect(item.conflict_candidates?.field).toBe("price");
    expect(item.conflict_candidates?.values).toHaveLength(2);
  });

  it("optimistic_write applies a stock delta and marks the item optimistic, without touching an item that hasn't synced yet", () => {
    const { result } = setup();

    act(() => {
      result.current.dispatch({
        type: "optimistic_write",
        itemId: "unknown-item",
        vectorClock: { counter_a: 1 },
        stockDelta: -1,
      });
    });
    expect(result.current.state.items["unknown-item"]).toBeUndefined();

    act(() => {
      result.current.dispatch({
        type: "sync_loaded",
        items: [{ item_id: "parle-g", stock: 40, field_last_writer: {}, conflict_status: "none", vector_clock: {} }],
      });
    });

    act(() => {
      result.current.dispatch({
        type: "optimistic_write",
        itemId: "parle-g",
        vectorClock: { counter_a: 1 },
        stockDelta: -3,
      });
    });

    const item = result.current.state.items["parle-g"];
    expect(item.stock).toBe(37);
    expect(item.optimistic).toBe(true);
    expect(item.vector_clock).toEqual({ counter_a: 1 });
  });

  it("queue_entry_added / queue_entry_status / queue_entry_removed manage the drawer list", () => {
    const { result } = setup();

    act(() => {
      result.current.dispatch({
        type: "queue_entry_added",
        entry: { idempotencyKey: "k1", itemId: "parle-g", type: "sale", status: "queued" },
      });
    });
    expect(result.current.state.queue).toHaveLength(1);

    act(() => {
      result.current.dispatch({ type: "queue_entry_status", idempotencyKey: "k1", status: "reconciled" });
    });
    expect(result.current.state.queue[0].status).toBe("reconciled");

    act(() => {
      result.current.dispatch({ type: "queue_entry_removed", idempotencyKey: "k1" });
    });
    expect(result.current.state.queue).toHaveLength(0);
  });

  it("toggle_offline flips manualOffline independently of browserOnline", () => {
    const { result } = setup();

    act(() => {
      result.current.dispatch({ type: "browser_online_changed", online: true });
    });
    expect(result.current.state.connectivity).toEqual({ browserOnline: true, manualOffline: false });

    act(() => {
      result.current.dispatch({ type: "toggle_offline" });
    });
    expect(result.current.state.connectivity).toEqual({ browserOnline: true, manualOffline: true });
  });
});
