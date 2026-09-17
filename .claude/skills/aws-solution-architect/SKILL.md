---
name: "aws-solution-architect"
description: AWS-specific service selection, cost-ceiling discipline, and IAM least-privilege guidance for StockSync's serverless stack (Lambda, DynamoDB, SQS FIFO, API Gateway REST+WebSocket, Cognito, Bedrock, EventBridge, SNS/SES, CodeDeploy). Use when choosing between two AWS services for a new feature, when adding a new IAM permission, when estimating whether something stays inside the AWS always-free tier, when someone asks "which AWS service should this use", "will this cost money", "what permissions does this Lambda actually need", or "why not just use X service instead". Also use before any CDK change that adds a new AWS resource type not already in the architecture.
---

# AWS Solution Architect — StockSync

This project's "Built on AWS" story depends on every service choice being
defensible in one sentence — not just present. This skill exists to keep
new service choices consistent with that bar, and to keep the whole stack
inside the always-free tier the `aws-serverless-hackathon` profile assumes.

## Core guidance

### Why each current service was chosen, not just what it does

| Service | Chosen over | Because |
|---|---|---|
| DynamoDB | RDS/Postgres | Access patterns are few and known; on-demand capacity needs no tuning; Streams gives event-sourcing for free |
| SQS FIFO (grouped by record id) | Standard SQS, or no queue at all | Ordering per-resource is the actual correctness requirement — standard SQS gives no ordering guarantee at all |
| Lambda, no framework | ECS/Fargate, Express/NestJS | API Gateway already routes; no long-lived process to justify a framework or a cluster |
| API Gateway WebSocket | Client-side polling | Push is cheaper and gives instant "you're back online, here's what changed" without a polling loop |
| Cognito | Hand-rolled JWT auth | Managed token issuance/rotation for near-zero extra code, at Tier 2 when multi-user auth is added |
| Bedrock (Runtime API only) | SageMaker / a trained model | No training data exists yet; a pre-trained foundation-model call is the only model-touching feature the PRD allows |
| CDK (TypeScript) | Terraform/SAM | Same language as the rest of the monorepo; see `senior-devops`'s `infrastructure_as_code.md` for the full reasoning |
| CodeDeploy canary (Tier 2) | Manual alias-switch | Alarm-gated automatic rollback needs no human watching during the shift window |

If a new feature seems to need a service not on this list, that's exactly
the moment to write down the one-sentence justification *before* adding
it — not after, when it's already load-bearing.

### Free-tier ceiling discipline

The `aws-serverless-hackathon` profile (in `senior-fullstack`) sets a $50/mo
ceiling. At hackathon-demo scale:
- Lambda, DynamoDB (on-demand), SQS, API Gateway, EventBridge, SNS all sit
  inside their always-free monthly allowances comfortably.
- **Bedrock is pay-per-token** — the only genuinely metered service in
  active use. Keep calls narrow and infrequent (see `senior-prompt-engineer`)
  and this stays trivially cheap, but it's the one line item worth
  actually watching in the AWS console during heavy rehearsal.
- **The #1 accidental-cost trap in serverless projects generally is a NAT
  Gateway** (~$32/mo, not covered by any free tier). This project has no
  reason to need one — if a future change seems to require one (e.g. a
  Lambda needing outbound internet access from inside a VPC), stop and
  reconsider the design before adding it.
- Set a Budget alarm at $20 on day one of the AWS account, not after
  something unexpected shows up on a bill.

### IAM least privilege, concretely

Every Lambda in this project gets a role scoped to exactly what it does —
never a shared, broad policy:

```typescript
// Correct: scoped grants, one per actual need
this.writeDedupTable.grantReadWriteData(writeIntakeFn);
this.queue.grantSendMessages(writeIntakeFn);

this.recordsTable.grantReadWriteData(conflictResolverFn);
this.auditLogTable.grantWriteData(conflictResolverFn);
this.writeDedupTable.grantWriteData(conflictResolverFn);
```

```typescript
// Wrong: one blanket policy shared across every Lambda in the stack
// (this pattern should never appear in this project's CDK code)
const broadPolicy = new iam.PolicyStatement({
  actions: ["dynamodb:*"],
  resources: ["*"],
});
```

The write-intake function specifically should **never** have permission to
write to `records` or `audit_log` directly — only the conflict-resolver
does, since only it performs the atomic, resolved write.

## Watch out for

- **A new Lambda granted `dynamodb:*` "to save time while prototyping."**
  Scope it immediately, even under deadline pressure — the scoped version
  costs a few extra lines, not extra hours, and this project already has a
  documented pattern to copy from.
- **Reaching for a NAT Gateway, a VPC, or a second region "just in case."**
  None of these are needed at this project's actual scale — each one adds
  real monthly cost with no corresponding benefit for a hackathon demo.
- **Choosing a service because it's more impressive to mention in the demo,
  not because it's structurally necessary.** Judging criteria reward AWS
  that's load-bearing — an unnecessary service is a liability if asked
  "why is this here," not a strength.
- **Letting Bedrock usage grow unbounded during rehearsal.** Dozens of
  rehearsal runs each triggering multiple Bedrock calls (price-conflict +
  NL assistant + reorder suggestion) can add up faster than the always-free
  services — check actual spend, don't assume it's negligible by default.
- **A CDK change that adds a resource type not reasoned about here.** Add
  its one-sentence justification to the table above in the same PR, not as
  a follow-up.

## Hard questions to insist on before proceeding

- **"If a judge asked 'why is this AWS service here and not a simpler
  alternative,' what's the one-sentence answer?"** If there isn't a clean
  one, either the choice needs to change or the justification needs to be
  found and written down before merging — don't let it stay implicit.

## Hand off to

- **senior-devops** — once a service choice is settled here, it becomes a
  CDK construct (via `cdk_scaffolder.py`) and a deploy-pipeline concern —
  that's their execution, not this skill's.
- **senior-architect** — if a service choice affects the correctness
  guarantees (e.g. considering standard SQS instead of FIFO), that's a
  correctness question first and a cost/service question second.
