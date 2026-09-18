# StockSync — Project Status

Last updated: 2026-09-18. This is a living snapshot, not a one-time report — update it as state changes rather than trusting it blindly after time passes.

## TL;DR

Tier 1 (the entire judged scope) plus three additional differentiator features (13a, 13b, 15b) are built, tested, and self-audited. **Deployed and live on real AWS** (account `509399625129`, `us-east-1`) — backend confirmed end-to-end with a real transaction, frontend confirmed loading real data in a real browser. What's left is recording the demo video and submitting.

### Live deployment reference

- **Frontend:** https://main.d18ash44o1uc8d.amplifyapp.com (Amplify app `d18ash44o1uc8d`, manually deployed via CLI — not connected to GitHub auto-deploy, so a code change requires re-running the build+zip+deploy steps, not just a `git push`)
- **REST API:** `https://wy5tjymmd1.execute-api.us-east-1.amazonaws.com`
- **WebSocket:** `wss://a3dxy9xt6a.execute-api.us-east-1.amazonaws.com/prod`
- **Bedrock:** blocked on AWS's standard new-account verification hold as of deploy time ("~2 hours," per AWS's own message) — recheck before relying on the price-conflict explanation in a live demo; everything else is unaffected since Bedrock failures degrade gracefully by design.
- Demo data is seeded and reset via `scripts/seed-demo-data.ts`/`reset-demo.ts` — same scripts as local, just point `INVENTORY_RECORDS_TABLE_NAME`/`AUDIT_LOG_TABLE_NAME` at the real deployed table names (`aws dynamodb list-tables --profile stocksync`) and set `AWS_PROFILE=stocksync AWS_REGION=us-east-1`.

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
- **Deployed.** Live in account `509399625129`/`us-east-1` — see the "Live deployment reference" section above. `anthropic.claude-3-haiku-20240307-v1:0` (this stack's original Bedrock model choice) turned out to be fully retired from the catalog at deploy time; fixed to `anthropic.claude-haiku-4-5-20251001-v1:0` before deploying (see `apps/api/src/lib/bedrock.ts`, `infra/cdk/lib/config.ts`).

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
| Bedrock model access verification hold | AWS's standard new-account hold ("~2 hours" per their own message) was still active as of deploy | Recheck before the live demo — call the deployed conflict-resolver's Bedrock path once and confirm it returns a real explanation, not an access-denied error |
| Playwright e2e suite not run against the live deployed stack | Not exercised this session — the manual smoke test (a real `POST /transactions` → `GET /sync` → `GET /audit` round trip) already proved the pipeline works, but the automated suite is stronger evidence | Point the suite's base URL at the real Amplify/API URLs and run it once before recording |
| Amplify frontend was deployed via CLI (zip upload), not GitHub auto-deploy | Fastest path to a working URL without a console OAuth step | A future code change needs a manual rebuild+redeploy (`vite build` with the real `VITE_API_BASE_URL`/`VITE_WEBSOCKET_URL`, then `aws amplify create-deployment`/upload/`start-deployment`) — not just a `git push`. Fine for a hackathon demo; connect it to GitHub properly if this needs to keep evolving past submission. |
| Demo video not recorded | Needs a human following `docs/general/10-DEMO-PLAN.md`'s script | You |
| Web bundle is ~620KB post-barcode-library | Not investigated — `@zxing/browser` is a sizeable dependency for one feature | Worth a code-split pass if there's spare time, not required for submission |
| `docs/phases/phase-9.5-deployment-runbook.md` names env vars `VITE_API_URL`/`VITE_WS_URL` | Doc drift — the actual code uses `VITE_API_BASE_URL`/`VITE_WEBSOCKET_URL` (`apps/web/src/api/client.ts`) | Worth a quick doc fix, not blocking since the real values were used for the actual deploy |

## Next steps, in order

1. Recheck Bedrock access is live, then rehearse the same-field price-conflict scenario against the real deployed stack to confirm the explanation actually renders.
2. Rehearse the full core scenario (`docs/general/10-DEMO-PLAN.md`) against the real deployed stack, 5+ times.
3. Confirm the CloudWatch dashboard shows real, non-zero data (it will, once the above rehearsals generate traffic).
4. Record the demo, fill in the remaining README/blog-post TODO (video link), submit.
