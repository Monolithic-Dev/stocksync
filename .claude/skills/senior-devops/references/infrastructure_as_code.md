# Infrastructure As Code

## Overview

This skill ships two scaffolders because two genuinely different IaC
tools apply depending on what's being deployed: **Terraform**
(`terraform_scaffolder.py`) for cluster/VM-based infrastructure across
AWS/GCP/Azure, and **CDK** (`cdk_scaffolder.py`) for a TypeScript-native
serverless stack like StockSync's Lambda + DynamoDB + API Gateway.
They are not interchangeable, and picking the wrong one wastes real
time: scaffolding a Terraform ECS module for a project with no cluster
produces infrastructure nobody needs.

**Decide with this question:** is there a cluster or a set of long-lived
compute instances to provision (ECS, GKE, AKS), or is the entire backend
a set of functions that scale to zero (Lambda)? The former is
`terraform_scaffolder.py`'s job. The latter is `cdk_scaffolder.py`'s.

---

## Pattern 1: Terraform Module Structure (Cluster/VM Infrastructure)

**Description:** One module per logical unit of infrastructure
(`ecs-service`, `gke-deployment`, `aks-service`), each with the
standard `main.tf` / `variables.tf` / `outputs.tf` / `versions.tf`
file split, so modules are independently reviewable and reusable.

**When to use:** AWS ECS/Fargate, GCP GKE, or Azure AKS workloads —
anything with a cluster or a set of provisioned compute instances
underneath it.

**Implementation:**
```bash
python scripts/terraform_scaffolder.py ./infra --provider aws --module ecs-service --verbose
```
This scaffolds `modules/ecs-service/{main,variables,outputs,versions}.tf`
and runs `terraform fmt`/`validate` automatically if the `terraform`
binary is present — catching syntax errors before a human ever opens
the files.

**Trade-offs:** Terraform's plan-then-apply workflow and mature state
management are its real strengths, but HCL is a second language to
maintain alongside an otherwise-TypeScript or otherwise-Python
codebase, and there's no way to unit-test HCL logic the way you can
test a CDK construct with Jest/Vitest.

---

## Pattern 2: CDK Constructs (Serverless Infrastructure)

**Description:** Infrastructure defined as real TypeScript classes
(`Construct` subclasses), type-checked at compile time, composable and
testable the same way application code is. For a project already
written in TypeScript end to end, this removes the language-context-
switch Terraform requires.

**When to use:** Lambda + DynamoDB + API Gateway serverless stacks —
this is what `cdk_scaffolder.py` generates, and it's the model
StockSync is actually built on.

**Implementation:**
```bash
# The sync-engine module: DynamoDB (with Streams) + SQS FIFO (with a DLQ)
# + write-intake and conflict-resolver Lambdas, wired together correctly —
# this is not a generic CRUD table, it's specifically for the
# concurrent/offline-writer correctness pattern (see architecture_patterns.md
# in the senior-fullstack skill for the full reasoning).
python scripts/cdk_scaffolder.py ./infra/cdk --module sync-engine --name SyncEngine --verbose

# The http-api module: a plain API Gateway HTTP API + one Lambda, no framework
python scripts/cdk_scaffolder.py ./infra/cdk --module http-api --name PublicApi --verbose
```

Unlike `terraform_scaffolder.py`'s `terraform fmt`/`validate` (which
only needs the `terraform` binary), `cdk_scaffolder.py`'s syntax check
runs `tsc --noEmit` on the generated file directly — it deliberately
does **not** attempt a full `cdk synth`, since that needs a complete app
context (`bin/app.ts`, installed `node_modules`) that may not exist yet
when you're scaffolding the very first construct.

**A structural rule worth calling out explicitly:** the `sync-engine`
module wires its SQS FIFO queue's `MessageGroupId` to the affected
*record's* id, not the sending client's id. This isn't a style choice —
grouping by the sender lets two different clients race on the same
record; grouping by the record serializes exactly the writes that could
actually conflict. Getting this backwards is a real, easy-to-miss
concurrency bug, not a cosmetic difference.

**Trade-offs:** CDK's abstraction is powerful but can obscure exactly
what CloudFormation it's about to generate — always run `cdk diff`
before `cdk deploy` on anything beyond a first-time provision, the same
discipline Terraform's `plan` step enforces by default.

---

## Pattern 3: State Management

**Terraform:** remote state (S3 + DynamoDB lock table, or Terraform
Cloud) is non-negotiable beyond a single-person, single-machine
project — local state files are a guaranteed source of drift and
conflicting-apply incidents the moment a second person touches the
infrastructure.

**CDK:** state is CloudFormation's own stack state, managed by AWS
directly — there's no separate state file to lose or corrupt, but that
also means `cdk destroy` and stack renames carry real weight; treat
stack names as close to permanent once real resources depend on them.

---

## Pattern 4: Least-Privilege IAM, in Either Tool

**Description:** Grant each compute unit (ECS task role, Lambda
execution role) only the specific actions on the specific resources it
needs — never a blanket `dynamodb:*` or `s3:*`.

**CDK example (from the sync-engine module):**
```typescript
// Each Lambda gets exactly what it needs, not a shared blanket policy —
// the write-intake function should never be able to touch the records
// table directly, only write_dedup and the queue.
this.writeDedupTable.grantReadWriteData(writeIntakeFn);
this.queue.grantSendMessages(writeIntakeFn);

this.recordsTable.grantReadWriteData(conflictResolverFn);
this.auditLogTable.grantWriteData(conflictResolverFn);
this.writeDedupTable.grantWriteData(conflictResolverFn);
```

**Terraform equivalent:** a dedicated `aws_iam_policy` per role, scoped
to specific resource ARNs, attached via `aws_iam_role_policy_attachment`
— resist the temptation to reuse one broad policy across multiple
services "to save time," since that's exactly the shortcut that turns
one compromised function into access to everything.

---

## Anti-Patterns to Avoid

### Scaffolding Terraform for a project with no cluster
If there's no ECS service, no GKE/AKS cluster, and the backend is
Lambda functions, `terraform_scaffolder.py`'s modules don't apply —
reach for `cdk_scaffolder.py` instead. Running the wrong scaffolder
"just to have infrastructure code" produces infrastructure nobody
deploys.

### A blanket IAM policy "to move faster"
This is the single most common serverless security mistake — a Lambda
with `dynamodb:*` on `*` because it was faster to write than five
scoped grants. The scoped version (Pattern 4 above) costs a few extra
lines, not a few extra hours.

### No `cdk diff` / `terraform plan` before apply
Both tools support previewing a change before making it. Skipping the
preview step on anything beyond an empty first deploy is how a typo in
a resource property becomes an unplanned resource replacement (and, for
a stateful resource like a DynamoDB table, potential data loss).

---

## Tools and Resources

### Recommended Tools
- `scripts/terraform_scaffolder.py` — cluster/VM infrastructure (AWS ECS, GCP GKE, Azure AKS)
- `scripts/cdk_scaffolder.py` — serverless infrastructure (Lambda + DynamoDB + API Gateway)
- `terraform fmt` / `terraform validate` — run automatically by the Terraform scaffolder when available
- `tsc --noEmit` — run automatically by the CDK scaffolder as a syntax sanity check

### Further Reading
- HashiCorp, Terraform documentation — module composition and remote state
- AWS CDK Developer Guide — Constructs, Stacks, and testing with the `assertions` module
- AWS Well-Architected Framework, Security Pillar — least-privilege IAM
