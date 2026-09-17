import { describe, expect, it } from "vitest";
import { clocksEqual, dominates, isConcurrent, merge } from "../src/vectorClock";

describe("dominates", () => {
  it("returns true for a clean superset clock", () => {
    expect(dominates({ a: 2, b: 1 }, { a: 1, b: 1 })).toBe(true);
  });

  it("returns false when the candidate is missing a strictly-greater entry", () => {
    expect(dominates({ a: 1, b: 1 }, { a: 1, b: 1 })).toBe(false);
  });

  it("returns false when any entry is behind", () => {
    expect(dominates({ a: 2, b: 0 }, { a: 1, b: 1 })).toBe(false);
  });

  it("treats an unseen client ID as 0 without throwing (edge case A-5)", () => {
    expect(() => dominates({ a: 1 }, {})).not.toThrow();
    expect(dominates({ a: 1 }, {})).toBe(true);
    expect(dominates({}, { a: 1 })).toBe(false);
  });
});

describe("isConcurrent", () => {
  it("returns true for two clocks where neither dominates", () => {
    expect(isConcurrent({ a: 2, b: 0 }, { a: 0, b: 2 })).toBe(true);
  });

  it("returns false when one clock dominates the other", () => {
    expect(isConcurrent({ a: 2, b: 1 }, { a: 1, b: 1 })).toBe(false);
  });

  it("returns false for identical clocks", () => {
    expect(isConcurrent({ a: 1, b: 1 }, { a: 1, b: 1 })).toBe(false);
  });
});

describe("clocksEqual", () => {
  it("is true for identical clocks even with different key insertion order", () => {
    expect(clocksEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("treats a missing key as 0", () => {
    expect(clocksEqual({ a: 0 }, {})).toBe(true);
  });
});

describe("merge", () => {
  it("takes the per-key max", () => {
    expect(merge({ a: 2, b: 0 }, { a: 1, b: 3 })).toEqual({ a: 2, b: 3 });
  });

  it("is commutative", () => {
    const a = { a: 2, c: 5 };
    const b = { b: 3, c: 1 };
    expect(merge(a, b)).toEqual(merge(b, a));
  });
});
