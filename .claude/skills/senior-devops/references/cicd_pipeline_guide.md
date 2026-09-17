# CI/CD Pipeline Guide

## Overview

This guide covers CI/CD pipeline design across two deployment models:
**container/cluster-based** (the default this skill's tools originally
assumed) and **serverless/CDK-based** (the model a Lambda + DynamoDB
project like StockSync actually uses). Picking the wrong one of these
for your project's actual deployment target is the single most common
mistake — a pipeline built around `docker build && kubectl apply` is
dead weight on a project with no cluster and no container registry.

**Decide this first, before anything else in this guide:** does the
target have a Kubernetes cluster / ECS service to deploy onto, or is it
Lambda functions provisioned by CDK/SAM/Terraform? `pipeline_generator.py`
now detects this automatically (via `cdk.json`) and generates the right
deploy stage — but know which one you're building for before reading a
manifest and wondering why it doesn't apply.

---

## Pattern 1: Stage Ordering and Fail-Fast

**Description:** Order pipeline stages so the cheapest, fastest checks
run first and gate the expensive ones. Lint before test, test before
build, build before deploy. A syntax error should fail in seconds, not
after a 10-minute Docker build.

**When to use:** Every pipeline, no exceptions. This is table stakes,
not an advanced technique.

**Implementation (GitHub Actions job dependency chain):**
```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps: [ ... ]
  test:
    needs: [lint]
    runs-on: ubuntu-latest
    steps: [ ... ]
  build:
    needs: [test]
    runs-on: ubuntu-latest
    steps: [ ... ]
  deploy:
    needs: [build]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps: [ ... ]
```

For a monorepo with a fast, dependency-free core package (like
`packages/core` in the StockSync architecture), run its tests as the
very first stage — no AWS credentials, no Docker, no network calls
needed, so it fails in seconds if the core logic is broken.

**Trade-offs:** Strict staging adds pipeline wall-clock time for the
happy path (each stage waits on the last). Mitigate by running
genuinely independent stages (e.g. lint and unit-test) in parallel
rather than chained, and reserve strict ordering for stages with a real
dependency (don't build an image from code that failed its tests).

---

## Pattern 2: Serverless Deploy via CDK, Gated by Environment Approval

**Description:** For a Lambda/DynamoDB/API Gateway stack, the deploy
stage is `cdk deploy`, not a Docker build + registry push + orchestrator
apply. There is no image to build unless you're specifically using
Lambda container-image packaging. The safety gate that replaces manual
health-check-then-switch is a **required reviewer on a GitHub
Environment** — no custom approval logic needed.

**Implementation:**
```yaml
deploy:
  needs: [test]
  if: github.ref == 'refs/heads/main'
  environment: production   # configure a required reviewer on this
                             # Environment in repo settings — the job
                             # will not run until approved
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - name: Deploy via CDK
      run: npx cdk deploy --require-approval never --all
      working-directory: infra/cdk
```

`--require-approval never` is correct here specifically because the
GitHub Environment's own reviewer gate already provides the human
approval step — you don't want CDK *also* pausing for interactive
confirmation inside a non-interactive CI runner.

**When to use:** Any Lambda/CDK-deployed project — this is what
`pipeline_generator.py --platform github` now generates automatically
when it detects a `cdk.json` in the target project.

**Trade-offs:** `cdk deploy --all` deploys every stack in the app,
which is usually fine for a small serverless project with one or two
stacks, but can be too coarse once a project grows to several
independently-releasable stacks — at that point, deploy specific stack
names instead of `--all`.

---

## Pattern 3: Container/Cluster Deploy (ECS/Kubernetes)

**Description:** Build a container image, push it to a registry, then
either update an ECS service or apply Kubernetes manifests. This is
what `pipeline_generator.py` generates when it does *not* detect a CDK
project — see `deployment_strategies.md` for the actual rollout
strategy (blue-green/rolling) that consumes the resulting image.

**Implementation:**
```yaml
deploy:
  needs: [build]
  if: github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  steps:
    - name: Build and push image
      uses: docker/build-push-action@v5
      with:
        push: true
        tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
    - name: Deploy
      run: |
        # e.g. aws ecs update-service --force-new-deployment
        # or: python scripts/deployment_manager.py deploy --strategy blue-green ...
```

**When to use:** A workload that genuinely needs a long-lived process,
persistent connections, or specialized runtime dependencies that don't
fit Lambda's execution model — not by default just because it's the
more familiar pattern.

---

## Pattern 4: Security Scanning as a Gate, Not a Report

**Description:** A vulnerability scan that only produces a report nobody
reads is theater. Make it a real gate: fail the pipeline on
critical/high findings, and require an explicit, reviewed exception to
merge past it.

**Implementation:**
```yaml
security:
  needs: [test]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Run Trivy filesystem scan
      uses: aquasecurity/trivy-action@master
      with:
        scan-type: 'fs'
        scan-ref: '.'
        severity: 'CRITICAL,HIGH'
        exit-code: '1'   # this is what makes it a gate, not a report
```

**When to use:** Before any deploy stage, on every PR into main — not
just periodically. Waiting until "release day" to scan means the fix
competes with ship pressure.

---

## Anti-Patterns to Avoid

### Building a container pipeline for a serverless project
If the target has no Dockerfile and no cluster, a Docker build/push
stage is pure overhead and a maintenance trap — it'll quietly rot until
someone tries to use it and discovers it never worked. Check for
`cdk.json` (or your IaC tool's equivalent marker) before choosing a
deploy pattern, don't default to containers out of habit.

### Deploying straight to production with no environment gate
Whether it's Kubernetes or CDK, "push to main auto-deploys to prod with
no review" is fine for a solo hackathon build under real time pressure,
but is the first thing to add back the moment more than one person can
merge to main. A GitHub Environment's required-reviewer setting costs
nothing to configure and prevents an entire class of "someone merged a
bad change Friday at 5pm" incidents.

### Skipping the fast, dependency-free tests
If a project has a pure-logic package (no AWS/database dependency) —
like `packages/core`'s conflict-resolution logic — and its tests aren't
the very first pipeline stage, you're paying for a slow build/deploy
cycle before finding out the core algorithm regressed. Put it first.

---

## Tools and Resources

### Recommended Tools
- GitHub Actions / CircleCI — CI/CD platforms; `scripts/pipeline_generator.py` scaffolds either
- AWS CDK — IaC for serverless deploys; `scripts/cdk_scaffolder.py` scaffolds constructs
- Trivy — filesystem/container vulnerability scanning
- AWS CodeDeploy — traffic-shifting for Lambda canary/linear deploys (see `deployment_strategies.md`)

### Further Reading
- GitHub Docs — Environments and required reviewers
- AWS CDK Developer Guide — Pipelines
- `references/deployment_strategies.md` — what happens after the pipeline hands off a build
