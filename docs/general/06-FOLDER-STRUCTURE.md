# StockSync — Monorepo Folder Structure

```
stocksync/
├── apps/
│   ├── web/                          # StockSync Counter — the React client
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ItemCard.tsx
│   │   │   │   ├── ConnectivityToggle.tsx
│   │   │   │   ├── QueueDrawer.tsx
│   │   │   │   ├── ConflictReviewPanel.tsx
│   │   │   │   ├── AuditLogView.tsx
│   │   │   │   └── AttributionBadge.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useOfflineQueue.ts
│   │   │   │   ├── useWebSocketSync.ts
│   │   │   │   └── useConnectivity.ts
│   │   │   ├── offline/
│   │   │   │   ├── db.ts             # idb setup/schema for the local queue
│   │   │   │   └── replay.ts         # replay-on-reconnect logic
│   │   │   ├── state/
│   │   │   │   └── ShopContext.tsx
│   │   │   ├── pages/
│   │   │   │   └── CounterPage.tsx
│   │   │   ├── api/
│   │   │   │   └── client.ts         # thin fetch/WebSocket wrapper, typed with packages/core types
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── api/                          # Lambda handlers
│       ├── src/
│       │   ├── handlers/
│       │   │   ├── writeIntake.ts
│       │   │   ├── conflictResolver.ts
│       │   │   ├── syncQuery.ts
│       │   │   ├── auditQuery.ts
│       │   │   ├── conflictList.ts
│       │   │   ├── conflictResolve.ts
│       │   │   ├── wsConnect.ts
│       │   │   ├── wsDisconnect.ts
│       │   │   └── wsPush.ts         # shared push-to-all-connections helper
│       │   ├── lib/
│       │   │   ├── dynamo.ts         # thin AWS SDK v3 client setup
│       │   │   ├── bedrock.ts        # Bedrock Runtime client + prompt builder
│       │   │   └── logger.ts         # structured JSON logging helper
│       │   └── index.ts
│       ├── test/                     # integration tests against DynamoDB Local
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── core/                         # the actual engineering IP — pure, framework-free
│   │   ├── src/
│   │   │   ├── types.ts              # Transaction, InventoryRecord, VectorClock, etc.
│   │   │   ├── vectorClock.ts        # dominates()/isConcurrent() comparison logic
│   │   │   ├── pnCounter.ts          # PN-Counter merge logic
│   │   │   ├── fieldMerge.ts         # field-level merge + conflict detection
│   │   │   ├── conflictResolution.ts # orchestrates the above into one resolve() function
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── pnCounter.test.ts           # example-based unit tests
│   │   │   ├── pnCounter.property.test.ts  # fast-check property-based tests
│   │   │   ├── vectorClock.test.ts
│   │   │   └── conflictResolution.test.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── config/                       # shared eslint/tsconfig/prettier configs
│       ├── eslint-preset.cjs
│       ├── tsconfig.base.json
│       └── prettier.config.cjs
│
├── infra/
│   └── cdk/
│       ├── bin/
│       │   └── stocksync.ts
│       ├── lib/
│       │   ├── stocksync-stack.ts    # the whole stack: tables, Lambdas, API GW, SQS
│       │   ├── constructs/
│       │   │   ├── DataLayer.ts      # the 4 DynamoDB tables + GSIs
│       │   │   ├── SyncEngine.ts     # SQS FIFO + DLQ + the two core Lambdas
│       │   │   └── RealtimeApi.ts    # WebSocket API + connection Lambdas
│       │   └── config.ts
│       ├── test/
│       │   └── stocksync-stack.test.ts  # CDK snapshot/assertion tests
│       ├── cdk.json
│       ├── tsconfig.json
│       └── package.json
│
├── docs/                             # this entire documentation set lives here
│   ├── 00-INDEX.md
│   ├── 01-PRD.md
│   ├── 02-ARCHITECTURE.md
│   ├── 03-DATABASE-SCHEMA.md
│   ├── 04-API-SPEC.md
│   ├── 05-TECH-STACK.md
│   ├── 06-FOLDER-STRUCTURE.md
│   ├── 07-EDGE-CASES.md
│   ├── 08-TESTING-STRATEGY.md
│   ├── 09-BUILD-PLAN.md
│   └── 10-DEMO-PLAN.md
│
├── scripts/
│   ├── seed-demo-data.ts             # populates inventory_records with 2-5 demo items
│   ├── reset-demo.ts                 # resets state between rehearsal takes
│   └── simulate-conflict.ts          # scripted CLI reproduction of the core conflict scenario, for fast manual testing outside the browser
│
├── .github/
│   └── workflows/
│       ├── ci.yml                    # lint + test + build on every PR
│       └── deploy.yml                # cdk deploy (backend) on merge to main,
│                                      # THEN update Amplify's env vars from
│                                      # the CDK stack's API Gateway outputs —
│                                      # Amplify's own git-triggered build only
│                                      # handles the frontend; it does not know
│                                      # about the backend URL on its own
│
├── turbo.json
├── package.json                      # workspace root, defines the workspaces array
├── tsconfig.base.json
├── .eslintrc.cjs
├── .gitignore
└── README.md
```

---

## Why `packages/core` Is the Single Most Important Decision Here

This is worth explaining explicitly, because it's the structural decision
that most affects both code quality and how well Claude Code can help
you build this.

The conflict-resolution logic — vector clock comparison, PN-counter
merging, field-level merge detection — is the actual engineering
substance of this project. If that logic is written inline inside the
Lambda handler, it's tangled up with AWS SDK calls, error handling, and
DynamoDB-specific data shapes, which makes it:

- **Hard to unit test** — you'd need to mock DynamoDB just to test a pure
  math/logic question like "does merging these two counters commute?"
- **Hard to reason about in isolation** — when Claude Code (or you) are
  debugging a merge-correctness question, you don't want AWS
  infrastructure concerns in the same file.
- **Hard to reuse** — the same logic can't be run inside a fast, offline
  test suite (`packages/core/tests`) without provisioning any AWS
  resources.

By pulling this into a separate, dependency-free package:

- `packages/core` can be tested exhaustively and fast, including with
  property-based tests, entirely offline.
- `apps/api`'s Lambda handlers become thin — they fetch data, call
  `resolve()` from `packages/core`, and write the result. This is
  standard "hexagonal architecture" / "ports and adapters" practice: keep
  business logic pure and push infrastructure concerns to the edges.
- If you ever wanted to preview a merge result on the client before it's
  confirmed by the server (optimistic UI), `apps/web` could import the
  exact same `packages/core` logic, guaranteeing the client's guess and
  the server's actual resolution can never silently disagree in their
  algorithm, only in timing.

This is the kind of structural choice that reads immediately as
"senior engineer built this," because it's driven by a clear
separation-of-concerns principle, not by convenience.

---

## Platform Layer Additions (Tier 2 — see `11-PHASED-SCOPE.md`)

These are added incrementally, in the priority order given in the
phased-scope doc — don't scaffold all of this on Day 1, add each piece
when you actually reach that tier's build step.

```
apps/
├── web/src/
│   ├── pages/
│   │   ├── CounterPage.tsx          # existing, Tier 1
│   │   ├── DashboardPage.tsx        # analytics + reorder suggestions
│   │   ├── ProductsPage.tsx         # CRUD screens
│   │   ├── CheckoutPage.tsx         # cart + checkout
│   │   ├── AssistantPage.tsx        # natural-language chat UI
│   │   └── LoginPage.tsx            # Cognito-backed auth
│   └── components/
│       ├── ProductForm.tsx
│       ├── CartDrawer.tsx
│       ├── AnalyticsChart.tsx       # recharts-based
│       ├── VoiceEntryButton.tsx
│       └── BarcodeScanButton.tsx    # camera-based scan; resolves to an
│                                    # item_id and pre-fills the existing
│                                    # sell/restock action — not a new
│                                    # transaction type
│
└── api/src/handlers/
    ├── productsCrud.ts
    ├── categoriesCrud.ts
    ├── suppliersCrud.ts
    ├── shopsCrud.ts
    ├── usersCrud.ts
    ├── checkout.ts
    ├── dailyRollup.ts               # EventBridge-scheduled
    ├── notificationCheck.ts         # EventBridge-scheduled
    ├── askAssistant.ts
    ├── reorderSuggestions.ts
    └── voiceTransaction.ts

infra/cdk/lib/constructs/
├── AuthLayer.ts                     # Cognito User Pool + App Client
├── PlatformCrud.ts                  # products/categories/suppliers/shops/users tables + Lambdas
├── AnalyticsPipeline.ts             # EventBridge rule + dailyRollup Lambda + daily_analytics table
└── NotificationLayer.ts             # SNS topic + SES config + notificationCheck Lambda
```
