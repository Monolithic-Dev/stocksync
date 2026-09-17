#!/usr/bin/env python3
"""
Deployment Manager
Generates blue/green or rolling Kubernetes deployment manifests plus an ordered
runbook of kubectl commands, and audits existing manifests. It never talks to a
cluster itself — review the manifests and run the printed commands yourself.

Subcommands:
  deploy    --env --image [--strategy] [--health-check-url] — write manifests + runbook
  rollback  --env --to-version                              — write a rollback runbook
  analyze   --env                                           — audit manifests on disk
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Dict, List

DEPLOYMENT_TEMPLATE = """apiVersion: apps/v1
kind: Deployment
metadata:
  name: {name}
  namespace: {env}
  labels:
    app: {app}{slot_label}
spec:
  replicas: {replicas}
  selector:
    matchLabels:
      app: {app}{slot_label_indented}
  template:
    metadata:
      labels:
        app: {app}{slot_label_indented2}
    spec:
      containers:
        - name: app
          image: {image}
          readinessProbe:
            httpGet:
              path: {health_path}
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
"""

SERVICE_TEMPLATE = """apiVersion: v1
kind: Service
metadata:
  name: {app}-svc
  namespace: {env}
spec:
  selector:
    app: {app}{slot_selector}
  ports:
    - port: 80
      targetPort: 8080
"""


def app_name_from_image(image: str) -> str:
    """ghcr.io/org/my-app:1.2.3 -> my-app"""
    repo = image.rsplit(":", 1)[0]
    return repo.rsplit("/", 1)[-1] or "app"


def render_deployment(app: str, env: str, image: str, replicas: int,
                      health_path: str, slot: str = "") -> str:
    return DEPLOYMENT_TEMPLATE.format(
        name=f"{app}-{slot}" if slot else app,
        env=env,
        app=app,
        image=image,
        replicas=replicas,
        health_path=health_path,
        slot_label=f"\n    slot: {slot}" if slot else "",
        slot_label_indented=f"\n      slot: {slot}" if slot else "",
        slot_label_indented2=f"\n        slot: {slot}" if slot else "",
    )


SERVERLESS_CANARY_TEMPLATE = '''import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";

// Paste into your existing stack, next to the `{var}Fn` Lambda definition.
// Unlike the kubectl blue-green runbook, there is no manual "run curl, then
// switch traffic" step here — CodeDeploy shifts traffic on the schedule
// below and rolls back automatically if `{var}ErrorAlarm` breaches during
// the shift window. Review the deployment in the CodeDeploy console or via
// the CLI commands in the runbook; you still never apply this by hand.

const {var}Alias = new lambda.Alias(this, "{AppCap}LiveAlias", {{
  aliasName: "live",
  version: {var}Fn.currentVersion,
}});

const {var}ErrorAlarm = new cloudwatch.Alarm(this, "{AppCap}ErrorAlarm", {{
  metric: {var}Fn.metricErrors({{ period: cdk.Duration.minutes(1) }}),
  threshold: 1,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
}});

new codedeploy.LambdaDeploymentGroup(this, "{AppCap}DeploymentGroup", {{
  alias: {var}Alias,
  deploymentConfig: {deployment_config},
  alarms: [{var}ErrorAlarm],
}});
'''

CANARY_CONFIGS = {
    "canary-10-5min": "codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES",
    "canary-10-30min": "codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_30MINUTES",
    "linear-10-1min": "codedeploy.LambdaDeploymentConfig.LINEAR_10PERCENT_EVERY_1MINUTE",
    "all-at-once": "codedeploy.LambdaDeploymentConfig.ALL_AT_ONCE",
}


def to_camel_case(name: str) -> str:
    """conflict-resolver -> conflictResolver — app names are commonly
    kebab-case, but that's not a valid TypeScript identifier."""
    parts = re.split(r"[-_]", name)
    if not parts:
        return name
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:] if p)


def render_serverless_canary(app: str, canary_config: str) -> str:
    var = to_camel_case(app) or "app"
    return SERVERLESS_CANARY_TEMPLATE.format(
        app=app,
        var=var,
        AppCap=var[:1].upper() + var[1:],
        deployment_config=CANARY_CONFIGS[canary_config],
    )


def cmd_deploy(args) -> Dict:
    app = args.app or app_name_from_image(args.image)
    health_path = "/healthz"
    if args.health_check_url:
        match = re.search(r"https?://[^/]+(/.*)", args.health_check_url)
        if match:
            health_path = match.group(1)

    out_dir = Path(args.output_dir) / args.env
    out_dir.mkdir(parents=True, exist_ok=True)

    written: List[str] = []
    runbook: List[str] = []

    if args.strategy == "blue-green":
        slot = args.slot
        manifest = out_dir / f"deployment-{slot}.yaml"
        manifest.write_text(
            render_deployment(app, args.env, args.image, args.replicas, health_path, slot),
            encoding="utf-8",
        )
        written.append(str(manifest))

        service = out_dir / "service.yaml"
        if not service.exists():
            # service starts pointing at the OTHER slot; traffic switches in the runbook
            other = "green" if slot == "blue" else "blue"
            service.write_text(SERVICE_TEMPLATE.format(
                app=app, env=args.env, slot_selector=f"\n    slot: {other}"), encoding="utf-8")
            written.append(str(service))

        runbook = [
            f"kubectl apply -f {manifest}",
            f"kubectl rollout status deployment/{app}-{slot} -n {args.env}",
        ]
        if args.health_check_url:
            runbook.append(f"curl -sf {args.health_check_url} || echo 'HEALTH CHECK FAILED — do not switch traffic'")
        runbook += [
            f"# switch traffic to the {slot} slot only after the checks above pass:",
            f"kubectl patch service {app}-svc -n {args.env} "
            f"-p '{{\"spec\":{{\"selector\":{{\"app\":\"{app}\",\"slot\":\"{slot}\"}}}}}}'",
        ]
    elif args.strategy == "serverless-canary":
        snippet = out_dir / "lambda-deployment-group.ts"
        snippet.write_text(render_serverless_canary(app, args.canary_config), encoding="utf-8")
        written.append(str(snippet))

        runbook = [
            f"# Paste {snippet} into your CDK stack next to the '{app}' Lambda, then:",
            "npx cdk deploy",
            f"aws lambda get-alias --function-name {app} --name live",
            f"aws cloudwatch describe-alarms --alarm-names {app}ErrorAlarm --query 'MetricAlarms[0].StateValue'",
            "# CodeDeploy shifts traffic per the deployment config and rolls back",
            "# automatically on an alarm breach — there is no manual health-check-",
            "# then-switch step here, unlike the blue-green kubectl runbook above.",
            "# To watch it live instead of polling:",
            f"aws deploy list-deployments --application-name {app} --deployment-group-name {app}-deployment-group",
        ]
    else:  # rolling
        manifest = out_dir / "deployment.yaml"
        manifest.write_text(
            render_deployment(app, args.env, args.image, args.replicas, health_path),
            encoding="utf-8",
        )
        written.append(str(manifest))

        service = out_dir / "service.yaml"
        if not service.exists():
            service.write_text(SERVICE_TEMPLATE.format(
                app=app, env=args.env, slot_selector=""), encoding="utf-8")
            written.append(str(service))

        runbook = [
            f"kubectl apply -f {manifest}",
            f"kubectl rollout status deployment/{app} -n {args.env}",
        ]
        if args.health_check_url:
            runbook.append(f"curl -sf {args.health_check_url} || kubectl rollout undo deployment/{app} -n {args.env}")

    return {
        "status": "success",
        "action": "deploy",
        "env": args.env,
        "app": app,
        "image": args.image,
        "strategy": args.strategy,
        "manifests_written": written,
        "runbook": runbook,
    }


def cmd_rollback(args) -> Dict:
    app = args.app
    if args.platform == "lambda":
        runbook = [
            "# Option 1 — CodeDeploy is still mid-shift: stop it, which auto-reverts",
            "#            the alias to the last-known-good version:",
            f"aws deploy stop-deployment --deployment-id $(aws deploy list-deployments "
            f"--application-name {app} --deployment-group-name {app}-deployment-group "
            f"--query 'deployments[0]' --output text) --auto-rollback-enabled",
            "# Option 2 — the shift already completed: point the alias at the",
            "#            previous version explicitly:",
            f"aws lambda update-alias --function-name {app} --name live --function-version {args.to_version}",
            "# Verify:",
            f"aws lambda get-alias --function-name {app} --name live",
        ]
    else:
        runbook = [
            f"# Option 1 — pin the previous image version explicitly:",
            f"kubectl set image deployment/{app} app={app}:{args.to_version} -n {args.env}",
            f"kubectl rollout status deployment/{app} -n {args.env}",
            f"# Option 2 — revert to the previous ReplicaSet:",
            f"kubectl rollout undo deployment/{app} -n {args.env}",
            f"# Verify:",
            f"kubectl get pods -n {args.env} -l app={app}",
        ]
    return {
        "status": "success",
        "action": "rollback",
        "env": args.env,
        "app": app,
        "platform": args.platform,
        "to_version": args.to_version,
        "runbook": runbook,
    }


def cmd_analyze(args) -> Dict:
    env_dir = Path(args.output_dir) / args.env
    deployments = []
    if env_dir.is_dir():
        for manifest in sorted(env_dir.glob("deployment*.yaml")):
            text = manifest.read_text(encoding="utf-8")
            image = re.search(r"image:\s*(\S+)", text)
            replicas = re.search(r"replicas:\s*(\d+)", text)
            slot = re.search(r"slot:\s*(\S+)", text)
            deployments.append({
                "manifest": str(manifest),
                "image": image.group(1) if image else "unknown",
                "replicas": int(replicas.group(1)) if replicas else 0,
                "slot": slot.group(1) if slot else None,
            })
        canary = env_dir / "lambda-deployment-group.ts"
        if canary.exists():
            text = canary.read_text(encoding="utf-8")
            config = re.search(r"deploymentConfig:\s*(\S+),", text)
            deployments.append({
                "manifest": str(canary),
                "image": "n/a (Lambda version, not a container image)",
                "replicas": 0,
                "slot": f"serverless-canary ({config.group(1) if config else 'unknown config'})",
            })
    return {
        "status": "success" if deployments else "empty",
        "action": "analyze",
        "env": args.env,
        "manifest_dir": str(env_dir),
        "deployments": deployments,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate deployment manifests and runbooks (blue/green or rolling)."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    deploy = sub.add_parser("deploy", help="Generate deployment manifests + runbook")
    deploy.add_argument("--env", required=True, help="Target environment / namespace")
    deploy.add_argument("--image", required=True, help="Container image (repo:tag)")
    deploy.add_argument("--strategy", default="rolling", choices=["blue-green", "rolling", "serverless-canary"])
    deploy.add_argument("--canary-config", default="canary-10-5min",
                        choices=list(CANARY_CONFIGS), help="Traffic-shift schedule (serverless-canary only)")
    deploy.add_argument("--health-check-url", help="Health check URL gating traffic switch")
    deploy.add_argument("--app", help="App name (default: derived from image)")
    deploy.add_argument("--slot", default="blue", choices=["blue", "green"],
                        help="Slot to deploy into (blue-green only)")
    deploy.add_argument("--replicas", type=int, default=3)
    deploy.add_argument("--output-dir", default="./deploy", help="Manifest output directory")

    rollback = sub.add_parser("rollback", help="Generate a rollback runbook")
    rollback.add_argument("--env", required=True)
    rollback.add_argument("--to-version", required=True, help="Version to roll back to")
    rollback.add_argument("--app", default="app", help="App / deployment name")
    rollback.add_argument("--platform", default="kubernetes", choices=["kubernetes", "lambda"],
                          help="Rollback command style — kubectl or Lambda/CodeDeploy")

    analyze = sub.add_parser("analyze", help="Audit deployment manifests on disk")
    analyze.add_argument("--env", required=True)
    analyze.add_argument("--output-dir", default="./deploy", help="Manifest directory")

    for p in (deploy, rollback, analyze):
        p.add_argument("--verbose", "-v", action="store_true", help="Enable verbose output")
        p.add_argument("--json", action="store_true", help="Output results as JSON")
        p.add_argument("--output", "-o", help="Write JSON results to this file")
    return parser


def main():
    # support the documented `--analyze --env=...` flag form as an alias
    argv = ["analyze" if a == "--analyze" else a for a in sys.argv[1:]]
    args = build_parser().parse_args(argv)

    handlers = {"deploy": cmd_deploy, "rollback": cmd_rollback, "analyze": cmd_analyze}
    results = handlers[args.command](args)

    print(f"🚀 {results['action']} ({results['env']}) — status: {results['status']}")
    for manifest in results.get("manifests_written", []):
        print(f"✓ Wrote {manifest}")
    for dep in results.get("deployments", []):
        slot = f" slot={dep['slot']}" if dep["slot"] else ""
        print(f"  - {dep['manifest']}: image={dep['image']} replicas={dep['replicas']}{slot}")
    if results.get("runbook"):
        print("\nRunbook — review, then execute in order:")
        for step in results["runbook"]:
            print(f"  {step}")

    if args.json or args.output:
        output = json.dumps(results, indent=2)
        if args.output:
            Path(args.output).write_text(output, encoding="utf-8")
            print(f"Results written to {args.output}")
        else:
            print(output)


if __name__ == "__main__":
    main()
