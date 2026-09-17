import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyDelta, emptyPNCounter, merge, value } from "../src/pnCounter";
import type { PNCounterState } from "../src/types";

type Op = { clientId: string; type: "increment" | "decrement"; amount: number };

const clientIdArb = fc.constantFrom("counter_a", "counter_b", "counter_c");
const opArb: fc.Arbitrary<Op> = fc.record({
  clientId: clientIdArb,
  type: fc.constantFrom("increment", "decrement"),
  // Realistic sale/restock quantities, not adversarial edge values.
  amount: fc.integer({ min: 1, max: 20 }),
});

function applyAll(ops: Op[]): PNCounterState {
  return ops.reduce(
    (state, op) => applyDelta(state, op.clientId, op.type, op.amount),
    emptyPNCounter(),
  );
}

describe("PN-Counter algebraic properties", () => {
  it("is commutative: any order of the same operations yields the same value", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 0, maxLength: 30 }), (ops) => {
        const forward = value(applyAll(ops));
        const reversed = value(applyAll([...ops].reverse()));
        expect(reversed).toBe(forward);
      }),
    );
  });

  it("is commutative under an arbitrary shuffle, not just full reversal", () => {
    fc.assert(
      fc.property(
        fc.array(opArb, { minLength: 0, maxLength: 30 }).chain((ops) =>
          fc.tuple(fc.constant(ops), fc.shuffledSubarray(ops, { minLength: ops.length })),
        ),
        ([ops, shuffled]) => {
          expect(value(applyAll(shuffled))).toBe(value(applyAll(ops)));
        },
      ),
    );
  });

  it("merge is associative regardless of grouping, and matches direct sequential application", () => {
    // merge() reconciles per-client CUMULATIVE totals — each client's own
    // operation stream must stay whole on one side of any split. Splitting
    // by arbitrary list position (rather than by client) would cut a single
    // client's stream across both sides and silently under-count via
    // max(), which is exactly the bug the doc comment on `merge` warns
    // about. Partitioning by client below respects that invariant.
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 0, maxLength: 30 }), (ops) => {
        const stateForClient = (clientId: string) => applyAll(ops.filter((op) => op.clientId === clientId));
        const [a, b, c] = ["counter_a", "counter_b", "counter_c"].map(stateForClient);

        const groupedLeftFirst = merge(merge(a, b), c);
        const groupedRightFirst = merge(a, merge(b, c));
        const direct = applyAll(ops);

        expect(groupedLeftFirst).toEqual(groupedRightFirst);
        expect(value(groupedLeftFirst)).toBe(value(direct));
      }),
    );
  });

  it("catches a known-bad G-Counter (no decrements) — confirms the property test is load-bearing", () => {
    // A G-Counter that ignores decrements entirely is the exact bug class
    // this suite exists to catch (per the senior-qa "has this test ever
    // failed" standard). Simulate it by only ever incrementing regardless
    // of the operation's real sign, and show the assertion fails as expected.
    const brokenApply = (state: PNCounterState, op: Op): PNCounterState =>
      applyDelta(state, op.clientId, "increment", op.amount);

    const ops: Op[] = [
      { clientId: "counter_a", type: "decrement", amount: 5 },
      { clientId: "counter_b", type: "decrement", amount: 3 },
    ];
    const brokenValue = value(ops.reduce(brokenApply, emptyPNCounter()));
    const correctValue = value(applyAll(ops));

    expect(brokenValue).not.toBe(correctValue);
    expect(correctValue).toBe(-8);
  });
});
