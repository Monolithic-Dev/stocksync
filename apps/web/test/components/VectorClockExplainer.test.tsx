import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AuditHistoryEntry } from "@stocksync/core";
import { VectorClockExplainer } from "../../src/components/VectorClockExplainer";

function entry(overrides: Partial<AuditHistoryEntry>): AuditHistoryEntry {
  return {
    timestamp: "2026-09-17T10:00:00Z",
    counter_id: "counter_a",
    action: "sale",
    details: {
      current_vector_clock: { counter_a: 1 },
      incoming_vector_clock: { counter_a: 2 },
    },
    ...overrides,
  };
}

describe("VectorClockExplainer", () => {
  it("explains a clean apply", () => {
    render(<VectorClockExplainer entry={entry({ action: "sale" })} />);
    expect(screen.getByTestId("clock-explanation")).toHaveTextContent("applied cleanly");
  });

  it("explains a field-merge (concurrent, no conflict)", () => {
    render(<VectorClockExplainer entry={entry({ action: "field_update", resolution_strategy: "field_merge" })} />);
    expect(screen.getByTestId("clock-explanation")).toHaveTextContent("both were merged automatically");
  });

  it("explains a needs-review conflict", () => {
    render(
      <VectorClockExplainer
        entry={entry({ action: "conflict_detected", resolution_strategy: "needs_review" })}
      />,
    );
    expect(screen.getByTestId("clock-explanation")).toHaveTextContent("a human needed to decide");
  });

  it("renders both clocks side by side", () => {
    render(<VectorClockExplainer entry={entry({})} />);
    expect(screen.getByTestId("current-clock")).toHaveTextContent("counter_a: 1");
    expect(screen.getByTestId("incoming-clock")).toHaveTextContent("counter_a: 2");
  });

  it("renders nothing for an older entry with no captured clocks", () => {
    const { container } = render(<VectorClockExplainer entry={entry({ details: {} })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
