# Phase 13: New Differentiators (Zero AWS Dependency)

All three of these are fully buildable and testable against the local
dev server and DynamoDB Local right now — none of them touch a new AWS
service, so none of them are blocked on credits. Build in the order
given; each is independent of the other two.

---

## 13a. Client-side Barcode/QR Quick-Entry

**Goal:** A counter can scan a barcode/QR code with the device camera to
pre-fill the existing sell/restock action, instead of only selecting an
item from a list.

**Preconditions:** Phase 6 complete (`ItemCard.tsx` and the sell/restock
actions already exist).

**Implements:** `01-PRD.md` FR-23, `02-ARCHITECTURE.md` §10.9,
`06-FOLDER-STRUCTURE.md`'s `BarcodeScanButton.tsx` entry, Tier 2 item 2.9.

### Task Breakdown

1. **Pick a scanning library** that works purely client-side against
   `getUserMedia` (no server round-trip to decode) — this keeps the
   feature entirely independent of any backend or AWS service.
2. **`apps/web/src/components/BarcodeScanButton.tsx`**:
   - Opens a camera view, decodes a barcode/QR code to a raw string.
   - Resolves that string to a real `item_id` by looking it up against
     the already-loaded (via `GET /sync`) item list for this shop — a
     simple exact match against a `sku` or `item_id` field, nothing
     fuzzy needed for QR/barcode (unlike voice, where transcription
     errors make fuzzy matching necessary).
   - If no match is found, show "item not recognized" and let the
     operator fall back to manual selection — **never guess** which item
     was meant.
   - On a successful match, pre-fills the existing sell/restock action —
     this button produces the exact same `submitTransaction()` call
     `ItemCard.tsx` already makes; it does not create a new transaction
     type or a new API call.
3. **Tests** (`apps/web/test/components/BarcodeScanButton.test.tsx`):
   - A decoded code matching a known item's `sku` resolves correctly and
     calls `submitTransaction` with that item's real `item_id`.
   - A decoded code matching nothing shows the "not recognized" state and
     does **not** call `submitTransaction`.
   - Camera permission denial is handled gracefully (a clear message, not
     a silent failure or an unhandled promise rejection).

### Real-World Engineering Concerns

- **This must never bypass validation.** Since it produces the exact same
  call as the manual sell/restock button, all the existing idempotency,
  batch-size, and quantity validation from Phase 4 applies unchanged —
  there is no new validation surface to build here, which is exactly why
  this is low-risk.
- **Camera permission UX varies across devices/browsers** — this is the
  one genuinely unpredictable part. Test on whatever device you'll
  actually record the demo on, not just a laptop webcam, since mobile
  camera permission flows are the more realistic use case for this
  feature and behave differently.

### Definition of Done

- [ ] Scanning a real barcode/QR code (print one, or display one on a
      second screen) against the running local dev server correctly
      identifies a seeded item and pre-fills a sale.
- [ ] An unrecognized code shows a clear fallback state, never a guess.
- [ ] All three tests in step 3 pass.

### Time Budget

Half a day. If the scanning library integration fights you, this is the
easiest item in this entire document to cut without losing a
differentiator that matters more than the ones you'd keep — it's real
polish, not a story-carrying feature.

---

## 13b. CRDT / Vector-Clock Explainer View

**Goal:** For any resolved conflict shown in the audit log, a judge (or
anyone) can see the actual vector clocks compared and read a plain
explanation of why the system decided "clean apply," "merged," or
"needs review" — turning the hardest-to-explain part of the system into
something visibly understandable.

**Preconditions:** Phase 8 complete (`audit_log` entries already carry
`resolution_strategy` and enough context per entry).

**Implements:** No existing FR — this is new. Add it as FR-24 in
`01-PRD.md` if you want it formally tracked; functionally it's a
read-only view over data Phase 5 already writes to `audit_log`.

### Task Breakdown

1. **Confirm `audit_log` entries carry enough raw detail already.** Per
   `03-DATABASE-SCHEMA.md` §4, each entry has `action`,
   `resolution_strategy`, and a free-form `details` map. If the vector
   clocks involved in a specific decision (`current` vs. `incoming`,
   before and after merge) aren't already captured in `details` for
   `conflict_detected`/`field_update`/`sale`/`restock` actions, extend
   `conflictResolver.ts`'s audit-write step to include them — this is an
   additive field, not a schema change, so it doesn't touch anything
   already working.
2. **`apps/web/src/components/VectorClockExplainer.tsx`**:
   - Given one `audit_log` entry (fetched via the existing
     `GET /audit/{item_id}` endpoint — no new API needed), renders the
     two vector clocks being compared as simple per-client counters
     side by side (e.g. `counter_a: 2, counter_b: 1` vs.
     `counter_a: 2, counter_b: 2`).
   - Below that, one plain-language sentence generated client-side from
     the `resolution_strategy` field — no AI call needed, this is a
     straightforward template ("counter_b's write included everything
     counter_a's did, plus more, so it applied cleanly" /
     "neither write had seen the other's change, so both were merged" /
     "both changed the same field to different values, so a human
     needed to decide").
3. **Wire it into `AuditLogView.tsx`** as an expandable detail per
   timeline entry, rather than a separate page — keeps it discoverable
   without cluttering the main timeline.
4. **Tests** (`apps/web/test/components/VectorClockExplainer.test.tsx`):
   - A clean-apply entry renders the "applied cleanly" explanation.
   - A field-merge entry renders the "both merged" explanation.
   - A needs-review entry renders the "a human needed to decide"
     explanation.
   - (If step 1 required extending the audit write) a new
     `conflictResolver.test.ts` case confirming the vector clocks are
     actually present in the written `details` map.

### Real-World Engineering Concerns

- **This is presentation logic only — it must never influence
  `resolve()`'s actual decision.** It reads what already happened; it
  cannot be allowed to become a second place decision logic lives, which
  would violate the same single-source-of-truth principle
  `senior-architect` already established for `packages/core`.
- **Keep the plain-language templates honest and specific**, not vague —
  "applied cleanly" without saying why is barely better than nothing;
  naming the actual client IDs and what each contributed is what makes
  this genuinely explain the mechanism rather than just labeling it.

### Definition of Done

- [ ] Triggering all three Phase 7 scenarios (clean apply, field-merge,
      needs-review) and viewing each in the new explainer shows the
      correct vector clocks and the correct plain-language explanation
      for that specific case.
- [ ] All tests in step 4 pass.
- [ ] `packages/core` and `conflictResolver.ts`'s actual decision logic
      are unmodified by this feature — confirmed by code review, not
      just by tests passing.

### Time Budget

One day. This is the highest differentiation-per-hour item in this
whole document — it makes your hardest, least-visible engineering work
into your most visually compelling demo moment. Don't cut it unless
something in bucket one of `14-build-order-while-waiting.md` is at risk.

---

## 13c. Trust-Score Dashboard Reframing

**Goal:** The analytics dashboard leads with a single, plain-language
trust metric ("98% of writes this week applied cleanly") instead of
burying conflict data in a table, reframing the sync engine's own
correctness machinery as a business-relevant number a shop owner would
actually care about.

**Preconditions:** Phase 12 item 1 (`dailyRollup.ts`, `DashboardPage.tsx`)
at least partially built per `14-build-order-while-waiting.md` — this is
a presentation layer on top of that data, not a new data source.

**Implements:** Tier 2 item 2.4, extended.

### Task Breakdown

1. **`apps/api/src/handlers/dailyRollup.ts`** (extend, if not already
   present): confirm the rollup computes, per shop per day, total writes
   and `conflict_count` (already in `03-DATABASE-SCHEMA.md`'s
   `daily_analytics` schema) — if `conflict_count` isn't yet being
   populated by the rollup logic, add it now; the field already exists
   in the table definition.
2. **`apps/web/src/components/TrustScoreCard.tsx`**:
   - Computes `(1 - conflicts / total_writes) * 100` over a selectable
     window (default: last 7 days) from `daily_analytics`.
   - Renders as a single, large, prominent number at the top of
     `DashboardPage.tsx` — above the detailed chart, not instead of it.
   - Includes one sentence of context ("X conflicts this week, all
     resolved — see the audit log for details") linking through to the
     existing `AuditLogView`/`VectorClockExplainer` from 13b, if built.
3. **Tests** (`apps/web/test/components/TrustScoreCard.test.tsx`):
   - Given seeded `daily_analytics` rows, the computed percentage matches
     hand-calculation exactly.
   - A zero-writes edge case (a brand-new shop with no data yet) renders
     a sensible empty state, not `NaN%` or a divide-by-zero artifact.

### Real-World Engineering Concerns

- **Don't let the framing overstate the number.** A 98% "clean" rate
  sounds great, but be honest in the copy that the other 2% were
  correctly *caught and flagged*, not silently mishandled — the point of
  this metric is to show the system's honesty, not to make conflicts
  look like failures to be minimized to zero (a shop with more concurrent
  counters will naturally have a nonzero conflict rate; that's normal,
  not a defect).

### Definition of Done

- [ ] The trust score renders correctly against seeded test data,
      matching hand-calculation.
- [ ] The zero-data edge case is handled gracefully.
- [ ] Both tests in step 3 pass.

### Time Budget

Half a day, and only after 13a/13b and the base analytics dashboard
work — this is a small presentation layer on top of data that needs to
exist first.

---

## Handoff

All three of these can be fully built, tested, and demo-rehearsed
locally before credits arrive. Once `phase-9.5-deployment-runbook.md`'s
deploy succeeds, re-run each one's existing test suite against the real
deployed stack as part of that phase's rehearsal step — same discipline,
no new verification process needed, just point the same tests at the
real URL instead of localhost.
