# Phase 15: Additional Differentiators

Four more directions, each genuinely distinct from Phase 13/14's
material rather than a variation on it. 15a is the single best
cost-to-impact idea across every phase in this doc set — it needs no new
code at all. Build in the order given.

---

## 15a. Live Chaos-Engineering Demo — Kill a Lambda Mid-Transaction

**Goal:** Prove, on camera, that the idempotency and SQS-redelivery
guarantees already built in Phase 4/5 hold under a real AWS
infrastructure failure, not just in a unit test — by deliberately
breaking the system mid-transaction during the recorded demo and
showing it recover correctly.

**Preconditions:** Phase 9.5's deployment is live and rehearsed. This
phase adds **no new code** — it's a demo script and rehearsal addition
only.

**Implements:** No new FR — this exercises FR-2 (idempotency) and the
failure-mode table in `02-ARCHITECTURE.md` §9 directly, live, as
evidence rather than as a written claim.

### Task Breakdown

1. **Pick the fault-injection mechanism.** The simplest, lowest-risk
   option: manually set the `conflictResolverFn`'s reserved concurrency
   to 0 in the AWS Console for a few seconds right after submitting a
   transaction (this causes AWS to throttle the invocation, which SQS
   will retry once concurrency is restored) — no code change, no new
   IAM permission, fully reversible with one console click.
2. **Script the exact sequence for the demo:**
   - Submit a sale via the UI as normal.
   - Immediately (in a second window/terminal) set reserved concurrency
     to 0 on `conflictResolverFn`.
   - Narrate: "the function that resolves this write just got cut off —
     watch what happens."
   - After a few seconds, restore concurrency.
   - Show the transaction complete correctly — stock updates, exactly
     once, no duplication — once the function resumes.
3. **Rehearse this specifically, the same way as every other demo-critical
   moment** — confirm the timing (how long the throttle needs to stay on
   to be visibly meaningful, how long recovery visibly takes) before
   trusting it live.
4. **Have a screen-recorded fallback take** of a successful run, per the
   same discipline `10-DEMO-PLAN.md` already establishes for the core
   scenario.

### Real-World Engineering Concerns

- **This only works because idempotency and SQS redelivery were built
  correctly in Phase 4/5.** If this demo doesn't recover cleanly, that's
  a real regression worth investigating immediately — it means a
  guarantee you believed was solid isn't, which is far more important to
  catch now than a missing feature would be.
- **Don't over-engineer the fault injection.** Reserved-concurrency-to-zero
  is boring, reliable, and fully reversible — resist the temptation to
  build a fancier chaos-injection Lambda or tool for this; the point is
  proving an existing guarantee, not building a new subsystem.

### Definition of Done

- [ ] The exact sequence in step 2 has been rehearsed and succeeds
      5 times in a row, matching every other demo-critical scenario's
      rehearsal bar.
- [ ] A fallback recording exists.
- [ ] The demo script (`10-DEMO-PLAN.md`) has this added as an explicit
      beat, with timing notes from rehearsal.

### Risks & Blockers

| Risk | Mitigation |
|---|---|
| The throttle window is too short/long to look convincing on camera | This is purely a timing/rehearsal problem, not a technical one — iterate on the exact wait durations during rehearsal |
| Forgetting to restore concurrency after the demo, leaving the function throttled in production | Add this to the pre-recording and post-recording checklists explicitly, since it's easy to forget under recording pressure |

### Time Budget

Under half a day — this is almost entirely rehearsal time, not build
time.

---

## 15b. Expiry-Date Tracking — Reusing the Existing Engine, Zero New Logic

**Goal:** Add `expiry_date` as a tracked, concurrently-editable field on
inventory records, proving the existing field-merge engine generalizes
to a genuinely new real-world attribute without any new
conflict-resolution code.

**Preconditions:** Phase 2 complete (`fieldMerge.ts` already field-agnostic
by design).

**Implements:** Extends FR-5 (field-level merge) to a new field; add as
FR-26 in `01-PRD.md` if tracking formally.

### Task Breakdown

1. **`03-DATABASE-SCHEMA.md`** (doc update): add `expiry_date` (String,
   ISO date) to `inventory_records`' attribute list — a plain new field,
   no new table, no new access pattern.
2. **Confirm `fieldMerge.ts` needs zero changes.** `hasFieldConflict` and
   `mergeDisjointFields` operate on `Record<string, unknown>` — they
   already don't know or care what field names mean. This step is
   verification, not implementation: write a test proving it.
3. **`apps/web/src/components/ItemCard.tsx`** (extend): add an
   expiry-date display and edit action for perishable items (seed
   `milk-500ml` and `bread` with real near-term expiry dates to make
   this demo-able).
4. **Tests** (`packages/core/tests/conflictResolution.test.ts`, extend):
   - Two counters restocking the same item with *different* batch
     expiry dates while offline, concurrently — same-field conflict,
     `needs_review`, exactly like the existing price-conflict test, just
     with a different field name. This test should pass with **no
     changes to `conflictResolution.ts` itself** — if it needs a change,
     that's a sign `fieldMerge.ts` wasn't as generic as claimed.
   - One counter updates `expiry_date`, another updates `price`,
     concurrently — disjoint fields, both merge cleanly, same pattern as
     the existing shelf-location/price test.

### Real-World Engineering Concerns

- **The whole point is that this requires no new mechanism.** If
  implementing this reveals `fieldMerge.ts` actually had `price` or
  `shelf_location` hardcoded somewhere, fix that generality gap — it
  would mean the "field-agnostic" claim wasn't fully true before either.
- **Keep the demo honest about what's genuinely reused.** Say explicitly,
  in the demo or writeup, that zero conflict-resolution code changed —
  that specific claim is what makes this differentiator land, not just
  the feature existing.

### Definition of Done

- [ ] The two new test cases in step 4 pass without any modification to
      `conflictResolution.ts` or `fieldMerge.ts`.
- [ ] `git diff` on `packages/core/src` for this feature shows zero
      changes outside of type definitions (if `expiry_date` needs adding
      to a type at all) — confirmed and worth screenshotting for the
      writeup.
- [ ] The UI displays and allows editing expiry dates on the seeded
      perishable items.

### Risks & Blockers

Minimal — this is deliberately the lowest-risk item in Phase 14/15
combined, by design. The only real risk is scope-creeping it into a full
expiry-alert/spoilage-prevention feature, which is a different, larger
feature than what's specified here — resist that pull if it comes up.

### Time Budget

Half a day, most of it in the UI display work, not the (near-zero)
backend work.

---

## 15c. Icon-Only, Low-Literacy UI Mode

**Goal:** An alternate interaction mode for counter operators who may
not read fluently in any language — item selection and sell/restock by
photo/icon grid, no text required at all.

**Preconditions:** Phase 6 complete (`ItemCard.tsx`, the core sell/restock
actions).

**Implements:** No existing FR — new. Distinct from voice entry
(addresses illiteracy, not "hands busy" or "noisy environment").

### Task Breakdown

1. **`apps/web/src/components/IconGridView.tsx`** — an alternate
   rendering of the item list as a photo/icon grid instead of a text
   list, using the same underlying item data from `GET /sync`.
2. **Large, unambiguous tap targets**: a `+`/`−` icon pair per item
   (visually distinct, color-coded — e.g. green for restock, red for
   sale) rather than text-labeled buttons.
3. **A mode toggle** (`apps/web/src/state/ShopContext.tsx`, extend):
   persists the operator's preferred mode (icon grid vs. text list) —
   this is a per-device UI preference, not server state, so no backend
   change needed.
4. **Seed data needs real images**, not just names — extend
   `scripts/seed-demo-data.ts` to include an image URL/asset per seeded
   item.
5. **Tests:** tapping an item's `+`/`−` icon calls the exact same
   `submitTransaction()` path as the text-mode buttons — this mode is a
   presentation-layer alternative, not a second write path, same
   discipline as the barcode/QR feature in Phase 13a.

### Real-World Engineering Concerns

- **This is a presentation-layer feature only** — it must call the same
  underlying actions as every other entry point, never a parallel
  implementation with its own validation logic to maintain.
- **Icon/color choices need to be genuinely unambiguous** without relying
  on reading — test the grid with someone unfamiliar with the project
  and see if they can operate it correctly with zero explanation, which
  is the actual bar this feature needs to clear.

### Definition of Done

- [ ] Toggling to icon mode and performing a sale/restock produces the
      exact same server-side result as text mode, confirmed via the same
      audit-log check used elsewhere in this project.
- [ ] Someone who hasn't seen the project's text labels can correctly
      perform a sale using only the icon grid, with no verbal
      explanation beyond "sell this item."

### Risks & Blockers

| Risk | Mitigation |
|---|---|
| Icon choices are ambiguous without cultural/contextual testing | Test with a genuinely fresh pair of eyes before considering this done — this is a usability claim, not just a build task |
| Sourcing real product images for the demo items | Use simple, clearly-licensed stock icons/photos for the seeded demo items — this doesn't need to be production-quality art |

### Time Budget

1 day, split roughly evenly between the component itself and finding/
testing genuinely unambiguous iconography.

---

## 15d. Cooperative Purchasing Signal Across Shops (Name Only — Tier 3 Vision)

**This is a narrative addition, like `phase-14-advanced-differentiators.md`
§14d — do not attempt to build this now.** It's included here because
it's the one genuinely "platform, not app" idea in this batch, and
naming it costs nothing.

**Goal:** Name, in the README's "where this goes next" section and the
demo's closing line, a plausible future direction where StockSync's
per-shop demand signals (already computed for the reorder-alerts feature)
could be aggregated *across* opted-in shops to give small retailers
collective negotiating leverage with suppliers that no single shop has
alone.

### Suggested language

> "Individually, a small shop has no leverage with a supplier. If ten
> shops in the same neighborhood are all running low on the same item at
> the same time — which our per-shop analytics already detects — that's
> real collective demand a supplier would care about. We don't aggregate
> across shops today, and doing it responsibly means real design work:
> opt-in consent, and aggregation that never leaks one shop's specific
> numbers to another. But the per-shop signal that would feed it already
> exists in what we built."

### Why this is worth including

- It's the most ambitious, most genuinely "big platform vision" item
  across everything discussed — worth having *somewhere* in the
  submission even if every other idea in Phase 13–15 stays scoped to a
  single shop.
- It's honest about the real design work aggregation would need (privacy,
  consent) rather than hand-waving past it — which reads as more
  credible to a judge than a vague "and then it's a network effect"
  claim would.
- It directly answers "how big could this get" without costing a single
  hour of build time this week.

### Definition of Done

- [ ] Named in the README and demo close, in your own words, explicitly
      as future vision — not implied to be built.

### Time Budget

Under an hour.
