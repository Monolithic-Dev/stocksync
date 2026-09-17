# Phase 3: Data Layer & CDK Infrastructure (Tier 1)

## Header

**Goal:** The four Tier-1 DynamoDB tables and the SQS FIFO+DLQ queue exist as real, deployed AWS resources, provisioned entirely through CDK, with least-privilege IAM already wired for the Lambdas Phase 4/5 will add.

**Preconditions:** Phase 1 complete (CDK app deploys empty). Phase 2 complete (types this construct's data shape should match are finalized in `packages/core/src/types.ts`).

**Implements:** `03-DATABASE-SCHEMA.md` §1–5 (access patterns AP-1 through AP-6, all four tables), `02-ARCHITECTURE.md` §3.4/§3.6 (SQS FIFO grouped by `record_id`, DLQ), `aws-solution-architect` skill's IAM least-privilege pattern.

---

## Task Breakdown

1. **`infra/cdk/lib/constructs/DataLayer.ts`** — implement the construct:
   - `inventory_records` table: partition key `pk` (String), sort key `sk` (String), on-demand billing, DynamoDB Streams enabled (`NEW_AND_OLD_IMAGES`) — Streams is what Phase 5's resolver Lambda subscribes to.
   - `write_dedup` table: partition key `idempotency_key` (String), on-demand, TTL attribute `ttl`.
   - `audit_log` table: partition key `pk` (String), sort key `sk` (String), on-demand.
   - `ws_connections` table: partition key `connection_id` (String), on-demand, plus a GSI `ShopConnectionsIndex` with partition key `shop_id` (serves AP-5: "find all connections to notify for a shop").
   - Also add GSI `ShopConflictIndex` on `inventory_records` (partition key `shop_id`, sort key `conflict_status`) — serves AP-7, needed by Phase 9's conflict-list view.
   - Export all four tables as public readonly properties so `SyncEngine.ts` (Phase 4/5) can call `.grantReadWriteData(...)` on them without reaching into CDK internals.

2. **`infra/cdk/lib/constructs/SyncEngine.ts`** — scaffold (queue only in this phase; Lambdas added in Phase 4):
   - Dead-letter queue: `new sqs.Queue(this, "DeadLetterQueue", { fifo: true })`.
   - Write queue: `new sqs.Queue(this, "WriteQueue", { fifo: true, contentBasedDeduplication: false, deadLetterQueue: { queue: dlq, maxReceiveCount: 5 }, visibilityTimeout: Duration.seconds(30) })`.
   - **`contentBasedDeduplication: false` is deliberate** — deduplication is handled explicitly via `MessageDeduplicationId` set from the client's idempotency key at send time (Phase 4), not SQS's content hash, since two structurally-identical-but-independent transactions (e.g. two separate "sell 1 unit" actions) must NOT be deduplicated against each other.

3. **Wire `DataLayer` and `SyncEngine` into `stocksync-stack.ts`**, instantiating both constructs in the root stack.

4. **CDK infrastructure test** (`infra/cdk/test/stocksync-stack.test.ts`, using `aws-cdk-lib/assertions`):
   - Assert `inventory_records` has `StreamSpecification.StreamViewType === "NEW_AND_OLD_IMAGES"`.
   - Assert the write queue's `FifoQueue` property is `true`.
   - Assert the write queue's `RedrivePolicy` references the DLQ with `maxReceiveCount: 5`.
   - Assert `write_dedup` has a `TimeToLiveSpecification` on `ttl`.

5. **Deploy and manually verify:**
   - `npx cdk diff` — review before applying.
   - `npx cdk deploy`.
   - `aws dynamodb list-tables` — confirm all four appear.
   - `aws dynamodb describe-table --table-name <inventory_records-name> --query 'Table.StreamSpecification'` — confirm Streams is live.

6. **Update CI** (`.github/workflows/ci.yml`): add a `deploy` job (per `senior-devops` skill's CDK pipeline pattern) gated behind `environment: staging` for now — production gating comes later once there's something worth protecting from a bad deploy.

7. **Commit and tag** `phase-3-complete`.

## Real-World Engineering Concerns

- **Least-privilege IAM, set up now even though no Lambda uses it yet.** Don't grant anything broad "temporarily" — Phase 4/5 will call `.grantReadWriteData()` / `.grantWriteData()` on the specific tables each specific Lambda needs, and that pattern only works cleanly if the tables are exposed as typed properties from this construct now.
- **On-demand billing mode** for all four tables — no capacity planning needed at hackathon scale, and it avoids a whole class of throttling issues that provisioned capacity could introduce under time pressure.
- **Streams retention**: DynamoDB Streams records are retained 24 hours by default — fine for this project, no action needed, but worth knowing if a rehearsal run seems to "lose" old events after debugging pauses longer than a day.

## Definition of Done

- [ ] `npx cdk deploy` succeeds and all four tables plus both queues exist in the AWS console.
- [ ] `infra/cdk/test/stocksync-stack.test.ts` passes.
- [ ] `aws dynamodb describe-table` confirms Streams is `NEW_AND_OLD_IMAGES` on `inventory_records`.
- [ ] The DLQ is visibly attached to the write queue in the SQS console (`RedrivePolicy` set).
- [ ] No IAM role in the stack yet has a wildcard resource (`"*"`) on any DynamoDB action — confirmed by inspecting the synthesized CloudFormation (`npx cdk synth`).

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| GSI added after initial table creation requires a table replacement in some CDK versions | Include both GSIs in the *first* deploy of `DataLayer.ts`, not as a later addition — avoids a destructive table replacement mid-build |
| `cdk deploy` billed to student account hits an unexpected charge from a misconfigured on-demand table | On-demand DynamoDB and SQS FIFO both sit inside AWS's always-free tier at this scale (see `aws-solution-architect` skill) — if a charge appears, it's almost certainly the NAT Gateway trap, not these resources; this stack should never provision a NAT Gateway |

## Time Budget

**1 day.** If this runs long, cut the CDK infrastructure test (step 4) first — manual verification via the AWS CLI (step 5) is an acceptable substitute for a few days, though it should come back before Phase 9's hardening pass. Do not cut the DLQ — a queue with no dead-letter handling risks a stuck pipeline exactly when Phase 5's resolver logic still has bugs to find.

## Handoff

Phase 4 can now assume: all four tables and both queues exist, are deployed, and are exposed as typed CDK construct properties ready to grant permissions against. Tag: `phase-3-complete`.
