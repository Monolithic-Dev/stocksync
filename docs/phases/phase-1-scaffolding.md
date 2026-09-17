# Phase 1: Environment & Monorepo Scaffolding

## Plan at a Glance (full roadmap — read this even if you only open this file)

**Hackathon:** AWS First Commit (Bharat Builds Tour, Stop 1) — WeMakeDevs × AWS, Ship It track.
**Duration assumption:** 10 days (stated assumption — the live event is 4 days, Sept 17–20; 10 days is the working build window this plan targets).
**Team assumption:** 1–2 person generalist team, building with Claude Code as a force-multiplier (stated assumption — no roster was specified).
**Mandatory sponsor tech:** AWS must be structurally load-bearing (Lambda, DynamoDB, SQS, API Gateway, CDK; Bedrock for the AI feature) — a judging requirement, not a preference.

| # | Phase | Goal | Days |
|---|---|---|---|
| 1 | Environment & Monorepo Scaffolding | Repo, tooling, CDK bootstrap, empty deploy succeeds | 1 |
| 2 | Core Conflict-Resolution Logic | `packages/core` fully implemented and property-tested, zero AWS | 1 |
| 3 | Data Layer & CDK Infrastructure | 4 Tier-1 DynamoDB tables + SQS FIFO+DLQ deployed via CDK | 1 |
| 4 | Write Intake & Ordering Pipeline | `POST /transactions` dedupes and enqueues correctly | 1 |
| 5 | Conflict Resolution Engine & Real-Time Push | The actual merge logic wired to AWS + WebSocket push | 2 |
| 6 | Client: Offline Queue & Core UI | StockSync Counter client, offline queueing, in-UI network toggle | 1 |
| 7 | Integration & the Core Demo Scenario | US-3/US-4/US-5 work end-to-end through the real UI, rehearsed 10x | 1 |
| 8 | AI: Price-Conflict Assistant (Bedrock) | Non-blocking Bedrock explanation on `needs_review` conflicts | 1 |
| 9 | Hardening, Observability & Edge-Case Pass | Edge case catalog resolved, CloudWatch dashboard live | 1 |
| 10 | Demo Recording & Submission | Video recorded, README written, final deploy verified, submitted | 1 |
| 11 *(conditional)* | Platform CRUD, Checkout & Cognito Auth | Only if Phase 7 finished on/ahead of schedule | Extra |
| 12 *(conditional)* | Analytics, Notifications, AI Expansion & Voice Entry | Only if Phase 11 finished with margin before Day 9 | Extra |

**The rule governing 11–12:** per `11-PHASED-SCOPE.md`, nothing in Phase 11 begins until Phase 7's exit criterion (10 consecutive successful runs of the core scenario) is actually met — not "almost met." If a conditional phase is fighting you and eating into Phase 9/10's time, cut it. An unfinished Tier-2 feature visible in a broken state during the demo hurts you more than not having built it.

---

## Header

**Goal:** A working monorepo skeleton — every workspace present, CDK bootstrapped, an empty stack deploys successfully — so every later phase has a real place to put code instead of improvising structure as it goes.

**Preconditions:** None — this is the first phase.

**Implements:** `05-TECH-STACK.md` (the chosen stack), `06-FOLDER-STRUCTURE.md` (the exact layout below), `01-PRD.md` §11 Milestones (Day 1).

---

## Task Breakdown

1. **Register and verify.** Sign up on AWS Builder Center, submit student verification. *Do this first* — verification can take time and blocks credit redemption; don't let it become a Day-3 surprise.
2. **Create the AWS account and set a budget guardrail.**
   - Create a new AWS account (or use an existing one with a Budget already tracked).
   - Console → Budgets → create a budget alarm at **$20/month**. This is not optional busywork — see `aws-solution-architect` skill's cost-discipline guidance.
3. **Initialize the monorepo root.**
   - `package.json` at repo root: `"workspaces": ["apps/*", "packages/*", "infra/*"]`, devDependencies `turbo`, `typescript`.
   - `turbo.json`: pipeline entries for `build`, `test`, `lint`.
   - `tsconfig.base.json`: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`.
   - `.eslintrc.cjs` + `packages/config/prettier.config.cjs`, referenced from every workspace's own config.
   - `.gitignore`: `node_modules/`, `dist/`, `cdk.out/`, `.cdk.staging/`, `*.d.ts`, `.env`, `.env.local`, `.turbo/`.
4. **Scaffold the five workspace roots** (empty for now, populated in later phases) exactly per `06-FOLDER-STRUCTURE.md`:
   - `apps/web/` (React/Vite client)
   - `apps/api/` (Lambda handlers)
   - `packages/core/` (framework-free business logic)
   - `packages/config/` (shared lint/tsconfig)
   - `infra/cdk/` (CDK app)
5. **Scaffold `infra/cdk`** with the empty construct files that Phase 3 will fill in:
   - `infra/cdk/bin/stocksync.ts` — CDK app entrypoint.
   - `infra/cdk/lib/stocksync-stack.ts` — the root stack, currently empty.
   - `infra/cdk/lib/constructs/DataLayer.ts`, `SyncEngine.ts`, `RealtimeApi.ts` — empty `Construct` subclasses, no resources yet.
   - `infra/cdk/lib/config.ts` — exports a `projectName` constant.
   - `cdk.json`: `"app": "npx ts-node --prefer-ts-exts bin/stocksync.ts"`.
6. **Prove the CDK app deploys empty.**
   - `cd infra/cdk && npx cdk bootstrap && npx cdk deploy`.
   - This should succeed with zero real resources — its only job is proving the toolchain (CDK CLI, AWS credentials, TypeScript compilation) works before any real infrastructure depends on it.
7. **Set up CI skeleton** (`.github/workflows/ci.yml`): `lint` → `test` → `build` stages only for now (no deploy stage yet — that's Phase 3+). Each stage runs `npm ci` then the corresponding `turbo run <stage>`.
8. **Commit and tag.** `git init` (if not already), first commit, tag `phase-1-complete`.

## Real-World Engineering Concerns

- **Credential handling:** never commit AWS credentials or a `.env` file with real values — `.env.example` only, real values stay local/in CI secrets.
- **Bootstrap idempotency:** `cdk bootstrap` is safe to re-run; don't treat a second bootstrap as an error if it reports "already bootstrapped."

## Definition of Done

- [ ] `npm install` at repo root succeeds with no errors.
- [ ] `npx cdk deploy` from `infra/cdk` completes successfully and shows 0 or 1 (bootstrap-only) stack resources.
- [ ] `.github/workflows/ci.yml` exists and a pushed commit shows a green `lint`/`test`/`build` run (test/build can be no-ops at this point, but the workflow must run without erroring).
- [ ] AWS Budget alarm is visibly configured at $20 in the console.
- [ ] Every folder in `06-FOLDER-STRUCTURE.md`'s Tier-1 tree exists (even if empty), confirmed via `find . -type d`.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| Student verification takes longer than expected, blocking credit redemption | Started on Day 1 specifically so there's slack; proceed with a personal AWS free-tier account in parallel if verification is slow |
| CDK bootstrap fails due to IAM permission gaps on a fresh account | Use an account with AdministratorAccess for the hackathon (acceptable at this scale/duration per `aws-serverless-hackathon` profile) rather than debugging a scoped bootstrap role under time pressure |

## Time Budget

**1 day.** If this runs long, the first thing to cut is the CI skeleton (step 7) — push it to Phase 3, when there's an actual deploy stage worth gating. Do not skip the CDK bootstrap-and-empty-deploy proof (step 6); discovering toolchain issues on Day 3 instead of Day 1 is far more expensive.

## Handoff

Phase 2 can now assume: a monorepo with working TypeScript tooling, an empty CDK app that deploys, and CI running lint/test/build on every push. Tag: `phase-1-complete`.
