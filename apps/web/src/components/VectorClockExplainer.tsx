import type { AuditHistoryEntry } from "@stocksync/core";

export interface VectorClockExplainerProps {
  entry: AuditHistoryEntry;
}

function formatClock(clock: unknown): string {
  if (!clock || typeof clock !== "object") return "—";
  const entries = Object.entries(clock as Record<string, number>);
  if (entries.length === 0) return "(none yet)";
  return entries.map(([counterId, seq]) => `${counterId}: ${seq}`).join(", ");
}

// Presentation only — reads what resolve() already decided (via the
// resolution_strategy/action already written to the audit entry), never
// re-derives or second-guesses it. See senior-architect's guardrail
// against a second place decision logic could live.
function explanationFor(entry: AuditHistoryEntry): string {
  if (entry.action === "conflict_detected" || entry.resolution_strategy === "needs_review") {
    return "Both changed the same field to different values while neither had seen the other's write yet, so a human needed to decide.";
  }
  if (entry.resolution_strategy === "pn_counter_merge" || entry.resolution_strategy === "field_merge") {
    return "Neither write had seen the other's change yet, so both were merged automatically — no conflict.";
  }
  return `${entry.counter_id}'s write already included everything the stored version had seen, so it applied cleanly.`;
}

/**
 * For one audit-log entry, shows the actual vector clocks compared
 * (stored vs. incoming) and a plain-language sentence for why the
 * resolver decided clean-apply / merged / needs-review — turning the
 * hardest-to-explain part of the system into something visible (13b).
 */
export function VectorClockExplainer({ entry }: VectorClockExplainerProps) {
  const details = entry.details as Record<string, unknown> | undefined;
  const current = details?.current_vector_clock;
  const incoming = details?.incoming_vector_clock;
  // Older entries (written before this field existed) simply have
  // nothing to show here — not an error state.
  if (current === undefined && incoming === undefined) return null;

  return (
    <div className="mt-1 rounded-md bg-slate-50 p-2 text-xs text-slate-600" data-testid="vector-clock-explainer">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-medium text-slate-500">Stored clock</div>
          <div data-testid="current-clock">{formatClock(current)}</div>
        </div>
        <div>
          <div className="font-medium text-slate-500">Incoming clock</div>
          <div data-testid="incoming-clock">{formatClock(incoming)}</div>
        </div>
      </div>
      <p className="mt-1" data-testid="clock-explanation">
        {explanationFor(entry)}
      </p>
    </div>
  );
}
