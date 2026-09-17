# Build Order While Waiting on AWS Credits

Everything in `phase-11-platform-crud-checkout-auth.md` and
`phase-12-analytics-notifications-ai-expansion.md` already has real task
breakdowns — this doc doesn't redo that work, it triages each existing
task into what your local dev server (`apps/api/src/local/server.ts`) +
DynamoDB Local can actually build and test right now, versus what
genuinely cannot be verified without a live AWS account. Build top to
bottom; the further down you go, the more of the work will need
re-verification once credits land, per the same discipline as
`phase-9.5-deployment-runbook.md`.

**The rule:** "buildable now" means the code, its logic, and its tests
can all be finished and green today. It does not mean "done" — anything
touching a real AWS-hosted service (Cognito, SNS/SES, Bedrock,
Transcribe, EventBridge's actual schedule firing) still needs a real
pass once the account is live, exactly like Tier 1's local validation
needed the Phase 9.5 deploy to actually count.

---

## Fully buildable and testable right now (no AWS dependency at all)

| From | Task | Why it's fully clear |
|---|---|---|
| Phase 11, item 2 | `PlatformCrud.ts` tables (`products`, `categories`, `suppliers`, `shops`, `users`) | Plain DynamoDB tables — DynamoDB Local handles this identically to how Tier 1's tables were built and tested |
| Phase 11, item 3 | CRUD handlers (`productsCrud.ts`, etc.) | Pure logic + local dev server, same pattern as every Tier-1 handler |
| Phase 11, item 4 | `checkout.ts` | Calls the *already-built, already-tested* `POST /transactions` pipeline internally — no new AWS surface at all |
| Phase 11, item 5 | `ProductsPage.tsx`, `CheckoutPage.tsx` (not `LoginPage.tsx` — see below) | Frontend against the local dev server, identical pattern to `CounterPage.tsx` |
| Phase 12, item 1 (partial) | `dailyRollup.ts`'s actual aggregation logic | Invoke the handler directly with seeded `audit_log` test data — no EventBridge needed to test the logic itself, only to schedule it |
| Phase 12, item 1 (partial) | `DashboardPage.tsx`, `AnalyticsChart.tsx` | Renders whatever `daily_analytics` data exists — test against seeded local data |
| New (no file yet) | Client-side barcode/QR quick-entry (Tier 2 item 2.9) | Entirely client-side, zero new AWS services — see `phase-13-new-differentiators.md` |
| New (no file yet) | CRDT/vector-clock explainer view | Pure read of existing `audit_log` data — see `phase-13-new-differentiators.md` |
| New (no file yet) | Trust-score dashboard reframing | Same data as the analytics dashboard above, different presentation — see `phase-13-new-differentiators.md` |

**Recommended build order for this bucket:** barcode/QR and the CRDT
explainer first (zero dependencies, highest differentiation-per-hour),
then CRUD + checkout (unlocks everything else in Phase 11/12), then the
analytics rollup logic + dashboard + trust-score reframing together
(they share the same data).

---

## Buildable now with a mock, needs a real pass once credits land

| From | Task | What to mock now | What's deferred |
|---|---|---|---|
| Phase 11, item 1 | Cognito authorization logic | Hand-sign a fake JWT with the same claim shape (`shop_id`, `role`) your real tokens will have; write the shop-scoping middleware and its cross-shop-denied test against that | The actual Cognito User Pool (a real AWS resource) and wiring the API Gateway Cognito authorizer to it — that needs a real User Pool ARN to attach to |
| Phase 11, item 5 (partial) | `LoginPage.tsx` | Build the form/UI shell against a mocked auth response | The real Cognito Hosted UI / SDK integration, once a real User Pool exists |
| Phase 12, item 2 | Notification threshold-checking logic | Unit test "given these seeded stock levels, which items should notify" — mock the actual SNS/SES send call | Confirming a real email/SMS is actually received — needs real SNS/SES |
| Phase 12, item 3 | `askAssistant.ts`'s retrieval logic | The DynamoDB queries that gather context are fully testable now; mock the Bedrock call and assert the right context was passed to it | The real Bedrock call and its actual response quality — needs real model access |
| Phase 12, item 4 | `reorderSuggestions.ts` | Same pattern as above — mock Bedrock, test the retrieval and prompt construction | Real Bedrock call; also still hard-blocked on `daily_analytics` having real data, which is fine since that's buildable now too |
| Phase 12, item 5 | `voiceTransaction.ts`'s post-transcription logic | Feed a hand-written fake transcript string directly into the parsing/validation step, skip the audio entirely | The real Transcribe call and the client's audio-capture UI — both need real AWS and a real microphone permission flow to test meaningfully |

**Recommended order within this bucket:** Cognito's authorization logic
first (item 2.3 unlocks proper shop-scoping tests for everything else in
Phase 11), then the notification logic, then the two Bedrock-mocked
features (assistant, then reorder, in that order since reorder depends
on it), then voice entry's parsing logic last — it's the least useful to
build early since its real value (actually understanding spoken audio)
can't be assessed at all without the real Transcribe call.

---

## Genuinely blocked — don't spend time here yet

- **Multi-environment CDK stacks** (Tier 2 item 2.10) — you can write the
  parameterized stack code, but there's nothing to actually verify
  without at least one real deploy to point it at. Low value to write
  blind; wait until the first real deploy succeeds, then parameterize it.
- **Anything requiring you to look at a real AWS console** (confirming
  Bedrock model access is enabled, confirming a real CloudWatch
  dashboard populates, confirming Amplify's build succeeds) — these are
  all Phase 9.5's job specifically, not Tier 2's.

---

## What "done" means for everything in the first two buckets

For each item above, before moving on: the code is written, its tests
(including the mocked-dependency tests) are green, and — this part
matters — **you've written down, in the code or a comment, exactly what
still needs re-verification once credits land** (which mock stands in
for which real service). This is the same discipline `phase-9.5-deployment-runbook.md`
already uses for Tier 1; carry it forward rather than reinventing it,
so nothing quietly gets assumed "done" that was actually only ever
tested against a stand-in.
