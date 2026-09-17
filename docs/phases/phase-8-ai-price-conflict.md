# Phase 8: AI — Price-Conflict Assistant (Bedrock)

## Header

**Goal:** When a same-field price conflict is flagged `needs_review`, Amazon Bedrock generates a plain-language explanation of the discrepancy, displayed alongside both raw values — without ever blocking the core conflict-flagging or being able to auto-resolve it.

**Preconditions:** Phase 5 complete (conflicts are correctly flagged `needs_review`). Phase 6 complete (`ConflictReviewPanel` exists to render into).

**Implements:** `01-PRD.md` FR-7, `04-API-SPEC.md` §3 (internal Bedrock prompt contract), `senior-prompt-engineer` skill's guardrails and `references/bedrock-prompt-templates.md` template #1, `07-EDGE-CASES.md` G-1/G-2/G-3.

---

## Task Breakdown

1. **`apps/api/src/lib/bedrock.ts`**:
   - `BedrockRuntimeClient` setup.
   - `explainPriceConflict(fieldName, candidateA, candidateB, timeDeltaSeconds): Promise<string | null>` — calls Bedrock with the exact system/user prompt from `senior-prompt-engineer/references/bedrock-prompt-templates.md` §1. Returns `null` (not a thrown error) on any failure — timeout, malformed response, or service error — since this call must never be the reason a conflict fails to display.

2. **Wire into `conflictResolver.ts`** (extend from Phase 5):
   - **After** the atomic `TransactWriteItems` commit succeeds and the conflict is already flagged and pushed, fire `explainPriceConflict(...)` — this must be genuinely non-blocking with respect to the core write. Implement as either a fire-and-forget async call within the same invocation (acceptable at this scale) or a second Lambda triggered off the same Streams event, whichever is simpler to get right correctly first.
   - On a successful response, update `inventory_records.conflict_candidates.bedrock_explanation` with a second, smaller write (not part of the original transaction — the explanation is additive context, not core state) and push a follow-up `needs_review` WebSocket event carrying the explanation.
   - On failure (`null` returned), do nothing further — the UI already has both raw values from the original push and displays fine without an explanation.

3. **`apps/web/src/components/ConflictReviewPanel.tsx`** (extend from Phase 6's scaffold):
   - Render both raw candidate values immediately, regardless of whether an explanation has arrived.
   - Show "Generating explanation…" if `bedrock_explanation` is not yet present, updating in place when the follow-up push arrives (edge case F-3) — never block the panel's core function (letting the owner pick a value) on this.
   - The "Accept" actions call `POST /conflicts/{item_id}/resolve` directly with the chosen raw value — **the AI explanation is never itself a selectable "accept this" option**, per the advisory-only guardrail.

4. **`apps/api/src/handlers/conflictResolve.ts`** — implements `POST /conflicts/{item_id}/resolve` per `04-API-SPEC.md` §1: a simple, non-concurrent write (only one person resolves a given flagged conflict) updating `inventory_records` directly and appending a final `audit_log` entry with `action: "conflict_resolved_manual"`.

5. **Tests:**
   - `bedrock.test.ts`: mock the Bedrock client to return a malformed/empty response — assert `explainPriceConflict` returns `null`, not a thrown exception.
   - Integration: trigger a real `needs_review` conflict end to end, confirm the initial push (with `bedrock_explanation: null`) arrives before any explanation, and a follow-up push later carries the explanation.
   - `conflictResolve.test.ts`: resolving an already-resolved conflict (a second person picks a value after the first already did) returns `409 conflict_already_resolved`, per `04-API-SPEC.md` §4.

## Real-World Engineering Concerns

- **Timeout handling is the actual engineering content of this phase.** Set an explicit, short timeout on the Bedrock call (a few seconds) rather than relying on the SDK's default — a hung AI call must not create a hung Lambda invocation that could, in turn, delay processing of the *next* message in the same FIFO group.
- **This is the one place in the system an external, non-deterministic service is in the loop at all** — every other component is deterministic AWS infrastructure. Treat it accordingly: assume it will sometimes fail or be slow, and confirm by testing that failure path deliberately (step 5), not just the happy path.

## Definition of Done

- [ ] Triggering the same-field price conflict scenario (already proven in Phase 7) now additionally shows a Bedrock-generated explanation in `ConflictReviewPanel` within a few seconds.
- [ ] Forcing a Bedrock failure (e.g. temporarily using an invalid model ID) still results in the conflict being flagged, both raw values shown, and the panel functional — confirmed by actually testing this failure case, not just reasoning about it.
- [ ] The explanation text is descriptive/advisory in tone ("these differ because...") and never phrased as a directive ("the correct value is...") — spot-check the actual generated output, don't just trust the prompt template.
- [ ] Resolving a conflict via `POST /conflicts/{item_id}/resolve` updates `inventory_records` and appends the correct `audit_log` entry.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| Bedrock latency is inconsistent and occasionally slow enough to be visible in the demo | This is fine — the demo script already accounts for "Generating explanation…" as a valid, honest state to show briefly; it is not a bug that needs eliminating, it's a real characteristic of the async design working correctly |
| A prompt iteration accidentally starts asking Bedrock to pick a value rather than explain the discrepancy | Cross-check any prompt change against `senior-prompt-engineer` skill's guardrail before merging — this is exactly the kind of drift that skill exists to catch |

## Time Budget

**1 day.** If this runs long, cut the follow-up-push mechanism (step 2's second write/push) and instead make the explanation call synchronous-but-fast with a strict 3-second timeout, falling back to no explanation shown if it doesn't return in time — simpler, slightly less elegant, but still meets every guardrail. Do not cut the price-conflict feature entirely; it's a named, scored feature in the PRD and a real demo differentiator.

## Handoff

Phase 9 can now assume: all four Tier-1 scenarios (clean apply, PN-Counter merge, field merge, needs-review-with-AI-explanation) work correctly end to end. What remains is hardening and demo prep, not new functional scope. Tag: `phase-8-complete`.
