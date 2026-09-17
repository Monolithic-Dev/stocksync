# Phase 7: Integration & the Core Demo Scenario

**This phase's exit criterion is the single most important checkpoint in the entire 10-day plan.** Nothing in Phase 8 onward should start until it's genuinely met.

> **⚠ P0 blocker, check this before anything else in this file:** this
> phase's own Goal below says the scenario must be proven "backed by real
> deployed AWS infrastructure." If work here has actually been proceeding
> against a local dev server (`apps/api/src/local/server.ts`) because live
> AWS access wasn't available, **this Definition of Done has not actually
> been met, regardless of how many local tests pass.** DynamoDB Streams
> timing, SQS visibility timeouts, real Lambda cold starts, and real IAM
> permission boundaries are exactly the class of thing a local substitute
> cannot exercise — and the Ship It track's first requirement is a live,
> deployed URL, not a local demo. If AWS access is not currently working:
> stop everything else and resolve that first. It is not a documentation
> problem to note and move past; it is the actual blocker.

## Header

**Goal:** The full canonical conflict scenario (US-3, US-4, US-5) runs correctly through the *real* UI, end to end, backed by real deployed AWS infrastructure — proven both by an automated Playwright test and by manual, repeated, human-driven rehearsal.

**Preconditions:** Phase 5 complete (resolution pipeline correct). Phase 6 complete (client can go offline, queue, and replay).

**Implements:** `01-PRD.md` US-3/US-4/US-5 acceptance criteria, `08-TESTING-STRATEGY.md` §4.1/§4.2, `09-BUILD-PLAN.md` Day 7 exit criterion, `11-PHASED-SCOPE.md`'s governing rule for Tier 2.

---

## Task Breakdown

1. **Write the Playwright E2E test** (`apps/web/e2e/core-conflict-scenario.spec.ts`):
   - Launch two independent `BrowserContext`s representing Counter A and Counter B, both navigating to `CounterPage`.
   - Use Playwright's `context.setOffline(true)` on both.
   - In context A: click sell on the seeded item twice (quantities 5, then 2).
   - In context B: click sell on the same item once (quantity 3).
   - `context.setOffline(false)` on both, in either order across separate test runs (parametrize this — run the test twice, reconnecting A first in one run and B first in the other).
   - Assert the displayed stock in **both** contexts converges to 40.
   - Fetch `GET /audit/{item_id}` and assert exactly 3 entries, correctly attributed to the right counter, in the right order.

2. **Extend the E2E suite** for US-4 and US-5:
   - Field-merge case: A edits `shelf_location`, B edits `price`, both offline, both reconnect — assert both fields present, `conflict_status: none`.
   - Needs-review case: A and B both set `price` to different values while offline — assert `ConflictReviewPanel` appears in both contexts showing both candidate values.

3. **Run the automated suite repeatedly**, not once: `npx playwright test --repeat-each=10`. All 10 runs of the core scenario must pass before moving to manual rehearsal — a single automated pass is not sufficient evidence given this project's history with timing-sensitive bugs.

4. **Manual rehearsal**, matching `10-DEMO-PLAN.md`'s exact script:
   - Two real browser windows, side by side, using the actual `ConnectivityToggle` (not DevTools).
   - Run the full scenario — cause the conflict, reconnect, verify arithmetic, cause the same-field conflict — at least 5 times consecutively, using `scripts/reset-demo.ts` between runs to restore seed data.
   - Note the exact wall-clock timing of each phase (offline period, reconnect, resolution) to inform the final demo script's pacing in Phase 10.

5. **`scripts/reset-demo.ts`** — resets `inventory_records`/`audit_log`/`write_dedup` for the demo shop back to seeded state, so rehearsal runs don't require manually clearing DynamoDB by hand between attempts.

6. **`scripts/simulate-conflict.ts`** — a CLI script that reproduces the canonical scenario via direct API calls (no browser needed), for fast iteration when debugging a resolution issue without waiting on the full UI flow.

7. **Fix anything the above surfaces.** This phase is explicitly allowed to send work backward into Phase 5 or 6 if a real bug is found — that's the point of integration testing, not a sign the plan failed.

## Real-World Engineering Concerns

- **Timing-dependent bugs are the primary risk category in this specific phase**, more than in any other phase — a race that never shows up in a fast synthetic test can appear the moment a human clicks with realistic, irregular timing. This is why manual rehearsal is a *required* step here, not optional polish.
- **Test isolation:** each Playwright run and each manual rehearsal must start from known-clean seed data (`reset-demo.ts`) — a scenario that "passes" only because of leftover state from a previous run isn't actually proven.

## Definition of Done

- [ ] `npx playwright test --repeat-each=10` passes all 10 repetitions of the core scenario, in both reconnect-order variants.
- [ ] Manual rehearsal (step 4) succeeds 5 times consecutively, using the real UI toggle, with zero manual database fixes between runs beyond running `reset-demo.ts`.
- [ ] The field-merge and needs-review scenarios both pass their Playwright coverage.
- [ ] Wall-clock timing notes from manual rehearsal are written down somewhere Phase 10 can reference when drafting the recorded script's pacing.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| Automated tests pass 10/10 but manual rehearsal fails intermittently | Trust the manual result over the automated one — it means there's a timing sensitivity the automated test's exact click/wait timing happens not to trigger; investigate before proceeding, don't wave it off as "just a UI quirk" |
| Rehearsal reveals the WebSocket push (if built) is flaky specifically under real reconnect timing | This is the moment to make the Phase 5 cut decision for real if it wasn't already cut — falling back to `GET /sync` polling now is far cheaper than debugging WebSocket timing issues this late |
| `reset-demo.ts` itself has a bug that leaves stale state, masking as a "flaky scenario" | Verify `reset-demo.ts` independently first (inspect DynamoDB state directly after running it) before trusting any rehearsal result that seems inconsistent |

## Time Budget

**1 day.** This phase is not a candidate for cutting scope — its exit criterion is the actual gate for whether Phase 11/12 (Tier 2) are attempted at all, per `11-PHASED-SCOPE.md`. If this phase runs long, every subsequent day's schedule shifts, but the criterion itself does not get relaxed.

## Handoff

Phase 8 can now assume: the core scenario is proven, both automatically and manually, at a reliability level that will hold up under the pressure of a recorded, no-retakes-after-submission video. Phase 11/12 are now unlocked as *possible* (not mandatory) if later days run ahead of schedule. Tag: `phase-7-complete`.
