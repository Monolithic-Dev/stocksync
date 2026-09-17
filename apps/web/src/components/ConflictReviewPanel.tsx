import { useState } from "react";
import type { ConflictCandidatesDTO } from "@stocksync/core";
import { postConflictResolve } from "../api/client";

export interface ConflictReviewPanelProps {
  itemId: string;
  shopId: string;
  counterId: string;
  candidates: ConflictCandidatesDTO;
  onResolved: () => void;
}

/**
 * Scaffolded in Phase 6, fully wired in Phase 8: `POST /conflicts/{id}/
 * resolve` now exists, and a same-field *price* conflict additionally
 * gets a Bedrock-generated explanation (FR-7 scopes this to price only —
 * other fields never get one, so the explanation section is hidden for
 * them rather than showing "Generating…" forever). `bedrock_explanation`
 * may arrive as undefined initially, then be filled in by a follow-up
 * push (04-API-SPEC.md §2) — this panel renders correctly in both states.
 * The AI summary is advisory only and is never itself a selectable
 * "accept this" option — only the two raw candidate values are.
 */
export function ConflictReviewPanel({ itemId, shopId, counterId, candidates, onResolved }: ConflictReviewPanelProps) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(value: unknown): Promise<void> {
    setError(null);
    setResolving(String(value));
    try {
      await postConflictResolve(itemId, shopId, candidates.field, value, counterId);
      onResolved();
    } catch {
      setError("Couldn't resolve this conflict — check the connection and try again.");
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h4 className="font-semibold text-amber-900">Conflicting "{candidates.field}" value</h4>
      <p className="mt-1 text-sm text-amber-800">
        Both counters set this while offline, {candidates.overlap_seconds}s apart. Pick which one should win.
      </p>

      {candidates.field === "price" &&
        (candidates.bedrock_explanation ? (
          <p className="mt-2 rounded bg-white/60 p-2 text-sm text-amber-900">{candidates.bedrock_explanation}</p>
        ) : (
          <p className="mt-2 text-sm italic text-amber-700">Generating explanation…</p>
        ))}

      <div className="mt-3 flex flex-wrap gap-2">
        {candidates.values.map((candidate) => (
          <button
            key={candidate.counter_id}
            type="button"
            disabled={resolving !== null}
            onClick={() => void pick(candidate.value)}
            className="rounded-md border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {candidate.counter_id}: {String(candidate.value)}
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-amber-700">{error}</p>}
    </div>
  );
}
