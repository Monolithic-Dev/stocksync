import { describe, expect, it } from "vitest";
import { resolve } from "../src/conflictResolution";
import { value } from "../src/pnCounter";
import type { RecordState } from "../src/types";

const seededItem: RecordState = {
  fields: { price: 10, shelf_location: "Aisle 2" },
  fieldLastWriter: { price: "counter_a", shelf_location: "counter_a" },
  vectorClock: { counter_a: 1 },
  pnCounter: { increments: {}, decrements: {} },
};

describe("resolve — clean apply", () => {
  it("applies a dominating write directly and advances the vector clock", () => {
    const result = resolve(seededItem, {
      clientId: "counter_a",
      vectorClock: { counter_a: 2 },
      fields: { shelf_location: "Aisle 3" },
    });
    expect(result.kind).toBe("applied");
    if (result.kind === "applied") {
      expect(result.state.fields.shelf_location).toBe("Aisle 3");
      expect(result.state.fieldLastWriter.shelf_location).toBe("counter_a");
      expect(result.state.vectorClock).toEqual({ counter_a: 2 });
      expect(result.strategy).toBe("clean_apply");
    }
  });

  it("starts from an empty state when current is undefined (first-ever write for an item)", () => {
    const result = resolve(undefined, {
      clientId: "counter_a",
      vectorClock: { counter_a: 1 },
      counterDelta: { type: "decrement", amount: 5 },
    });
    expect(result.kind).toBe("applied");
    if (result.kind === "applied") {
      expect(value(result.state.pnCounter!)).toBe(-5);
    }
  });
});

describe("resolve — the canonical PRD US-3 scenario", () => {
  it("merges concurrent decrements from two counters to the correct total regardless of arrival order", () => {
    let state: RecordState = { fields: {}, fieldLastWriter: {}, vectorClock: {} };

    const a1 = resolve(state, { clientId: "counter_a", vectorClock: { counter_a: 1 }, counterDelta: { type: "decrement", amount: 5 } });
    state = (a1 as { state: RecordState }).state;

    const a2 = resolve(state, { clientId: "counter_a", vectorClock: { counter_a: 2 }, counterDelta: { type: "decrement", amount: 2 } });
    state = (a2 as { state: RecordState }).state;

    // Counter B's write is concurrent — it never saw counter_a's progress.
    const b1 = resolve(state, { clientId: "counter_b", vectorClock: { counter_b: 1 }, counterDelta: { type: "decrement", amount: 3 } });
    state = (b1 as { state: RecordState }).state;

    expect(b1.kind).toBe("applied");
    if (b1.kind === "applied") {
      expect(b1.strategy).toBe("pn_counter_merge");
    }

    const baseStock = 50;
    expect(baseStock + value(state.pnCounter!)).toBe(40);
  });

  it("generalizes to three or more concurrent counters, not just two (edge case A-3)", () => {
    let state: RecordState = { fields: {}, fieldLastWriter: {}, vectorClock: {} };

    // All three writes are mutually concurrent — none has seen any of the
    // others' progress — arriving in an arbitrary (here, C-A-B) order.
    const c1 = resolve(state, { clientId: "counter_c", vectorClock: { counter_c: 1 }, counterDelta: { type: "decrement", amount: 4 } });
    state = (c1 as { state: RecordState }).state;

    const a1 = resolve(state, { clientId: "counter_a", vectorClock: { counter_a: 1 }, counterDelta: { type: "decrement", amount: 5 } });
    state = (a1 as { state: RecordState }).state;

    const b1 = resolve(state, { clientId: "counter_b", vectorClock: { counter_b: 1 }, counterDelta: { type: "decrement", amount: 3 } });
    state = (b1 as { state: RecordState }).state;

    expect(a1.kind).toBe("applied");
    expect(b1.kind).toBe("applied");
    expect(c1.kind).toBe("applied");

    const baseStock = 50;
    expect(baseStock + value(state.pnCounter!)).toBe(38); // 50 - 4 - 5 - 3
  });
});

describe("resolve — B-2 a concurrent restock and sale of the same item", () => {
  it("applies both independently via separate PN-Counter buckets, never as a same-field conflict", () => {
    let state: RecordState = { fields: {}, fieldLastWriter: {}, vectorClock: {} };

    const sale = resolve(state, { clientId: "counter_a", vectorClock: { counter_a: 1 }, counterDelta: { type: "decrement", amount: 5 } });
    state = (sale as { state: RecordState }).state;

    // Concurrent — counter_b never saw counter_a's sale.
    const restock = resolve(state, { clientId: "counter_b", vectorClock: { counter_b: 1 }, counterDelta: { type: "increment", amount: 10 } });

    expect(restock.kind).toBe("applied");
    if (restock.kind === "applied") {
      expect(restock.strategy).toBe("pn_counter_merge");
      expect(value(restock.state.pnCounter!)).toBe(5); // -5 + 10, never treated as a field disagreement
    }
  });
});

describe("resolve — A-2 a stale write (behind current in every entry)", () => {
  it("is not treated specially just because it arrived after the current state — runs through the same concurrent-write path, applies without data loss", () => {
    // counter_a is already at 3 (it made three local writes); a very
    // delayed retry of its own second write (vectorClock counter_a: 2)
    // arrives last. It's strictly behind, not concurrent — but resolve()
    // must not special-case "arrived later" as "should overwrite silently";
    // it goes through the identical dominates/concurrent check as any
    // other non-dominating write.
    const current: RecordState = { fields: {}, fieldLastWriter: {}, vectorClock: { counter_a: 3 }, pnCounter: { increments: {}, decrements: {} } };

    const stale = resolve(current, { clientId: "counter_a", vectorClock: { counter_a: 2 }, counterDelta: { type: "decrement", amount: 4 } });

    expect(stale.kind).toBe("applied");
    if (stale.kind === "applied") {
      // Never silently dropped — the counter delta is commutative and
      // still folds in, same as any concurrent write would.
      expect(stale.strategy).toBe("pn_counter_merge");
      expect(value(stale.state.pnCounter!)).toBe(-4);
      // The vector clock merge never regresses — max per entry.
      expect(stale.state.vectorClock).toEqual({ counter_a: 3 });
    }
  });
});

describe("resolve — field-level merge (US-4)", () => {
  it("applies disjoint concurrent field writes without conflict", () => {
    const b = resolve(seededItem, {
      clientId: "counter_b",
      vectorClock: { counter_b: 1 },
      fields: { supplier: "New Supplier" },
    });
    expect(b.kind).toBe("applied");
    if (b.kind === "applied") {
      expect(b.state.fields.supplier).toBe("New Supplier");
      expect(b.state.fields.price).toBe(10);
      expect(b.strategy).toBe("field_merge");
    }
  });
});

describe("resolve — same-field conflict (US-5)", () => {
  it("flags needs_review with both candidates on a genuine same-field disagreement", () => {
    const result = resolve(seededItem, {
      clientId: "counter_b",
      vectorClock: { counter_b: 1 },
      fields: { price: 12 },
    });
    expect(result.kind).toBe("needs_review");
    if (result.kind === "needs_review") {
      expect(result.field).toBe("price");
      expect(result.candidates).toEqual([
        { clientId: "counter_a", value: 10 },
        { clientId: "counter_b", value: 12 },
      ]);
      // The conflicting field itself is left untouched pending review.
      expect(result.state.fields.price).toBe(10);
    }
  });

  it("does not flag a same-value concurrent write (edge case B-3)", () => {
    const result = resolve(seededItem, {
      clientId: "counter_b",
      vectorClock: { counter_b: 1 },
      fields: { price: 10 },
    });
    expect(result.kind).toBe("applied");
  });

  it("still applies the stock/counter delta from the same write even when a field conflicts (US-5, B-4)", () => {
    const result = resolve(seededItem, {
      clientId: "counter_b",
      vectorClock: { counter_b: 1 },
      fields: { price: 12 },
      counterDelta: { type: "decrement", amount: 3 },
    });
    expect(result.kind).toBe("needs_review");
    if (result.kind === "needs_review") {
      expect(value(result.state.pnCounter!)).toBe(-3);
    }
  });

  it("still applies an unrelated field write alongside a same-field conflict (edge case B-4)", () => {
    const result = resolve(seededItem, {
      clientId: "counter_b",
      vectorClock: { counter_b: 1 },
      fields: { price: 12, supplier: "New Supplier" },
    });
    expect(result.kind).toBe("needs_review");
    if (result.kind === "needs_review") {
      expect(result.state.fields.supplier).toBe("New Supplier");
    }
  });
});

describe("resolve — purity", () => {
  it("is deterministic: the same inputs always produce the same result", () => {
    const write = { clientId: "counter_b", vectorClock: { counter_b: 1 }, fields: { price: 12 } };
    const first = resolve(seededItem, write);
    const second = resolve(seededItem, write);
    expect(second).toEqual(first);
  });
});
