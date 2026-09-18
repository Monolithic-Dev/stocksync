# Phase 16: CRDT / Vector-Clock Explainer View

**This is the very next thing to build. Not a fifth idea — the first
concrete task from the final selection.**

## Header

**Goal:** For any resolved conflict shown in the audit log, show the
actual vector clocks compared and a plain-language explanation of why
the system decided "clean apply," "merged," or "needs review" — turning
your least-visible engineering work into your most visually compelling
demo moment.

**Preconditions:** Phase 9.5's deploy is live and rehearsed. Phase 8
complete (`audit_log` entries already carry `resolution_strategy`).

**Implements:** New — add as FR-24 in `01-PRD.md` if tracking formally.
Reads data Phase 5 already writes; no changes to `packages/core`.

---

## Task Breakdown

1. **Confirm `audit_log` entries carry enough raw detail already.** Per
   `03-DATABASE-SCHEMA.md` §4, each entry has `action`,
   `resolution_strategy`, and a free-form `details` map. If the vector
   clocks involved in a specific decision aren't already captured there,
   extend `conflictResolver.ts`'s audit-write step to include them — an
   additive field, not a schema change, so nothing already working is
   touched.
2. **`apps/web/src/components/VectorClockExplainer.tsx`**:
   - Given one `audit_log` entry (fetched via the existing
     `GET /audit/{item_id}` — no new API needed), renders the two vector
     clocks compared as simple per-client counters side by side.
   - Below that, one plain-language sentence generated client-side from
     `resolution_strategy` — a template, no AI call needed ("counter_b's
     write included everything counter_a's did, plus more, so it applied
     cleanly" / "neither write had seen the other's change, so both were
     merged" / "both changed the same field to different values, so a
     human needed to decide").
3. **Wire it into `AuditLogView.tsx`** as an expandable detail per
   timeline entry, not a separate page.
4. **Tests** (`apps/web/test/components/VectorClockExplainer.test.tsx`):
   - A clean-apply entry renders the "applied cleanly" explanation.
   - A field-merge entry renders the "both merged" explanation.
   - A needs-review entry renders the "a human needed to decide" explanation.
   - (If step 1 required extending the audit write) a `conflictResolver.test.ts`
     case confirming the vector clocks are actually present in `details`.

## Real-World Engineering Concerns

- **Presentation logic only — never a second place decisions live.** This
  reads what already happened; it cannot become a second source of truth
  for what `resolve()` decided.
- **Keep the templates specific, not vague.** Naming the actual client
  IDs and what each contributed is what makes this genuinely explain the
  mechanism, not just label it.

## Definition of Done

- [ ] Triggering all three Phase 7 scenarios and viewing each in the
      explainer shows the correct vector clocks and explanation.
- [ ] All tests in step 4 pass.
- [ ] `packages/core` and `conflictResolver.ts`'s decision logic are
      unmodified — confirmed by code review, not just tests passing.

## Risks & Blockers

None significant — this is read-only presentation over existing data.

## Time Budget

One day.

## Handoff

Phase 17 can begin once this is done and tested.
