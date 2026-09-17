# StockSync — 10-Day Build Plan

Each day has an explicit exit criterion — don't move to the next day
until the current day's exit criterion is genuinely met, not "mostly
there." A senior engineer's discipline here is refusing to let scope
silently slip forward.

---

## Day 1 — Repo, infra scaffold, and design lock

- Register on AWS Builder Center, verify student status (start this
  immediately — verification can take time).
- Create AWS account, set a Budget alarm at $20.
- Initialize the monorepo per `06-FOLDER-STRUCTURE.md`: npm workspaces,
  Turborepo config, shared ESLint/TypeScript config in `packages/config`.
- Initialize `infra/cdk/` (CDK app in TypeScript) with the empty-construct
  scaffold from `06-FOLDER-STRUCTURE.md` / `docs/phases/phase-1-scaffolding.md`,
  then (Phase 3) flesh out `DataLayer.ts` with the four DynamoDB tables from
  `03-DATABASE-SCHEMA.md`. Run `cdk bootstrap && cdk deploy` to stand up the
  tables. Get the deploy succeeding before writing any Lambda code.
- Re-read `01-PRD.md` and `02-ARCHITECTURE.md` end to end; you should be
  able to explain the PN-counter approach out loud without the doc open.

**Exit criterion:** `cdk deploy` succeeds; all four DynamoDB tables exist
in your AWS account with the correct keys and GSIs.

---

## Day 2 — `packages/core` and its tests, before any Lambda code

- Implement `vectorClock.ts`, `pnCounter.ts`, `fieldMerge.ts`, and
  `conflictResolution.ts` as pure TypeScript, with zero AWS dependencies.
- Write the unit and property-based tests from `08-TESTING-STRATEGY.md`
  Section 2 alongside the implementation, not after.

**Exit criterion:** `npm test` in `packages/core` passes, including the
commutativity and associativity property-based tests, with no AWS
resources involved at all.

---

## Day 3 — Write intake and idempotency

- Implement the `write-intake` Lambda, importing types from
  `packages/core`.
- Wire `POST /transactions` through API Gateway to this Lambda.
- Implement the SQS FIFO queue with `MessageGroupId = record_id` and an
  attached DLQ (edge case set A and Flaw 1.2 from the architecture
  review — get the grouping right the first time).

**Exit criterion:** submitting the same transaction twice via curl/
Postman returns `duplicate` on the second call, and the SQS queue shows
exactly one message enqueued.

---

## Day 4 — Conflict detection and resolution, wired to AWS

- Implement the `conflict-resolver` Lambda, calling into
  `packages/core`'s `resolve()` function, reading/writing via
  `TransactWriteItems` across `inventory_records`, `audit_log`, and
  `write_dedup`.
- Manually trigger the PRD's US-3, US-4, and US-5 scenarios via
  curl/Postman (not the UI yet) and confirm DynamoDB state matches
  expectations after each.

**Exit criterion:** all three scenarios (concurrent same-field-different
counters, field-merge, same-field conflict) produce correct DynamoDB
state when triggered manually, without any client UI involved yet.

---

## Day 5 — Integration tests + WebSocket plumbing

- Write the integration tests from `08-TESTING-STRATEGY.md` Section 3
  against DynamoDB Local.
- Implement `$connect`/`$disconnect` handlers and the `ws_connections`
  table logic (edge case D-1, D-2).
- Implement the push-on-resolution logic in the conflict-resolver.

**Exit criterion:** integration test suite passes; a manually-opened
WebSocket connection receives a `record_updated` push when a transaction
is submitted via curl.

---

## Day 6 — StockSync Counter client, offline queueing

- Build the React client: `ItemCard`, `ConnectivityToggle`, `QueueDrawer`
  components, `useOfflineQueue` hook backed by `idb`.
- Wire the client to `POST /transactions` and `GET /sync`.
- Implement the explicit in-UI network kill switch (not a DevTools
  trick) — this is a standout demo feature, build it now, not later.

**Exit criterion:** using the UI's own toggle, you can go offline, sell
an item, see it queue locally, go back online, and see it sync — no
DevTools required.

---

## Day 7 — Automate and rehearse the core scenario

- Write the Playwright E2E test for the core conflict scenario (US-3)
  from `08-TESTING-STRATEGY.md` Section 4.1.
- Run it repeatedly (aim for 10 consecutive green runs) before trusting
  it.
- Manually rehearse the same scenario in two real browser windows,
  matching the demo script draft in `10-DEMO-PLAN.md`.

**Exit criterion:** the Playwright test passes 10 times consecutively,
and you can manually reproduce the same result live at least 5 times in
a row without any manual data reset in between beyond the documented
reset script.

---

## Day 8 — Bedrock integration, timeline audit UI, conflict panel

- Implement the Bedrock call in the conflict-resolver (async,
  non-blocking per edge case G-3), pass `overlap_seconds` in the prompt
  (clamped per edge case C-6), and wire `bedrock_explanation` into the
  `needs_review` WebSocket push.
- Build `ConflictReviewPanel` and the timeline-style `AuditLogView`
  component.
- Add attribution badges to `ItemCard`.
- Add the animated `Queued → Replaying → Reconciled` transaction states.

**Not this day (Tier 2 — see `11-PHASED-SCOPE.md`):** voice transaction
entry, reorder alerts, and barcode/QR were briefly scheduled here before
being reverted to Tier 2 — see the Tier 2 Extension Days section below
for where they actually belong if there's real time margin later.

**Exit criterion:** the same-field conflict scenario, run end to end
through the actual UI, shows both raw values + `overlap_seconds` immediately
and the Bedrock explanation appearing shortly after, without blocking the UI.

---

## Day 9 — Edge-case pass, CloudWatch, demo script, dry run

- Go through `07-EDGE-CASES.md` section by section; for each item,
  confirm it's handled (write a quick test or manual check) or
  explicitly document it as a known limitation if genuinely out of
  scope.
- Add the CloudWatch dashboard (ConflictRate, IdempotencyHitRate,
  QueueDepth).
- Finalize and time the demo script from `10-DEMO-PLAN.md`; do a full
  dry run.

**Exit criterion:** a timed dry run comes in at or under 3 minutes with
zero surprises; every edge case in the catalog is either handled or
explicitly and knowingly deferred.

---

## Day 10 — Record, document, deploy, submit

- Record the demo (expect 3–5 takes).
- Write the submission README: problem, architecture summary, what you
  learned (Section 12 of the PRD), and a link to the full docs folder.
- Final `cdk deploy`, deploy the React frontend via **AWS Amplify Hosting**,
  verify the live URL works from a fresh incognito window.
- Submit several hours before the deadline, not at the last minute.

**Exit criterion:** submission is complete and confirmed received, with
time to spare for any last-minute technical issue.

---

## A Note on Git Discipline (senior-engineering practice, low cost to adopt)

- One feature branch per day's scope (e.g. `feat/write-intake`,
  `feat/conflict-resolver`), merged via PR even if you're working solo —
  it forces a moment of review against this doc set before merging.
- Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`) — costs
  nothing extra and makes the eventual README/writeup easier to write
  from the commit history.
- Tag the commit that passes Day 7's exit criterion — that's your
  "the core thing works" milestone, worth being able to point back to if
  something regresses later in the build.

---

## Tier 2 Extension Days — ONLY if Day 7's exit criterion was met on or before Day 7

If you're on schedule, use any remaining time before Day 9's edge-case
pass to work through `11-PHASED-SCOPE.md`'s Tier 2 list **in the order
given there**, stopping wherever you are when Day 9 arrives. Do not
reorder the list based on what seems more fun to build — it's ordered by
implementation risk and demo payoff, cheapest/safest first.

A reasonable allocation if you're running on schedule:

- **Extra Day A (borrowed from slack, not from Tier 1 days):** Full CRUD
  (2.1) + checkout flow (2.2) — these share a lot of plumbing and go
  together naturally.
- **Extra Day B:** Cognito auth (2.3) + analytics rollup and dashboard
  (2.4). Do not start reorder alerts until 2.4 is actually deployed and
  populated — it reads directly from the table 2.4 creates.
- **Extra Day C (only if A and B are solid):** notifications (2.5), the
  AI assistant (2.6), and **Bedrock reorder alerts (2.7)** — now
  unblocked since 2.4 exists.
- **Extra Day D (only with genuine margin remaining):** voice entry
  (2.8) and barcode/QR (2.9), in either order — both are independent
  additions with no data dependency on anything above, but both are
  real new integrations in their own right. Do not attempt
  multi-environment CDK stacks (2.10) unless everything above is done
  with at least one full day of margin remaining before the final
  submission day.

If at any point a Tier 2 feature is fighting you and eating into Day
9–10's hardening and rehearsal time, stop and cut it — an unfinished
Tier 2 feature visible in a broken state during the demo actively hurts
you more than simply not having built it at all.
