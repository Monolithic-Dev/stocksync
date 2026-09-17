import { describe, expect, it } from "vitest";
import { hasFieldConflict, mergeDisjointFields } from "../src/fieldMerge";
import type { RecordState } from "../src/types";

function baseState(overrides: Partial<RecordState> = {}): RecordState {
  return {
    fields: { price: 10, shelf_location: "Aisle 2" },
    fieldLastWriter: { price: "counter_a", shelf_location: "counter_a" },
    vectorClock: { counter_a: 1 },
    ...overrides,
  };
}

describe("hasFieldConflict", () => {
  it("returns null for disjoint field changes", () => {
    expect(hasFieldConflict(baseState(), { supplier: "New Supplier" })).toBeNull();
  });

  it("returns null when the concurrent value is identical (edge case B-3)", () => {
    expect(hasFieldConflict(baseState(), { price: 10 })).toBeNull();
  });

  it("returns the field name when a genuinely different value is submitted", () => {
    expect(hasFieldConflict(baseState(), { price: 12 })).toBe("price");
  });

  it("returns null for a field current has never seen", () => {
    expect(hasFieldConflict(baseState({ fields: {}, fieldLastWriter: {} }), { price: 12 })).toBeNull();
  });

  it("returns null for a field that only holds its original seed value and no client has field_update'd it yet", () => {
    // toRecordState() populates `fields` from every non-undefined stored
    // column, including ones set only at item creation — never via an
    // actual field_update. A first-ever concurrent write to such a field
    // isn't a conflict with anyone, regardless of what the seed value was.
    const seeded = baseState({ fields: { price: 10 }, fieldLastWriter: {} });
    expect(hasFieldConflict(seeded, { price: 15 })).toBeNull();
  });
});

describe("mergeDisjointFields", () => {
  it("applies non-conflicting field writes and stamps the last writer", () => {
    const result = mergeDisjointFields(baseState(), { clientId: "counter_b", fields: { supplier: "New Supplier" } });
    expect(result.fields.supplier).toBe("New Supplier");
    expect(result.fieldLastWriter.supplier).toBe("counter_b");
    // Untouched fields are preserved.
    expect(result.fields.price).toBe(10);
    expect(result.fieldLastWriter.price).toBe("counter_a");
  });
});
