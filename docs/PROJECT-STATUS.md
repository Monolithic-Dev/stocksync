# StockSync — Project Status

Last updated: 2026-09-19. This is a living snapshot, not a one-time report — update it as state changes rather than trusting it blindly after time passes.

## TL;DR

Tier 1 (the entire originally-judged scope) plus differentiator features (13a, 13b, 15b), the Tier 2 platform layer (19b — products/categories/suppliers CRUD + checkout), and real Cognito authentication with owner/manager/counter_staff roles are built, tested, and **deployed live on real AWS** (account `509399625129`, `us-east-1`) — backend confirmed end-to-end with real transactions, frontend confirmed loading real data in a real browser, and the API confirmed rejecting unauthenticated requests (`401`). The project is now expanding beyond the original hackathon scope toward a complete product: an owner analytics dashboard and notifications are in progress.

### Live deployment reference

- **Frontend:** https://main.d18ash44o1uc8d.amplifyapp.com (Amplify app `d18ash44o1uc8d`, manually deployed via CLI — not connected to GitHub auto-deploy, so a code change requires re-running the build+zip+deploy steps, not just a `git push`)
- **REST API:** `https://wy5tjymmd1.execute-api.us-east-1.amazonaws.com` — every route now requires a signed-in user (Cognito JWT authorizer); a bare `curl` with no token gets `401`.
- **WebSocket:** `wss://a3dxy9xt6a.execute-api.us-east-1.amazonaws.com/prod` — `$connect` verifies the same JWT manually (passed as a `token` query param; WebSocket handshakes can't carry a custom header from a browser client).
- **Cognito:** User Pool `us-east-1_o4sLGPvgx`, app client `3eing3a89fpfuuv95rea4jnq69` — sign-up/sign-in happen directly against Cognito from the browser (`apps/web/src/lib/cognito.ts`), never through this API. See `infra/cdk/lib/constructs/Auth.ts` for the full self-signup/staff-invite flow.
- **Bedrock:** the deployment account (509399625129) is blocked by an account-level "Anthropic use-case details" approval gate (AWS Support case pending, Basic support plan, no guaranteed SLA). Worked around by routing the price-conflict explainer through a second AWS account's credentials (Secrets Manager) — see `apps/api/src/lib/bedrock.ts`. That second account is itself currently blocked on an `INVALID_PAYMENT_INSTRUMENT` error pending a payment method update. Both accounts' status should be rechecked before relying on the AI explanation in a live demo; everything else is fully unaffected since Bedrock failures degrade gracefully by design.
- Demo data is seeded and reset via `scripts/seed-demo-data.ts`/`reset-demo.ts` — same scripts as local, just point the table-name env vars at the real deployed table names (`aws dynamodb list-tables --profile stocksync`) and set `AWS_PROFILE=stocksync AWS_REGION=us-east-1`. Note: these scripts write directly to DynamoDB and aren't Cognito-aware, so seeded data isn't scoped to any one real account's `shop_id` — fine for exercising the sync engine directly, but a real signed-up account won't see seeded items unless its `shop_id` matches.

## What's done

### packages/core — the conflict-resolution engine
Vector clocks, PN-Counter CRDT, field-level merge, orchestrating `resolve()`. Framework-free TypeScript, zero AWS dependency.
- 42/42 tests pass, including property-based tests (`fast-check`) proving commutativity and associativity of the PN-Counter merge across arbitrary operation orderings, and coverage confirming `expiry_date` generalizes through the same field-merge path unchanged (15b).

### apps/api — Lambda handlers
`writeIntake`, `conflictResolver`, `conflictResolve`, `syncQuery`, `auditQuery`, `wsConnect`, `wsDisconnect`, `wsPush`, plus the Tier 2 CRUD/checkout handlers and the Cognito `postConfirmation`/`staffInvite` handlers (below), plus a local dev server (`src/local/server.ts`) that stands in for API Gateway/SQS/DynamoDB during development (deliberately not Cognito-aware — local dev stays unauthenticated by design, see `authContext.ts`'s fallback).
- Full test suite passing, including the DynamoDB-Local-backed `conflictResolver.test.ts` suite, the cross-account Bedrock credential tests, and the new auth tests (`authContext.test.ts`, `postConfirmation.test.ts`, `staffInvite.test.ts`, `wsConnect.test.ts`).
- Bedrock price-conflict explainer wired in, non-blocking, with a forced-failure test proving the conflict still displays correctly if Bedrock is down.
- `authContext.ts`: every handler derives `shop_id`/role from the API Gateway JWT authorizer's verified claims when present, never trusting a client-supplied `shop_id` — closes the cross-tenant gap the Tier 2 CRUD layer originally shipped with (its own code comments flagged this explicitly as a known, deferred limitation).

### apps/web — StockSync Counter client
Offline queue (IndexedDB via `idb`), connectivity toggle, WebSocket live sync, conflict review panel, audit log with an expandable vector-clock explainer (13b), attribution badges, camera-based barcode/QR quick-entry (13a), a hero/landing page with real sign-up/sign-in (`AuthPanel.tsx`) replacing the old free-text shop/counter picker, a post-login counter picker, a staff-invite page (owner-only), plus the Tier 2 Products/Checkout pages (below).
- Full unit test suite passing (52 tests, 18 new for auth: `cognito.test.ts`, `AuthContext.test.tsx`, `AuthPanel.test.tsx`, `StaffPage.test.tsx`). Production build succeeds. Playwright e2e spec covers the core conflict scenario against a local backend; also verified manually against the real deployed stack via direct API calls.

### infra/cdk — AWS CDK stack
DynamoDB tables (Tier 1: `inventory_records`, `write_dedup`, `audit_log`, `ws_connections`; Tier 2/19b: `products`, `categories`, `suppliers`, `orders`), SQS FIFO + DLQ, Lambdas for both tiers plus Auth's two triggers, API Gateway REST + WebSocket with a Cognito JWT authorizer on every REST route, a Cognito User Pool with 3 role groups, CloudWatch dashboard, a Secrets Manager secret for the cross-account Bedrock credentials, scoped IAM throughout (zero wildcard resources on DynamoDB/SQS; Cognito's own trigger IAM grant is scoped to "user pools in this account/region" rather than the one specific pool, to break a genuine CloudFormation circular dependency between the pool and its own trigger Lambda — see `Auth.ts`'s comment).
- **Deployed and live** in account `509399625129`/`us-east-1` — see the "Live deployment reference" section above. `anthropic.claude-3-haiku-20240307-v1:0` (this stack's original Bedrock model choice) turned out to be fully retired from the catalog at deploy time; fixed to `anthropic.claude-haiku-4-5-20251001-v1:0`.

### Phase 9 self-audit
`docs/phases/phase-9-edge-case-status.md` — every row of `docs/general/07-EDGE-CASES.md` checked off. Two real bugs found and fixed in that pass (A-4 write-ordering race, B-1 `stock_anomaly` not surfaced to the client) — see that file for detail.

### Differentiator features built on top of Tier 1
- **13a — Barcode/QR quick-entry** (`BarcodeScanButton.tsx`): camera-based scan resolves to an existing item, then the counter explicitly picks Sell or Restock — it never assumes which action or a quantity.
- **13b — Vector-clock explainer** (`VectorClockExplainer.tsx`): each audit-log entry shows the actual stored-vs-incoming vector clocks compared and a plain-language sentence for why the resolver decided clean-apply / merged / needs-review. Reads data the resolver already writes — never a second decision path.
- **15b — Expiry-date tracking**: `expiry_date` added as a real, field-merged `inventory_records` attribute. Confirmed generalizing through `fieldMerge.ts`/`conflictResolution.ts` with zero core-logic changes — proves the engine isn't special-cased to price/shelf_location/supplier.
- **19b — Products/categories/suppliers CRUD + checkout**: 4 new DynamoDB tables (`products` w/ `CategoryIndex` GSI, `categories`, `suppliers`, `orders`), a shared last-write-wins CRUD handler factory (`apps/api/src/lib/crudTable.ts`), and `checkout.ts` — which calls `writeIntake.ts`'s handler directly, in-process, so every checkout line item gets the exact same idempotency/ordering/conflict-resolution guarantees as a manual sale. `ProductsPage.tsx`/`CheckoutPage.tsx` added to the client, switched via a `?page=` query param.
- **Cross-account Bedrock workaround**: the deployment account's Bedrock access is blocked by AWS at the account level; the price-conflict explainer instead authenticates to Bedrock using a second AWS account's credentials, stored in Secrets Manager and never committed to source. One env var removal reverts to the original same-account path once/if the deployment account's own access clears.
- **Real Cognito authentication (owner/manager/counter_staff)**: self-signup creates a new shop and makes the signer its "owner" (a Cognito `postConfirmation` trigger, the only path into that group); owners invite `manager`/`counter_staff` accounts via `POST /staff` (`AdminCreateUser`, scoped to the inviter's own `shop_id` — never client-supplied). Every REST route sits behind an API Gateway JWT authorizer; `shop_id` is derived from the verified token, not the request. `counter_staff` can browse the catalog and run checkout/transactions but can't create/update/delete products, categories, or suppliers.

### Security
A plaintext AWS credentials CSV was found sitting **untracked** in `docs/general/` during an earlier review pass — confirmed via full git history search it was never actually committed, so nothing leaked. `.gitignore` blocks `*credentials*.csv` going forward.

## `.env.example` overhaul

Root `.env.example` documents every AWS credential the project needs, lists exactly which AWS services the stack requires, and lists every CDK-output resource name the local scripts need. `seed-demo-data.ts`/`reset-demo.ts`/`simulate-conflict.ts` auto-load `.env.local` via `dotenv` (silently no-ops if absent, so local-only dev is unaffected).

## In progress — building toward a complete product

Per explicit direction to expand well beyond the original hackathon-judged scope:

1. ~~Real authentication (Cognito)~~ — **done, deployed live** (see above).
2. **Owner-facing analytics dashboard** — sales/revenue rollups, low-stock alerts, and the conflict rate reframed as a trust-score business signal.
3. **Notifications** — low-stock and conflict alerts via email (SES).
4. **Visual/design polish** — dark mode, toast notifications, loading skeletons.

## Known gaps

| Gap | Why it's not resolved here | Who resolves it |
|---|---|---|
| Bedrock: both the deployment account and its cross-account workaround are currently blocked | Deployment account needs an AWS Support case resolved (Basic support, no SLA); the workaround account needs a payment method added | Recheck periodically — no code changes needed once either clears |
| Playwright e2e suite not run against the live deployed stack | The manual smoke test (real `POST /transactions` → `GET /sync` round trips) already proved the pipeline works end-to-end against the real stack | Point the suite's base URL at the real Amplify/API URLs and run it once before recording |
| Amplify frontend was deployed via CLI (zip upload), not GitHub auto-deploy | Fastest path to a working URL without a console OAuth step | A future code change needs a manual rebuild+redeploy — not just a `git push` |
| Demo video not recorded | Needs a human following `docs/general/10-DEMO-PLAN.md`'s script | You |
| Web bundle is ~620KB+ post-barcode-library | Not investigated — `@zxing/browser` is a sizeable dependency for one feature | Worth a code-split pass |
| 15a (chaos demo) not rehearsed | Needs a live Lambda to throttle via the AWS Console | Rehearse once the other phases land — see the demo plan's placeholder beat |
| `docs/general/10-DEMO-PLAN.md` still describes the old `?shop_id=&counter_id=` shareable-link flow as the entry point | Written before Cognito auth landed; the real flow now starts with sign-up/sign-in (`AuthPanel`), then a counter-only picker | Update the demo plan's script to start from sign-in before recording |
| `scripts/seed-demo-data.ts`/`reset-demo.ts` write directly to DynamoDB, bypassing Cognito | They predate auth and aren't part of the request path auth protects | Fine as-is for engine-level testing; a real demo needs a real signed-up account whose `shop_id` matches the seeded data, or seed data scoped to that account's actual `shop_id` |

## Next steps, in order

1. Finish the remaining in-progress build-out above (dashboard, notifications, polish).
2. Recheck Bedrock access on both accounts.
3. Update `10-DEMO-PLAN.md`'s script to start from real sign-in, then rehearse the full core scenario against the real deployed stack, 5+ times, including the new CRUD/checkout/auth flows.
4. Confirm the CloudWatch dashboard shows real, non-zero data.
5. Record the demo, fill in the remaining README/blog-post TODOs, submit.
