import { useState } from "react";
import type { ConflictCandidatesDTO } from "@stocksync/core";
import { postConflictResolve } from "../api/client";
import { AlertTriangleIcon } from "./icons";

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
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/40">
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <h4 className="font-semibold text-amber-900 dark:text-amber-200">Conflicting "{candidates.field}" value</h4>
          <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300">
            Both counters set this while offline, {candidates.overlap_seconds}s apart. Pick which one should win.
          </p>
        </div>
      </div>

      {candidates.field === "price" &&
        (candidates.bedrock_explanation ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-white/70 p-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-slate-900/40 dark:text-amber-200">
            {candidates.bedrock_explanation}
          </p>
        ) : (
          <p className="mt-3 flex items-center gap-2 rounded-md border border-amber-200 bg-white/50 p-2.5 text-sm italic text-amber-700 dark:border-amber-800 dark:bg-slate-900/40 dark:text-amber-400">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700 dark:border-amber-700 dark:border-t-amber-300" />
            Generating explanation…
          </p>
        ))}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {candidates.values.map((candidate) => (
          <button
            key={candidate.counter_id}
            type="button"
            disabled={resolving !== null}
            onClick={() => void pick(candidate.value)}
            className="flex flex-col items-start gap-0.5 rounded-md border border-amber-300 bg-white px-3 py-2 text-left transition-colors hover:border-amber-500 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-slate-900 dark:hover:border-amber-600 dark:hover:bg-amber-950"
          >
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              {candidate.counter_id}
            </span>
            <span className="text-sm font-medium text-amber-900 dark:text-amber-200">: {String(candidate.value)}</span>
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{error}</p>}
    </div>
  );
}
