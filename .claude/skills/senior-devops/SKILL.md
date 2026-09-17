---
name: "senior-devops"
description: Comprehensive DevOps skill for CI/CD, infrastructure automation, containerization, and cloud platforms (AWS, GCP, Azure). Includes pipeline setup, infrastructure as code, deployment automation, and monitoring. Use when setting up pipelines, deploying applications, managing infrastructure, implementing monitoring, or optimizing deployment processes.
---

# Senior Devops

Complete toolkit for senior devops with modern tools and best practices.

## Quick Start

### Main Capabilities

This skill provides four core capabilities through automated scripts:

```bash
# Script 1: Pipeline Generator — scaffolds CI/CD pipelines for GitHub Actions or CircleCI
# (auto-detects a CDK project via cdk.json and generates a `cdk deploy` stage instead of
# a Docker build/push stage when it finds one)
python scripts/pipeline_generator.py ./app --platform=github --stages=build,test,deploy

# Script 2: Terraform Scaffolder — generates and validates IaC modules for cluster/VM infra (AWS/GCP/Azure)
python scripts/terraform_scaffolder.py ./infra --provider=aws --module=ecs-service --verbose

# Script 3: CDK Scaffolder — generates AWS CDK constructs for serverless infra (Lambda + DynamoDB + API Gateway)
python scripts/cdk_scaffolder.py ./infra/cdk --module=sync-engine --name=SyncEngine --verbose

# Script 4: Deployment Manager — Kubernetes manifests + runbooks (blue/green, rolling),
# or a Lambda CodeDeploy canary construct + runbook (serverless-canary)
python3 scripts/deployment_manager.py deploy --env=staging --image=app:1.2.3 --strategy=blue-green --verbose --json
python3 scripts/deployment_manager.py deploy --env=production --image=fn:5 --strategy=serverless-canary --canary-config=canary-10-5min
```

## Core Capabilities

### 1. Pipeline Generator

Scaffolds CI/CD pipeline configurations for GitHub Actions or CircleCI, with stages for build, test, security scan, and deploy.

**Example — GitHub Actions workflow:**
```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v4

  build-docker:
    needs: build-and-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build and push image
        uses: docker/build-push-action@v5
        with:
          push: ${{ github.ref == 'refs/heads/main' }}
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}

  deploy:
    needs: build-docker
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster production \
            --service app-service \
            --force-new-deployment
```

**Usage:**
```bash
python scripts/pipeline_generator.py <project-path> --platform=github|circleci --stages=build,test,deploy
```

### 2. Terraform Scaffolder

Generates, validates, and plans Terraform modules. Enforces consistent module structure and runs `terraform validate` + `terraform plan` before any apply.

**Example — AWS ECS service module:**
```hcl
# modules/ecs-service/main.tf
resource "aws_ecs_task_definition" "app" {
  family                   = var.service_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory

  container_definitions = jsonencode([{
    name      = var.service_name
    image     = var.container_image
    essential = true
    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]
    environment = [for k, v in var.env_vars : { name = k, value = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = "/ecs/${var.service_name}"
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = var.service_name
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = var.service_name
    container_port   = var.container_port
  }
}
```

**Usage:**
```bash
python scripts/terraform_scaffolder.py <target-path> --provider=aws|gcp|azure --module=ecs-service|gke-deployment|aks-service [--verbose]
```

### 3. CDK Scaffolder

Generates AWS CDK (TypeScript) construct skeletons for serverless
infrastructure — the counterpart to the Terraform scaffolder for
projects with no cluster, where the backend is Lambda functions
provisioned by CDK instead. Runs `tsc --noEmit` on the generated file
as a syntax sanity check when a TypeScript toolchain is available.

**Modules:**
- `sync-engine` — DynamoDB (with Streams) + SQS FIFO (with a DLQ) +
  write-intake and conflict-resolver Lambdas, wired for the
  concurrent/offline-writer correctness pattern: the FIFO queue's
  `MessageGroupId` is the affected *record's* id, not the sending
  client's id (grouping by sender lets two clients race on the same
  record), and the resolver is granted exactly the DynamoDB actions it
  needs on exactly the tables it needs — not a blanket policy.
- `http-api` — a plain API Gateway HTTP API + one Lambda, no backend
  framework (API Gateway is already the router; Express/NestJS would be
  solving a long-lived-process problem this architecture doesn't have).

**Example — generated `sync-engine` construct (excerpt):**
```typescript
export class SyncEngine extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.recordsTable = new dynamodb.TableV2(this, "Records", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    this.queue = new sqs.Queue(this, "WriteQueue", {
      fifo: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
    });
    // MessageGroupId is set to the record id at send time in writeIntake.ts —
    // not the client id. See infrastructure_as_code.md for why this matters.
  }
}
```

**Usage:**
```bash
python scripts/cdk_scaffolder.py <target-path> --module=sync-engine|http-api --name=<ConstructName> [--verbose]
```

### 4. Deployment Manager

Generates Kubernetes deployment manifests and ordered kubectl runbooks
for blue/green or rolling strategies, **or** a Lambda CodeDeploy canary
CDK snippet and runbook for a `serverless-canary` deploy — with
health-check gates before traffic switches (Kubernetes) or an
alarm-gated automatic rollback (Lambda), and rollback support for both.
The tool writes manifests/snippets and prints the commands — it never
applies anything to a cluster or account itself, so every change gets a
human review.

**Example — Kubernetes blue/green deployment (blue-slot specific elements):**
```yaml
# k8s/deployment-blue.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-blue
  labels:
    app: myapp
    slot: blue      # slot label distinguishes blue from green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      slot: blue
  template:
    metadata:
      labels:
        app: myapp
        slot: blue
    spec:
      containers:
        - name: app
          image: ghcr.io/org/app:1.2.3
          readinessProbe:       # gate: pod must pass before traffic switches
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
```

**Example — Lambda serverless canary (generated CDK snippet, excerpt):**
```typescript
new codedeploy.LambdaDeploymentGroup(this, "ConflictResolverDeploymentGroup", {
  alias: conflictResolverAlias,
  deploymentConfig: codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
  alarms: [conflictResolverErrorAlarm],   // breach during the shift -> automatic rollback, no human needed
});
```

**Usage:**
```bash
python scripts/deployment_manager.py deploy \
  --env=staging|production \
  --image=app:1.2.3 \
  --strategy=blue-green|rolling|serverless-canary \
  --health-check-url=https://app.example.com/healthz   # blue-green/rolling
  --canary-config=canary-10-5min|canary-10-30min|linear-10-1min|all-at-once   # serverless-canary

python scripts/deployment_manager.py rollback --env=production --to-version=1.2.2 --platform=kubernetes|lambda
python scripts/deployment_manager.py analyze --env=production --output-dir=./deploy   # audit current state, either platform
```

## Resources

- Pattern Reference: `references/cicd_pipeline_guide.md` — detailed CI/CD patterns, best practices, anti-patterns
- Workflow Guide: `references/infrastructure_as_code.md` — IaC step-by-step processes, optimization, troubleshooting
- Technical Guide: `references/deployment_strategies.md` — deployment strategy configs, security considerations, scalability
- Tool Scripts: `scripts/` directory

## Development Workflow

### 1. Infrastructure Changes (Terraform — cluster/VM workloads)

```bash
# Scaffold or update module
python scripts/terraform_scaffolder.py ./infra --provider=aws --module=ecs-service --verbose

# Validate and plan — review diff before applying
terraform -chdir=infra init
terraform -chdir=infra validate
terraform -chdir=infra plan -out=tfplan

# Apply only after plan review
terraform -chdir=infra apply tfplan

# Verify resources are healthy
aws ecs describe-services --cluster production --services app-service \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
```

### 1b. Infrastructure Changes (CDK — serverless workloads)

```bash
# Scaffold or update a construct
python scripts/cdk_scaffolder.py ./infra/cdk --module=sync-engine --name=SyncEngine --verbose

# Diff — review before applying, same discipline as terraform plan
cd infra/cdk && npx cdk diff

# Deploy only after diff review
npx cdk deploy

# Verify the stack's resources
aws cloudformation describe-stacks --stack-name <your-stack-name> \
  --query 'Stacks[0].StackStatus'
```


### 2. Application Deployment

```bash
# Generate or update pipeline config
python scripts/pipeline_generator.py . --platform=github --stages=build,test,security,deploy

# Build and tag image
docker build -t ghcr.io/org/app:$(git rev-parse --short HEAD) .
docker push ghcr.io/org/app:$(git rev-parse --short HEAD)

# Deploy with health-check gate
python scripts/deployment_manager.py deploy \
  --env=production \
  --image=app:$(git rev-parse --short HEAD) \
  --strategy=blue-green \
  --health-check-url=https://app.example.com/healthz

# Verify pods are running
kubectl get pods -n production -l app=myapp
kubectl rollout status deployment/app-blue -n production

# Switch traffic after verification
kubectl patch service app-svc -n production \
  -p '{"spec":{"selector":{"slot":"blue"}}}'
```

### 2b. Application Deployment (Serverless)

```bash
# Generate or update pipeline config — auto-detects cdk.json and generates
# a `cdk deploy` stage instead of a Docker build/push stage
python scripts/pipeline_generator.py . --platform=github --stages=build,test,security,deploy

# Ship the new Lambda version via CDK deploy (handled by CI above, or manually):
cd infra/cdk && npx cdk deploy

# Generate the canary construct + runbook (paste the construct into your stack once)
python scripts/deployment_manager.py deploy \
  --env=production \
  --image=conflict-resolver:$(git rev-parse --short HEAD) \
  --strategy=serverless-canary \
  --canary-config=canary-10-5min

# Verify the alias and alarm state — no manual traffic switch needed,
# CodeDeploy shifts traffic per the config and rolls back on alarm breach
aws lambda get-alias --function-name conflict-resolver --name live
aws cloudwatch describe-alarms --alarm-names conflict-resolverErrorAlarm \
  --query 'MetricAlarms[0].StateValue'
```

### 3. Rollback Procedure

```bash
# Kubernetes — immediate rollback via deployment manager
python scripts/deployment_manager.py rollback --env=production --to-version=1.2.2 --platform=kubernetes

# Or via kubectl directly
kubectl rollout undo deployment/app -n production
kubectl rollout status deployment/app -n production

# Verify rollback succeeded
kubectl get pods -n production -l app=myapp
curl -sf https://app.example.com/healthz || echo "ROLLBACK FAILED — escalate"

# Lambda/serverless — stop an in-flight canary shift, or pin an explicit version
python scripts/deployment_manager.py rollback --env=production --app=conflict-resolver --to-version=4 --platform=lambda
aws lambda get-alias --function-name conflict-resolver --name live
```

## Multi-Cloud Cross-References

Use these companion skills for cloud-specific deep dives:

| Skill | Cloud | Use When |
|-------|-------|----------|
| **aws-solution-architect** (`../aws-solution-architect/`) | AWS | Service selection rationale, free-tier/cost ceiling, IAM least-privilege — generated for this project, not a placeholder |
| **azure-cloud-architect** | Azure | AKS, App Service, Virtual Networks, Azure DevOps |
| **gcp-cloud-architect** | GCP | GKE, Cloud Run, VPC, Cloud Build *(not generated — this project is AWS-only)* |
| **senior-architect** (`../senior-architect/`) | N/A | Correctness questions (vector clocks, CRDT merge, atomicity) — distinct from service selection, which is `aws-solution-architect`'s job |

**Multi-cloud vs single-cloud decision:**
- **Single-cloud** (default) — lower operational complexity, deeper managed-service integration, better cost leverage with committed-use discounts
- **Multi-cloud** — required when mandated by compliance/data residency, acquiring companies on different clouds, or needing best-of-breed services across providers (e.g., AWS for compute + GCP for ML)
- **Hybrid** — on-prem + cloud; use when regulated workloads must stay on-prem while burst/non-sensitive workloads run in the cloud

> Start single-cloud. Add a second cloud only when there is a concrete business or compliance driver — not for theoretical redundancy.

---

## Cloud-Agnostic IaC

### Terraform / OpenTofu (Default Choice)

Terraform (or its open-source fork OpenTofu) is the recommended IaC tool for most teams:
- Single language (HCL) across AWS, Azure, GCP, and 3,000+ providers
- State management with remote backends (S3, GCS, Azure Blob)
- Plan-before-apply workflow prevents drift surprises
- Cross-reference **terraform-patterns** for module structure, state isolation, and CI/CD integration

### Pulumi (Programming Language IaC)

Choose Pulumi when the team strongly prefers TypeScript, Python, Go, or C# over HCL:
- Full programming language — loops, conditionals, unit tests native
- Same cloud provider coverage as Terraform
- Easier onboarding for dev teams that resist learning HCL

### AWS CDK (Serverless-Native, AWS-Only)

Choose CDK — not Terraform, not Pulumi — specifically for an AWS
serverless stack (Lambda, DynamoDB, API Gateway) built by a team already
writing TypeScript end to end, like StockSync:
- Same language as the application code — no context switch, and
  application types can be shared directly with infrastructure code
- Synthesizes to CloudFormation, so it gets CloudFormation's native AWS
  integration (StackSets, drift detection) without hand-writing YAML/JSON
- `scripts/cdk_scaffolder.py` in this skill scaffolds constructs directly
- **AWS-only** — if the team needs multi-cloud, this is the wrong tool;
  use Pulumi instead for the "real programming language" benefit across
  providers

### When to Use Cloud-Native IaC

| Tool | Use When |
|------|----------|
| **CloudFormation** | AWS-only shop; need native AWS support (StackSets, Service Catalog) |
| **Bicep** | Azure-only shop; simpler syntax than ARM templates |
| **Cloud Deployment Manager** | GCP-only; rare — most GCP teams prefer Terraform |

> **Rule of thumb:** Use Terraform/OpenTofu for multi-cloud or cluster/VM
> infrastructure. Use CDK specifically for an AWS-only serverless stack
> already written in TypeScript — don't default to Terraform there just
> out of habit. Reach for a cloud-native tool (CloudFormation/Bicep) only
> when you're 100% committed to a single cloud AND it offers a feature
> neither Terraform nor CDK can replicate.

---

## Troubleshooting

Check the comprehensive troubleshooting section in `references/deployment_strategies.md`.
