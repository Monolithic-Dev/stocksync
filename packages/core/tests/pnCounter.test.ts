import { describe, expect, it } from "vitest";
import { applyDelta, emptyPNCounter, merge, value } from "../src/pnCounter";
import type { PNCounterState } from "../src/types";

describe("value", () => {
  it("is 0 for an empty counter", () => {
    expect(value(emptyPNCounter())).toBe(0);
  });

  it("sums increments and subtracts decrements across clients", () => {
    const state: PNCounterState = {
      increments: { counter_a: 10 },
      decrements: { counter_a: 5, counter_b: 3 },
    };
    expect(value(state)).toBe(2);
  });
});

describe("applyDelta", () => {
  it("reproduces the canonical PRD US-3 scenario: 50 - 5 - 2 - 3 = 40", () => {
    // base_stock (50) lives outside the PN-Counter itself — only the
    // increments/decrements are modeled here, per 03-DATABASE-SCHEMA.md.
    const baseStock = 50;
    let state = emptyPNCounter();
    state = applyDelta(state, "counter_a", "decrement", 5);
    state = applyDelta(state, "counter_a", "decrement", 2);
    state = applyDelta(state, "counter_b", "decrement", 3);
    expect(baseStock + value(state)).toBe(40);
  });

  it("produces the same final value regardless of application order (commutativity, spot check)", () => {
    const order1 = applyDelta(
      applyDelta(applyDelta(emptyPNCounter(), "counter_a", "decrement", 5), "counter_a", "decrement", 2),
      "counter_b",
      "decrement",
      3,
    );
    const order2 = applyDelta(
      applyDelta(applyDelta(emptyPNCounter(), "counter_b", "decrement", 3), "counter_a", "decrement", 2),
      "counter_a",
      "decrement",
      5,
    );
    expect(value(order1)).toBe(value(order2));
  });

  it("accumulates multiple operations from the same client into that client's bucket entry", () => {
    let state = emptyPNCounter();
    state = applyDelta(state, "counter_a", "increment", 5);
    state = applyDelta(state, "counter_a", "increment", 2);
    expect(state.increments.counter_a).toBe(7);
  });

  it("does not mutate the input state (pure)", () => {
    const original = emptyPNCounter();
    applyDelta(original, "counter_a", "increment", 5);
    expect(original).toEqual(emptyPNCounter());
  });
});

describe("merge", () => {
  it("takes the per-client max on each bucket independently", () => {
    const a: PNCounterState = { increments: { c1: 5 }, decrements: { c1: 2 } };
    const b: PNCounterState = { increments: { c1: 3, c2: 4 }, decrements: { c1: 2, c2: 1 } };
    expect(merge(a, b)).toEqual({
      increments: { c1: 5, c2: 4 },
      decrements: { c1: 2, c2: 1 },
    });
  });
});
