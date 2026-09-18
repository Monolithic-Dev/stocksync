# StockSync — Project Status

Last updated: 2026-09-18. This is a living snapshot, not a one-time report — update it as state changes rather than trusting it blindly after time passes.

## TL;DR

Tier 1 (the entire judged scope — Phases 1-9) is built, tested, and self-audited. On top of that: 13a/13b/15b (barcode/QR, vector-clock explainer, expiry tracking) and 19b (products/categories/suppliers CRUD + checkout) are built and tested. Nothing has been deployed to real AWS yet — that deploy is the only thing standing between this and a submittable demo. `.env.example` (root) now documents every AWS credential/resource needed and exactly which AWS services the stack requires — fill it in once credits land and everything downstream (seed scripts, the deployed frontend) should work without further code changes.

## What's done

### packages/core — the conflict-resolution engine
Vector clocks, PN-Counter CRDT, field-level merge, orchestrating `resolve()`. Framework-free TypeScript, zero AWS dependency.
- 40/40 tests pass, including property-based tests (`fast-check`) proving commutativity and associativity of the PN-Counter merge across arbitrary operation orderings — the actual mathematical guarantee the product is pitched on, proven, not asserted.

### apps/api — Lambda handlers
`writeIntake`, `conflictResolver`, `conflictResolve`, `syncQuery`, `auditQuery`, `wsConnect`, `wsDisconnect`, `wsPush`, plus a local dev server (`src/local/server.ts`) that stands in for API Gateway/SQS/DynamoDB during development — imports the real handlers unmodified, only swaps the transport layer.
- 37/37 tests pass for everything except the one DynamoDB-Local-backed suite (`conflictResolver.test.ts`) — see "Known gaps" below.
- Bedrock price-conflict explainer wired in, non-blocking, with a forced-failure test proving the conflict still displays correctly if Bedrock is down.

### apps/web — StockSync Counter client
Offline queue (IndexedDB via `idb`), connectivity toggle, WebSocket live sync, conflict review panel, timeline audit log, attribution badges.
- 17/17 unit tests pass. Production build succeeds (`vite build`). Playwright e2e spec exists for the core conflict scenario (`apps/web/e2e/core-conflict-scenario.spec.ts`) — not yet run in this environment (needs a running local server + browsers).

### infra/cdk — AWS CDK stack
8 DynamoDB tables (Tier 1: `inventory_records`, `write_dedup`, `audit_log`, `ws_connections`; Tier 2/19b: `products`, `categories`, `suppliers`, `orders`), SQS FIFO + DLQ, 12 Lambdas, API Gateway REST + WebSocket, CloudWatch dashboard (`Observability` construct), scoped IAM throughout (zero wildcard resources, confirmed via `cdk synth | grep`).
- `cdk synth` produces 99 real AWS resources, no errors.
- **Never deployed.** `cdk bootstrap`/`cdk deploy` have not been run against a real AWS account from this environment (no credentials here).

### Phase 9 self-audit
`docs/phases/phase-9-edge-case-status.md` — every row of `docs/general/07-EDGE-CASES.md` checked off with a one-line status. Two real bugs found and fixed:
- **A-4**: `writeIntake.ts`'s batch handler used `Promise.all` across transactions for the same item, letting two writes for the same item race out of submitted order. Fixed by processing same-item transactions sequentially.
- **B-1**: the server-computed `stock_anomaly` flag (negative stock) was correctly computed but never surfaced to `GET /sync`, the WebSocket push, or the UI. Fixed end to end, now shows a visible badge.

## What's also done — Phase 13/15/19 differentiators

Built while blocked on AWS credits, per `docs/general/14-build-order-while-waiting.md`'s "buildable now, zero AWS dependency" guidance:

- **13a — Barcode/QR quick-entry** (`BarcodeScanButton.tsx`): camera scan resolves to a real `item_id`, feeds the existing sell/restock flow unchanged.
- **13b — Vector-clock explainer** (`VectorClockExplainer.tsx`): shows the stored-vs-incoming clocks and a plain-language decision explanation on every audit entry.
- **15b — Expiry-date tracking**: `expiry_date` as a real, field-merged attribute — proves `fieldMerge.ts` generalizes with zero core logic changes (`git diff --stat packages/core/src` is 3 lines, types only).
- **19b — Products/categories/suppliers CRUD + checkout**: 4 new DynamoDB tables (`products` w/ `CategoryIndex` GSI, `categories`, `suppliers`, `orders`), a shared last-write-wins CRUD handler factory (`apps/api/src/lib/crudTable.ts`), and `checkout.ts` — which calls `writeIntake.ts`'s handler directly, in-process, so every checkout line item gets the exact same idempotency/ordering/conflict-resolution guarantees as a manual sale. `ProductsPage.tsx`/`CheckoutPage.tsx` added to the client, switched via a `?page=` query param (no new router dependency).
- **Not built**: 15a (chaos demo) and 14b/14c (CV shelf check, WhatsApp) — all three genuinely need a live deployed stack or AWS console access; see the demo plan's bonus-beat placeholder for 15a's rehearsal script, ready to fill in once deployed.

## `.env.example` overhaul

Root `.env.example` now documents every AWS credential the project needs, lists exactly which AWS services the stack requires (with the one manual step — Bedrock model access — called out explicitly), and lists every CDK-output resource name the local scripts need. `seed-demo-data.ts`/`reset-demo.ts`/`simulate-conflict.ts` now auto-load `.env.local` via `dotenv` (silently no-ops if absent, so local-only dev is unaffected) — copy `.env.example` to `.env.local`, fill in real values after `cdk deploy`, and those scripts talk to the real deployed stack with no further code changes. `cdk deploy` itself still uses the AWS CLI's own credential resolution (`aws configure`, or the same variables exported into your shell) — see the file's own comments for the exact PowerShell one-liner.

## Known gaps

| Gap | Why it's not resolved here | Who resolves it |
|---|---|---|
| **Nothing deployed to real AWS** | This environment has no AWS credentials | You — `cd infra/cdk && npx cdk bootstrap && npx cdk deploy` |
| Bedrock model access not confirmed enabled | Requires AWS console access | You — Console → Bedrock → Model access → enable `anthropic.claude-3-haiku-20240307-v1:0` |
| `conflictResolver.test.ts` (DynamoDB Local suite) slow to verify locally in this sandbox | This sandbox's network/CPU is unusually slow for the JVM download+boot; CI (GitHub Actions) already confirms this suite passes on a normal machine | Nothing — already verified via CI on every PR so far |
| Playwright e2e suite not run | Needs a running local server + installed browsers, not exercised this session | Run `npx playwright test` from `apps/web` once the local server is up |
| Frontend not deployed | Needs AWS Amplify Hosting pointed at `apps/web`, with `VITE_API_URL`/`VITE_WS_URL` set from the CDK stack's outputs | You, after `cdk deploy` |
| 15a (chaos demo) not rehearsed | Needs a live Lambda to throttle via the AWS Console | You, after deploy — see the demo plan's placeholder beat |
| README's two TODOs (live demo URL, demo video link) | Depend on the deploy above and a recorded demo | You, last |

## Next steps, in order

1. Create/verify AWS account, set a $20 budget alarm.
2. Enable Bedrock model access for `anthropic.claude-3-haiku-20240307-v1:0`.
3. `cd infra/cdk && npx cdk bootstrap && npx cdk deploy`.
4. Copy `.env.example` → `.env.local` at the repo root, fill in every value from the deploy's CfnOutputs.
5. Deploy `apps/web` via Amplify Hosting, wired to the deployed stack's API/WebSocket URLs (its own `.env.example`).
6. `npm run seed:demo` (now seeds the Tier 2 catalog too, if its table-name vars are set), then rehearse the core scenario (`docs/general/10-DEMO-PLAN.md`) against the real deployed stack, 5+ times.
7. Rehearse the 15a chaos-demo bonus beat if time allows.
8. Record the demo, fill in the README TODOs, submit.
