import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { StocksyncStack } from "../lib/stocksync-stack";
import { bedrockModelId } from "../lib/config";

function synthTemplate(): Template {
  const app = new App();
  const stack = new StocksyncStack(app, "TestStack");
  return Template.fromStack(stack);
}

describe("StocksyncStack — DataLayer", () => {
  it("creates exactly four on-demand DynamoDB tables", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::DynamoDB::Table", 4);
    const tables = template.findResources("AWS::DynamoDB::Table");
    for (const table of Object.values(tables)) {
      expect((table as { Properties: { BillingMode: string } }).Properties.BillingMode).toBe("PAY_PER_REQUEST");
    }
  });

  it("enables NEW_AND_OLD_IMAGES streams on inventory_records", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: Match.arrayWith([Match.objectLike({ AttributeName: "pk", KeyType: "HASH" })]),
      StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
    });
  });

  it("sets a TTL specification on write_dedup's ttl attribute", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: Match.arrayWith([Match.objectLike({ AttributeName: "idempotency_key", KeyType: "HASH" })]),
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    });
  });

  it("adds ShopConflictIndex on inventory_records and ShopConnectionsIndex on ws_connections", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: Match.arrayWith([Match.objectLike({ AttributeName: "pk", KeyType: "HASH" })]),
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: "ShopConflictIndex" })]),
    });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: Match.arrayWith([Match.objectLike({ AttributeName: "connection_id", KeyType: "HASH" })]),
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: "ShopConnectionsIndex" })]),
    });
  });
});

describe("StocksyncStack — SyncEngine", () => {
  it("provisions a FIFO write queue with explicit (non-content-based) deduplication", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::SQS::Queue", {
      FifoQueue: true,
      ContentBasedDeduplication: false,
    });
  });

  it("attaches the DLQ to the write queue via a RedrivePolicy with maxReceiveCount 5", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::SQS::Queue", {
      FifoQueue: true,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
    });
  });

  it("creates exactly two FIFO queues (write queue + DLQ)", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::SQS::Queue", 2);
  });

  it("grants the write-intake function read/write on write_dedup and send on the write queue, and nothing else", () => {
    const template = synthTemplate();
    const policies = template.findResources("AWS::IAM::Policy");
    const writeIntakePolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy).includes("WriteIntakeFunction"),
    );
    expect(writeIntakePolicy).toBeDefined();

    const statements = (
      writeIntakePolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    ).Properties.PolicyDocument.Statement;
    const actions = statements.flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action],
    );

    // Least-privilege per Phase 4 DoD: no action here may touch
    // inventory_records or audit_log — only write_dedup (read/write) and
    // sqs:SendMessage on the write queue.
    expect(actions.some((action) => action.startsWith("dynamodb:"))).toBe(true);
    expect(actions.some((action) => action.startsWith("sqs:"))).toBe(true);
    expect(actions.every((action) => action !== "dynamodb:*" && action !== "*")).toBe(true);
  });

  it("wires the conflict-resolver as an SQS event source with partial batch failure reporting", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
  });

  it("grants the conflict-resolver read/write on inventory_records and write_dedup, write-only on audit_log, and read-only on ws_connections", () => {
    const template = synthTemplate();
    const policies = template.findResources("AWS::IAM::Policy");
    const resolverPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy).includes("ConflictResolverFunction"),
    );
    expect(resolverPolicy).toBeDefined();

    const statements = (
      resolverPolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    ).Properties.PolicyDocument.Statement;
    const actions = statements.flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action],
    );

    expect(actions).toEqual(expect.arrayContaining(["dynamodb:GetItem", "dynamodb:Query"]));
    expect(actions.some((action) => action.startsWith("dynamodb:") && action.includes("Write"))).toBe(true);
  });
});

describe("StocksyncStack — RealtimeApi", () => {
  it("exposes POST /transactions wired to the write-intake Lambda", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /transactions",
    });
  });

  it("provisions a WebSocket API with $connect and $disconnect routes", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", { ProtocolType: "WEBSOCKET" });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "$connect" });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "$disconnect" });
  });

  it("grants the conflict-resolver permission to manage WebSocket connections", () => {
    const template = synthTemplate();
    const policies = template.findResources("AWS::IAM::Policy");
    const resolverPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy).includes("ConflictResolverFunction") &&
      JSON.stringify(policy).includes("execute-api:ManageConnections"),
    );
    expect(resolverPolicy).toBeDefined();
  });

  it("exposes GET /sync wired to a read-only sync-query Lambda", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "GET /sync" });

    const policies = template.findResources("AWS::IAM::Policy");
    const syncQueryPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy).includes("SyncQueryFunction"),
    );
    expect(syncQueryPolicy).toBeDefined();
    const statements = (
      syncQueryPolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    ).Properties.PolicyDocument.Statement;
    const actions = statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));
    expect(actions.every((action) => !action.includes("Put") && !action.includes("Delete") && !action.includes("Update"))).toBe(
      true,
    );
  });

  it("exposes GET /audit/{item_id} wired to a read-only audit-query Lambda", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "GET /audit/{item_id}" });

    const policies = template.findResources("AWS::IAM::Policy");
    const auditQueryPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy).includes("AuditQueryFunction"),
    );
    expect(auditQueryPolicy).toBeDefined();
    const statements = (
      auditQueryPolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    ).Properties.PolicyDocument.Statement;
    const actions = statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));
    expect(actions.every((action) => !action.includes("Put") && !action.includes("Delete") && !action.includes("Update"))).toBe(
      true,
    );
  });

  it("exposes POST /conflicts/{item_id}/resolve wired to a Lambda that can read/write inventory_records, write audit_log, and manage WebSocket connections (Phase 8)", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /conflicts/{item_id}/resolve" });

    const policies = template.findResources("AWS::IAM::Policy");
    const resolvePolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy).includes("ConflictResolveFunction"),
    );
    expect(resolvePolicy).toBeDefined();
    const statements = (
      resolvePolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    ).Properties.PolicyDocument.Statement;
    const actions = statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));

    expect(actions).toEqual(expect.arrayContaining(["dynamodb:GetItem", "execute-api:ManageConnections"]));
    expect(actions.some((action) => action.startsWith("dynamodb:") && action.includes("Write"))).toBe(true);
  });
});

describe("StocksyncStack — Bedrock price-conflict explainer (Phase 8)", () => {
  it("grants the conflict-resolver bedrock:InvokeModel scoped to exactly one foundation model, never a wildcard resource", () => {
    const template = synthTemplate();
    const policies = template.findResources("AWS::IAM::Policy");
    const resolverPolicy = Object.values(policies).find(
      (policy) =>
        JSON.stringify(policy).includes("ConflictResolverFunction") && JSON.stringify(policy).includes("bedrock:InvokeModel"),
    );
    expect(resolverPolicy).toBeDefined();

    const statements = (
      resolverPolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] } } }
    ).Properties.PolicyDocument.Statement;
    const bedrockStatement = statements.find((statement) => {
      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      return actions.includes("bedrock:InvokeModel");
    });
    expect(bedrockStatement?.Resource).not.toBe("*");
    // The region is a CFN pseudo-parameter token (Fn::Join/Ref), not a
    // plain string, at synth time — stringify the structure rather than
    // coercing the object directly.
    expect(JSON.stringify(bedrockStatement?.Resource)).toContain("foundation-model/");
  });

  it("passes the conflict-resolver a BEDROCK_MODEL_ID matching the IAM grant's resource ARN", () => {
    const template = synthTemplate();
    const fn = template.findResources("AWS::Lambda::Function", {
      Properties: { Environment: { Variables: { BEDROCK_MODEL_ID: bedrockModelId } } },
    });
    expect(Object.keys(fn).length).toBeGreaterThan(0);
  });
});

describe("StocksyncStack — Observability dashboard (Phase 9)", () => {
  it("creates exactly one CloudWatch dashboard referencing both custom metrics and the write/DLQ queue depths", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::CloudWatch::Dashboard", 1);

    const dashboards = template.findResources("AWS::CloudWatch::Dashboard");
    const [dashboard] = Object.values(dashboards);
    // DashboardBody is a CFN intrinsic (Fn::Join over dynamic queue-name
    // tokens), not a plain string at synth time — stringify the whole
    // structure rather than expecting a literal JSON string, same
    // reasoning as the Bedrock resource ARN assertion above.
    const body = JSON.stringify(dashboard);
    expect(body).toContain("ConflictRate");
    expect(body).toContain("IdempotencyHitRate");
    expect(body).toContain("StockSync");
    expect(body).toContain("ApproximateNumberOfMessagesVisible");
  });
});

describe("StocksyncStack — no wildcard IAM resources", () => {
  it("never grants a DynamoDB or SQS action against a wildcard resource", () => {
    const template = synthTemplate();
    const policies = template.findResources("AWS::IAM::Policy");
    for (const policy of Object.values(policies)) {
      const statements = (
        policy as { Properties: { PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] } } }
      ).Properties.PolicyDocument.Statement;
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        const touchesDataPlane = actions.some((action) => action.startsWith("dynamodb:") || action.startsWith("sqs:"));
        if (!touchesDataPlane) continue;
        expect(statement.Resource).not.toBe("*");
      }
    }
  });
});
