# Phase 18: Expiry-Date Tracking

## Header

**Goal:** Add `expiry_date` as a tracked, concurrently-editable field,
proving the existing field-merge engine generalizes to a new real-world
attribute with zero new conflict-resolution code.

**Preconditions:** Phase 17 complete. Phase 2 complete (`fieldMerge.ts`
already field-agnostic by design).

**Implements:** Extends FR-5; add as FR-26 in `01-PRD.md` if tracking.

---

## Task Breakdown

1. **`03-DATABASE-SCHEMA.md`** (doc update): add `expiry_date` (String,
   ISO date) to `inventory_records`.
2. **Confirm `fieldMerge.ts` needs zero changes** — write a test proving
   it, don't just assume it.
3. **`apps/web/src/components/ItemCard.tsx`** (extend): expiry-date
   display/edit for perishables. Seed `milk-500ml` and `bread` with real
   near-term dates.
4. **Tests** (`packages/core/tests/conflictResolution.test.ts`, extend):
   - Two counters restocking with different batch expiry dates,
     concurrently — same-field conflict, `needs_review`. **This test
     should pass with no changes to `conflictResolution.ts` itself.**
   - One counter updates `expiry_date`, another updates `price`,
     concurrently — disjoint fields, both merge cleanly.

## Real-World Engineering Concerns

- **The point is that this needs no new mechanism.** If it does, that's
  a generality gap in `fieldMerge.ts` worth fixing.
- **Say explicitly, in the demo/writeup, that zero conflict-resolution
  code changed** — that specific claim is what makes this land.

## Definition of Done

- [ ] Both new tests pass with zero modification to `conflictResolution.ts`
      or `fieldMerge.ts`.
- [ ] `git diff` on `packages/core/src` shows nothing outside type
      definitions — worth screenshotting for the writeup.
- [ ] UI displays and allows editing expiry dates on seeded perishables.

## Risks & Blockers

Minimal by design. The only real risk is scope-creeping into a full
expiry-alert feature — resist that; this phase is exactly what's
specified above, nothing more.

## Time Budget

Half a day.

## Handoff

Phase 19 is conditional — only start it if real time remains.
