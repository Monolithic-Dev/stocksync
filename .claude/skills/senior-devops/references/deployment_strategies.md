# Deployment Strategies

## Overview

Every deployment strategy is answering the same question: **how do you
ship a new version without a bad one taking down everyone at once?** The
mechanism differs completely between a cluster-based workload and a
serverless one — this guide covers both, and `scripts/deployment_manager.py`
generates the manifests/runbooks for either.

| Strategy | Platform | Rollback trigger | Tool support |
|---|---|---|---|
| Rolling | Kubernetes | Manual (`kubectl rollout undo`) or failed readiness probe | `deployment_manager.py deploy --strategy rolling` |
| Blue-green | Kubernetes | Manual, after a human reviews the health check | `deployment_manager.py deploy --strategy blue-green` |
| Canary / linear (Lambda) | Serverless (Lambda + CodeDeploy) | **Automatic**, on a CloudWatch alarm breach during the shift window | `deployment_manager.py deploy --strategy serverless-canary` |

The serverless row is the odd one out in a good way: it's the only
strategy here where rollback doesn't require a human to notice something
is wrong first.

---

## Pattern 1: Rolling Deployment (Kubernetes)

**Description:** Replace pods with the new version incrementally,
verified by readiness probes, with no separate "old" and "new"
environment. Simplest strategy; the default for most Kubernetes
workloads.

**When to use:**
- Stateless services where a brief mixed-version window (some pods old,
  some new) is safe
- No need for instant, atomic all-or-nothing traffic cutover

**Implementation:**
```bash
python scripts/deployment_manager.py deploy \
  --env production --image app:1.2.3 --strategy rolling \
  --health-check-url https://app.example.com/healthz
```
This writes a `Deployment` + `Service` manifest and a runbook:
```
kubectl apply -f deploy/production/deployment.yaml
kubectl rollout status deployment/app -n production
curl -sf https://app.example.com/healthz || kubectl rollout undo deployment/app -n production
```

**Trade-offs:** During the rollout, both old and new versions serve
traffic simultaneously — fine for most stateless APIs, a real problem
if the new version changes a data contract the old version can't handle.

---

## Pattern 2: Blue-Green Deployment (Kubernetes)

**Description:** Deploy the new version fully alongside the old one
(a separate "slot"), verify it's healthy in isolation, then switch the
Service's selector to point traffic at it atomically. Rollback is just
switching the selector back.

**When to use:**
- Need an instant, atomic cutover (no mixed-version window)
- Want to fully verify the new version under production-like conditions
  before any real traffic reaches it

**Implementation:**
```bash
python scripts/deployment_manager.py deploy \
  --env production --image app:1.2.3 --strategy blue-green --slot green \
  --health-check-url https://app.example.com/healthz
```
Runbook:
```
kubectl apply -f deploy/production/deployment-green.yaml
kubectl rollout status deployment/app-green -n production
curl -sf https://app.example.com/healthz || echo 'HEALTH CHECK FAILED — do not switch traffic'
# only after the above passes:
kubectl patch service app-svc -n production -p '{"spec":{"selector":{"app":"app","slot":"green"}}}'
```

**Trade-offs:** Doubles resource usage during the deploy window (both
slots running). The health check and traffic switch are manual steps in
this runbook by design — the tool never applies anything to a cluster
itself, so a human reviews the check result before switching.

---

## Pattern 3: Canary / Linear Traffic Shifting (Serverless — Lambda + CodeDeploy)

**Description:** Ship a new Lambda version behind an alias, and let
AWS CodeDeploy shift traffic to it gradually (e.g. 10% for 5 minutes,
then the rest) while watching a CloudWatch alarm. If the alarm breaches
during the shift, CodeDeploy **automatically rolls back** — this is the
one strategy in this guide where rollback doesn't depend on a human
noticing first.

**When to use:** Any Lambda function fronting real traffic, once you've
moved past "deploy straight to the `live` alias with no gate" (which is
fine for a hackathon's first few days, not for anything after).

**Implementation:**
```bash
python scripts/deployment_manager.py deploy \
  --env production --image conflict-resolver:5 --strategy serverless-canary \
  --canary-config canary-10-5min
```
This writes a CDK construct snippet (`lambda-deployment-group.ts`) —
paste it into your stack next to the Lambda it targets:
```typescript
const conflictResolverAlias = new lambda.Alias(this, "ConflictResolverLiveAlias", {
  aliasName: "live",
  version: conflictResolverFn.currentVersion,
});

const conflictResolverErrorAlarm = new cloudwatch.Alarm(this, "ConflictResolverErrorAlarm", {
  metric: conflictResolverFn.metricErrors({ period: cdk.Duration.minutes(1) }),
  threshold: 1,
  evaluationPeriods: 1,
});

new codedeploy.LambdaDeploymentGroup(this, "ConflictResolverDeploymentGroup", {
  alias: conflictResolverAlias,
  deploymentConfig: codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
  alarms: [conflictResolverErrorAlarm],
});
```
Runbook — notice there's no manual health-check-then-switch step:
```
npx cdk deploy
aws lambda get-alias --function-name conflict-resolver --name live
aws cloudwatch describe-alarms --alarm-names conflict-resolverErrorAlarm --query 'MetricAlarms[0].StateValue'
```

**Deployment config options** (pass via `--canary-config`):
| Config | Shape |
|---|---|
| `canary-10-5min` | 10% of traffic for 5 minutes, then 100% |
| `canary-10-30min` | 10% of traffic for 30 minutes, then 100% |
| `linear-10-1min` | +10% of traffic every 1 minute until 100% |
| `all-at-once` | No gradual shift — use only once you fully trust the pipeline's other gates |

**Trade-offs:** Requires at least one meaningful CloudWatch alarm wired
to the deployment group — a canary config with no alarm is just a slow
`all-at-once`, since there's nothing to trigger the automatic rollback.
Define the alarm on a metric that actually reflects user-facing failure
(error rate, not just "the function ran") before relying on this.

**Rolling back manually, if needed before the shift completes:**
```bash
python scripts/deployment_manager.py rollback \
  --env production --app conflict-resolver --to-version 4 --platform lambda
```

---

## Choosing Between These

| Situation | Strategy |
|---|---|
| Kubernetes/ECS workload, stateless, tolerant of brief mixed versions | Rolling |
| Kubernetes/ECS workload, need atomic cutover + pre-traffic verification | Blue-green |
| Lambda function, want automatic rollback without a human watching | Serverless canary/linear |
| Lambda function, very early hackathon stage, deploying directly and rebuilding constantly | Neither — deploy straight to the alias with no gate, add the canary gate once the core logic has stabilized (don't over-engineer deploy safety before the thing being deployed is itself correct) |

---

## Troubleshooting

**Blue-green switch happened but the new slot is erroring:** revert the
Service selector back to the previous slot immediately — this is why
the previous slot is never torn down automatically by these tools.

**Canary alarm breached but CodeDeploy didn't roll back:** check that the
alarm's `evaluationPeriods` isn't longer than the deployment config's
shift window — an alarm that takes 10 minutes to breach can't protect a
5-minute canary window. Use a shorter evaluation period or a longer
canary config.

**Rolling deployment stuck mid-rollout:** `kubectl rollout status` will
hang if new pods never pass their readiness probe — check
`kubectl describe pod` for the actual failure before assuming it's slow
rather than broken.
