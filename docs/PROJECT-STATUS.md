# StockSync — Project Status

Last updated: 2026-09-18. This is a living snapshot, not a one-time report — update it as state changes rather than trusting it blindly after time passes.

## TL;DR

Tier 1 (the entire judged scope) plus three additional differentiator features (13a, 13b, 15b) are built, tested, and self-audited. **Nothing has been deployed to real AWS yet.** That deploy is the only thing standing between this and a submittable demo.

## What's done

### packages/core — the conflict-resolution engine
Vector clocks, PN-Counter CRDT, field-level merge, orchestrating `resolve()`. Framework-free TypeScript, zero AWS dependency.
- 42/42 tests pass, including property-based tests (`fast-check`) proving commutativity and associativity of the PN-Counter merge across arbitrary operation orderings, and new coverage confirming `expiry_date` generalizes through the same field-merge path unchanged (15b).

### apps/api — Lambda handlers
`writeIntake`, `conflictResolver`, `conflictResolve`, `syncQuery`, `auditQuery`, `wsConnect`, `wsDisconnect`, `wsPush`, plus a local dev server (`src/local/server.ts`) that stands in for API Gateway/SQS/DynamoDB during development.
- **43/43 tests pass, including the full DynamoDB-Local-backed suite** (`conflictResolver.test.ts`, 15 tests) — previously flagged as "unverified in this environment"; the Windows `tar`-extraction fix (below) resolved it and it's now confirmed green here.
- Bedrock price-conflict explainer wired in, non-blocking, with a forced-failure test proving the conflict still displays correctly if Bedrock is down.

### apps/web — StockSync Counter client
Offline queue (IndexedDB via `idb`), connectivity toggle, WebSocket live sync, conflict review panel, audit log with an expandable vector-clock explainer (13b), attribution badges, camera-based barcode/QR quick-entry (13a).
- 25/25 unit tests pass. Production build succeeds (`vite build`; note the bundle is ~620KB post-`@zxing/browser`, flagged by Vite as a chunk-size warning — not blocking, worth revisiting if there's time). Playwright e2e spec exists for the core conflict scenario — not yet run against a live deployed stack.

### infra/cdk — AWS CDK stack
4 DynamoDB tables, SQS FIFO + DLQ, 8 Lambdas, API Gateway REST + WebSocket, CloudWatch dashboard, scoped IAM throughout (zero wildcard resources).
- `cdk synth` produces 53 real AWS resources, no errors. 20/20 infra tests pass.
- **Never deployed.** `cdk bootstrap`/`cdk deploy` have not been run against a real AWS account. See `docs/phases/phase-9.5-deployment-runbook.md` for the exact steps.

### Phase 9 self-audit
`docs/phases/phase-9-edge-case-status.md` — every row of `docs/general/07-EDGE-CASES.md` checked off. Two real bugs found and fixed in that pass (A-4 write-ordering race, B-1 `stock_anomaly` not surfaced to the client) — see that file for detail.

### Differentiator features built on top of Tier 1
- **13a — Barcode/QR quick-entry** (`BarcodeScanButton.tsx`): camera-based scan resolves to an existing item, then the counter explicitly picks Sell or Restock — it never assumes which action or a quantity, matching `phase-13-new-differentiators.md`'s spec.
- **13b — Vector-clock explainer** (`VectorClockExplainer.tsx`): each audit-log entry shows the actual stored-vs-incoming vector clocks compared and a plain-language sentence for why the resolver decided clean-apply / merged / needs-review. Reads data the resolver already writes — never a second decision path.
- **15b — Expiry-date tracking**: `expiry_date` added as a real, field-merged `inventory_records` attribute. Confirmed generalizing through `fieldMerge.ts`/`conflictResolution.ts` with zero core-logic changes — proves the engine isn't special-cased to price/shelf_location/supplier.

### Security
A plaintext AWS credentials CSV was found sitting **untracked** in `docs/general/` during a review pass — confirmed via full git history search it was never actually committed, so nothing leaked. `.gitignore` now blocks `*credentials*.csv` going forward.

## What this review session did on top of that

Went through the full repo end-to-end (all commits since the initial squashed commit, all new components, all doc claims) and verified everything actually builds/lints/tests clean from a fresh `npm install` — 130/130 tests passing across all 4 packages. Found and fixed two real issues:

- **Barcode scan didn't match its own spec.** `CounterPage.tsx` had wired the scan result to immediately submit a `sale` of quantity 1, bypassing the sell-vs-restock choice the component's own doc comment and `phase-13-new-differentiators.md` both describe. Fixed: a scan now highlights the matched item and shows an explicit Sell/Restock/Cancel strip, reusing the same quantity-1 transaction calls `ItemCard.tsx` already uses.
- **A field-name mismatch the previous doc-fix PR claimed was resolved but wasn't.** `04-API-SPEC.md` says `bedrock_explanation` must be the same name across the DB, the WebSocket push, and REST responses — but the actual WebSocket wire payload was still sending `ai_summary` (`packages/core/src/types.ts`, `conflictResolver.ts`), papered over by a manual translation in `ShopContext.tsx`. Fixed: renamed the WS field to `bedrock_explanation` everywhere and removed the now-unnecessary translation layer.

Both fixes verified: build, lint, and all 130 tests still pass after the change.

## Known gaps

| Gap | Why it's not resolved here | Who resolves it |
|---|---|---|
| **Nothing deployed to real AWS** | This environment has no AWS credentials, per the standing project constraint | You — follow `docs/phases/phase-9.5-deployment-runbook.md` |
| Bedrock model access not confirmed enabled | Requires AWS console access | You — Console → Bedrock → Model access → enable `anthropic.claude-3-haiku-20240307-v1:0` |
| Playwright e2e suite not run against a live deployed stack | Needs a real deploy first | You, after `cdk deploy` — point the suite's base URL at the real Amplify URL |
| Frontend not deployed | Needs AWS Amplify Hosting pointed at `apps/web`, with `VITE_API_URL`/`VITE_WS_URL` set from the CDK stack's outputs | You, after `cdk deploy` |
| README's two TODOs (live demo URL, demo video link) | Depend on the deploy above and a recorded demo | You, last |
| Web bundle is ~620KB post-barcode-library | Not investigated this session — `@zxing/browser` is a sizeable dependency for one feature | Worth a code-split pass if there's spare time, not required for submission |

## Next steps, in order

1. Merge `fix/barcode-prefill-and-ws-field-name` (this session's fixes).
2. Follow `docs/phases/phase-9.5-deployment-runbook.md`: AWS account/budget alarm → enable Bedrock model access → `cdk bootstrap && cdk deploy` → deploy `apps/web` via Amplify Hosting wired to the real stack outputs.
3. `npm run seed:demo`, then rehearse the core scenario (`docs/general/10-DEMO-PLAN.md`) against the real deployed stack, 5+ times.
4. Confirm the CloudWatch dashboard shows real, non-zero data.
5. Record the demo, fill in the README/blog-post TODOs, submit.
