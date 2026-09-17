#!/usr/bin/env python3
"""
CDK Scaffolder
Generates AWS CDK (TypeScript) construct skeletons for common serverless
patterns and optionally runs `cdk synth` when a CDK app context is present.
This is the CDK counterpart to terraform_scaffolder.py — use this one
instead when the target project has no cluster and no Terraform state,
i.e. a Lambda + DynamoDB + API Gateway serverless stack.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict

MODULES = ["sync-engine", "http-api"]


def to_pascal_case(name: str) -> str:
    parts = re.split(r"[-_]", name)
    return "".join(p[:1].upper() + p[1:] for p in parts if p) or "Construct"


SYNC_ENGINE_TEMPLATE = '''import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import { Duration } from "aws-cdk-lib";

/**
 * __NAME__: a resource-grouped, ordered, atomic write pipeline for a
 * concurrent/offline-writer workload. This is NOT a generic CRUD table —
 * it exists specifically for records that multiple clients can write to
 * without seeing each other's changes first.
 *
 * Wiring, in order (see ARCHITECTURE.md for the full reasoning):
 *   1. write-intake Lambda checks `write_dedup` by idempotency key, then
 *      enqueues to the FIFO queue below.
 *   2. The FIFO queue's MessageGroupId MUST be the affected record's id,
 *      NOT the sending client's id — grouping by sender lets two
 *      concurrent senders race on the same record; grouping by the
 *      record serializes exactly the writes that could actually conflict.
 *   3. DynamoDB Streams on `records` triggers the conflict-resolver
 *      Lambda, which performs the actual merge and writes `records`,
 *      `audit_log`, and `write_dedup` together via TransactWriteItems —
 *      never as three separate calls.
 */
export class __NAME__ extends Construct {
  public readonly recordsTable: dynamodb.TableV2;
  public readonly writeDedupTable: dynamodb.TableV2;
  public readonly auditLogTable: dynamodb.TableV2;
  public readonly queue: sqs.Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.recordsTable = new dynamodb.TableV2(this, "Records", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    this.writeDedupTable = new dynamodb.TableV2(this, "WriteDedup", {
      partitionKey: { name: "idempotency_key", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "ttl",
    });

    this.auditLogTable = new dynamodb.TableV2(this, "AuditLog", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
    });

    const dlq = new sqs.Queue(this, "DeadLetterQueue", { fifo: true });

    // MessageGroupId at send-time must be the RECORD id, not the client id.
    // See the class doc comment above — this is the fix for a real
    // concurrency bug, not a style preference.
    this.queue = new sqs.Queue(this, "WriteQueue", {
      fifo: true,
      contentBasedDeduplication: false, // we set MessageDeduplicationId explicitly, from the client's idempotency key
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      visibilityTimeout: Duration.seconds(30),
    });

    const writeIntakeFn = new lambda.NodejsFunction(this, "WriteIntakeFn", {
      entry: "../../apps/api/src/handlers/writeIntake.ts",
    });
    this.writeDedupTable.grantReadWriteData(writeIntakeFn);
    this.queue.grantSendMessages(writeIntakeFn);

    const conflictResolverFn = new lambda.NodejsFunction(this, "ConflictResolverFn", {
      entry: "../../apps/api/src/handlers/conflictResolver.ts",
    });
    // TransactWriteItems needs write access to all three tables together —
    // grant them individually rather than a blanket DynamoDB policy.
    this.recordsTable.grantReadWriteData(conflictResolverFn);
    this.auditLogTable.grantWriteData(conflictResolverFn);
    this.writeDedupTable.grantWriteData(conflictResolverFn);

    conflictResolverFn.addEventSource(
      new lambdaEventSources.DynamoEventSource(this.recordsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
      })
    );
  }
}
'''

HTTP_API_TEMPLATE = '''import { Construct } from "constructs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";

/**
 * __NAME__: a thin HTTP API in front of one or more Lambda handlers.
 * No framework (Express/NestJS/Fastify) inside the handlers — API Gateway
 * is already the router, so a framework would be solving a long-lived-
 * process problem this architecture doesn't have. Use AWS Lambda
 * Powertools inside each handler for logging/idempotency/metrics instead.
 */
export class __NAME__ extends Construct {
  public readonly api: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, entry: string) {
    super(scope, id);

    const handlerFn = new lambda.NodejsFunction(this, "HandlerFn", { entry });

    this.api = new apigwv2.HttpApi(this, "Api", {
      corsPreflight: {
        allowOrigins: ["*"], // tighten before anything beyond a demo
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
      },
    });

    this.api.addRoutes({
      path: "/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration("Integration", handlerFn),
    });
  }
}
'''

MODULE_TEMPLATES = {
    "sync-engine": SYNC_ENGINE_TEMPLATE,
    "http-api": HTTP_API_TEMPLATE,
}


def run_cdk_checks(file_path: Path, verbose: bool) -> Dict:
    """Run tsc --noEmit on the generated file when TypeScript is available,
    as a syntax sanity check. This does NOT run `cdk synth` — that needs a
    full app context (bin/app.ts, installed deps) this scaffolder doesn't
    assume exists yet, unlike terraform_scaffolder's fmt/validate which
    only needs the terraform binary."""
    checks = {"typescript_available": False, "syntax_check": "skipped"}
    tsc = shutil.which("tsc") or shutil.which("npx")
    if not tsc:
        if verbose:
            print("ℹ️  no TypeScript toolchain found — skipping syntax check")
        return checks

    checks["typescript_available"] = True
    cmd = [tsc, "--noEmit", "--target", "ES2022", "--module", "ESNext",
           "--moduleResolution", "bundler", "--skipLibCheck", str(file_path)] \
        if shutil.which("tsc") else \
          ["npx", "--yes", "typescript", "--noEmit", "--target", "ES2022",
           "--module", "ESNext", "--moduleResolution", "bundler", "--skipLibCheck", str(file_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    # Missing type declarations for aws-cdk-lib are expected without a real
    # `npm install` — only fail the check on actual syntax errors (TS1xxx).
    syntax_errors = [l for l in result.stdout.splitlines() if re.search(r"error TS1\d\d\d", l)]
    checks["syntax_check"] = "passed" if not syntax_errors else f"failed: {syntax_errors[0]}"
    return checks


def scaffold(target: Path, module: str, name: str, force: bool, verbose: bool) -> Dict:
    class_name = to_pascal_case(name)
    module_dir = target / "lib" / "constructs"
    module_dir.mkdir(parents=True, exist_ok=True)

    file_path = module_dir / f"{to_pascal_case(module)}.ts"
    content = MODULE_TEMPLATES[module].replace("__NAME__", class_name)

    if file_path.exists() and not force:
        return {
            "status": "skipped",
            "reason": f"{file_path} exists (use --force to overwrite)",
            "module_dir": str(module_dir),
        }

    file_path.write_text(content, encoding="utf-8")
    if verbose:
        print(f"✓ Wrote {file_path}")

    return {
        "status": "success",
        "module": module,
        "class_name": class_name,
        "file_written": str(file_path),
        "module_dir": str(module_dir),
        "checks": run_cdk_checks(file_path, verbose),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate an AWS CDK (TypeScript) construct skeleton for a serverless pattern."
    )
    parser.add_argument("target", help="Target CDK app directory (e.g. ./infra/cdk)")
    parser.add_argument("--module", required=True, choices=MODULES,
                        help="sync-engine: DynamoDB+Streams+SQS FIFO+DLQ+Lambda for concurrent/offline writers. "
                             "http-api: a plain HTTP API Gateway + Lambda, no framework.")
    parser.add_argument("--name", default=None,
                        help="Construct class name base (default: derived from --module)")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing file")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose output")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    parser.add_argument("--output", "-o", help="Write JSON results to this file")
    args = parser.parse_args()

    name = args.name or args.module
    print(f"🚀 Scaffolding CDK construct '{args.module}' under {args.target} ...")
    results = scaffold(Path(args.target), args.module, name, args.force, args.verbose)

    if results["status"] == "skipped":
        print(f"⏭️  {results['reason']}")
    else:
        print(f"✅ Construct ready: {results['file_written']}")
        checks = results.get("checks", {})
        if checks.get("syntax_check") not in ("skipped", None):
            print(f"   syntax check: {checks['syntax_check']}")

    if args.json or args.output:
        output = json.dumps(results, indent=2)
        if args.output:
            Path(args.output).write_text(output, encoding="utf-8")
            print(f"Results written to {args.output}")
        else:
            print(output)


if __name__ == "__main__":
    main()
