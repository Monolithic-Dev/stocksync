# Phase 9: Hardening, Observability & Edge-Case Pass

## Header

**Goal:** Every applicable item in `07-EDGE-CASES.md` is either confirmed handled (with a test or manual check) or explicitly, knowingly documented as a deferred limitation — and a CloudWatch dashboard exists showing the system is being operated, not just demoed once.

**Preconditions:** Phase 8 complete (full functional scope of Tier 1 done).

**Implements:** `07-EDGE-CASES.md` in full (sections A–G), `02-ARCHITECTURE.md` §9, `01-PRD.md` §7 (Non-Functional Requirements — Observability), `09-BUILD-PLAN.md` Day 9.

---

## Task Breakdown

1. **Walk `07-EDGE-CASES.md` section by section**, confirming each item against the actual running system:
   - **A (concurrency/ordering) A-1 through A-5:** already covered by Phase 5/7's tests — re-confirm A-3 specifically (3+ concurrent counters, not just 2) with a new test if it wasn't already covered; the original suite only proved 2.
   - **B (data integrity) B-1 through B-5:** B-1 (negative stock policy) confirm the chosen behavior (allow + flag, per Phase 5) is actually visible in the UI, not just in raw data. B-4/B-5 (unrelated/competing writes during a pending conflict) — write a targeted test if not already covered.
   - **C (network/offline) C-1 through C-5:** re-verify C-3 specifically — a very long offline period (simulate by queueing many transactions) still resolves correctly via `GET /sync`'s "fetch current state" design, not a "replay every event" design.
   - **D (WebSocket) D-1 through D-3:** if Phase 5 Part B was cut, mark these explicitly N/A in the submission notes rather than leaving them silently unaddressed.
   - **E (security/abuse) E-1 through E-3:** confirm E-2 (batch size cap) and E-3 (signed quantity rejection) still hold after all later changes; document E-1 (shop-scoped authorization) as a known, stated limitation for this hackathon build.
   - **F (UI/UX) F-1 through F-4:** manually click through each — these are fast to verify by hand.
   - **G (AI) G-1 through G-3:** re-confirm against Phase 8's actual failure-path test.

2. **CloudWatch dashboard** (`infra/cdk/lib/constructs/` — add to `SyncEngine.ts` or a new small construct):
   - Custom metric `ConflictRate` — emitted from `conflictResolver.ts` via Powertools' metrics utility, incremented on every `needs_review` result.
   - Custom metric `IdempotencyHitRate` — incremented in `writeIntake.ts` on every `duplicate` response.
   - Built-in metrics: write queue `ApproximateNumberOfMessagesVisible` (queue depth) and the DLQ's message count (should be zero in steady state — a non-zero DLQ count is itself worth a visible dashboard widget, since it's a leading indicator of a malformed-input bug).
   - A `cloudwatch.Dashboard` construct assembling the above into widgets.

3. **Structured logging pass:** confirm every handler uses `@aws-lambda-powertools/logger` consistently (not raw `console.log`), with the transaction/item ID attached to every log line for traceability across the write-intake → queue → resolver → push chain.

4. **IAM audit:** `npx cdk synth` and grep the output for any `"Resource": "*"` on a DynamoDB/SQS action — there should be none. Cross-check against `aws-solution-architect` skill's least-privilege table.

5. **Break it on purpose:**
   - Send a deliberately malformed transaction (missing `item_id`) directly via curl to `POST /transactions` — confirm it's rejected with `400`, not silently accepted.
   - Kill a WebSocket connection mid-session (close the browser tab abruptly) and trigger a push — confirm `wsPush`'s `GoneException` handling cleans up the stale row without erroring the whole push (re-verifies Phase 5's D-1 handling under a slightly different trigger).
   - Submit 3 concurrent offline writers (not just 2) to the same item and confirm the PN-Counter merge still produces the correct sum (closes the A-3 gap from step 1).

6. **Update `01-PRD.md`'s "Open Questions" / risk sections** with anything discovered during this pass that's being explicitly deferred rather than fixed — this becomes real content for Phase 10's README "what we learned" section.

## Real-World Engineering Concerns

- **This phase is explicitly about proving robustness, not adding features.** If a gap found here suggests a genuinely missing feature rather than a hardening fix, log it for Tier 3 (roadmap) rather than scope-creeping it into today.
- **Observability that's never looked at is theater.** Actually open the CloudWatch dashboard once fully assembled and confirm the metrics are populating with real numbers from the rehearsal runs already performed in Phase 7 — don't just confirm the CDK construct deploys without errors.

## Definition of Done

- [ ] Every row in `07-EDGE-CASES.md` has a one-line status noted somewhere in the repo (a comment, a checklist doc) — "handled, tested," "handled, manually verified," or "deferred, documented as a known limitation."
- [ ] The CloudWatch dashboard is live and shows non-zero data for `ConflictRate` and `IdempotencyHitRate` after re-running the Phase 7 rehearsal scenario once.
- [ ] `npx cdk synth` output contains zero wildcard-resource IAM statements on DynamoDB or SQS actions.
- [ ] The 3-concurrent-writer PN-Counter test (step 5) passes.
- [ ] A malformed `POST /transactions` request is rejected with `400` and does not appear in the DLQ (it should be rejected at intake, before ever reaching the queue — confirm this distinction, since a *malformed SQS message* going to the DLQ per Phase 5 is a different case than a malformed *HTTP request* being rejected at Phase 4's intake).

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| The edge-case pass surfaces a real bug this late in the schedule | Fix it if it's in Tier 1's core path (correctness is never optional); if it's a Tier 2-adjacent or cosmetic issue, document and defer rather than risk destabilizing something that currently works |
| Dashboard construction eats into rehearsal/recording time | This is the first thing to timebox strictly — cap it at half a day; a simpler 2-widget dashboard (conflict rate + queue depth) is a fine substitute for a comprehensive one |

## Time Budget

**1 day.** If this runs long, cut dashboard polish (extra widgets, custom formatting) before cutting the edge-case verification pass itself — an unverified edge case is a real risk during Q&A-free video submission; an unpolished dashboard is not.

## Handoff

Phase 10 can now assume: the system has been deliberately stress-tested against its own documented edge cases, has real operational visibility, and any known gaps are written down rather than silently present. Tag: `phase-9-complete`.
