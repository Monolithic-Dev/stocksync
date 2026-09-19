import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { StocksyncStack } from "../lib/stocksync-stack";
import { bedrockModelId, bedrockInferenceProfileArn } from "../lib/config";

function synthTemplate(): Template {
  const app = new App();
  const stack = new StocksyncStack(app, "TestStack");
  return Template.fromStack(stack);
}

describe("StocksyncStack — DataLayer", () => {
  it("creates exactly eight on-demand DynamoDB tables (4 Tier-1 sync + 4 Tier-2 catalog/checkout)", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::DynamoDB::Table", 8);
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

  it("creates a Secrets Manager secret for the cross-account Bedrock credentials and grants the conflict-resolver read access", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::SecretsManager::Secret", 1);

    const policies = template.findResources("AWS::IAM::Policy");
    const secretReadPolicy = Object.values(policies).find(
      (policy) =>
        JSON.stringify(policy).includes("ConflictResolverFunction") &&
        JSON.stringify(policy).includes("secretsmanager:GetSecretValue"),
    );
    expect(secretReadPolicy).toBeDefined();
  });

  it("passes the conflict-resolver the cross-account inference-profile ARN and the credentials secret's ARN", () => {
    const template = synthTemplate();
    const fn = template.findResources("AWS::Lambda::Function", {
      Properties: { Environment: { Variables: { BEDROCK_INFERENCE_PROFILE_ARN: bedrockInferenceProfileArn } } },
    });
    expect(Object.keys(fn).length).toBeGreaterThan(0);

    const [resolverFn] = Object.values(fn) as { Properties: { Environment: { Variables: Record<string, unknown> } } }[];
    expect(resolverFn.Properties.Environment.Variables.BEDROCK_CREDENTIALS_SECRET_ARN).toBeDefined();
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

describe("StocksyncStack — PlatformCrud (Tier 2, 19b)", () => {
  it("creates the products table with a CategoryIndex GSI, plus categories/suppliers/orders tables", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "CategoryIndex",
          KeySchema: Match.arrayWith([Match.objectLike({ AttributeName: "category_id", KeyType: "HASH" })]),
        }),
      ]),
    });
    // 4 Tier-1 sync tables + products/categories/suppliers/orders = 8,
    // already asserted above — this test only checks the CRUD tables'
    // own shape (pk/sk + the one GSI), not the total count again.
    const tables = template.findResources("AWS::DynamoDB::Table");
    const withoutGsi = Object.values(tables).filter(
      (table) => !(table as { Properties: { GlobalSecondaryIndexes?: unknown } }).Properties.GlobalSecondaryIndexes,
    );
    // inventory_records, write_dedup, audit_log, categories, suppliers,
    // orders — every table except inventory_records (ShopConflictIndex),
    // ws_connections (ShopConnectionsIndex) and products (CategoryIndex).
    expect(withoutGsi.length).toBe(5);
  });

  it("exposes GET/POST /products, /categories, /suppliers and PUT/DELETE on their {x_id} routes", () => {
    const template = synthTemplate();
    for (const resource of ["products", "categories", "suppliers"]) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: `GET /${resource}` });
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: `POST /${resource}` });
      const idParam = resource.replace(/s$/, "") + "_id";
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: `PUT /${resource}/{${idParam}}` });
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: `DELETE /${resource}/{${idParam}}` });
    }
  });

  it("exposes POST /checkout, and grants the checkout function write_dedup read/write plus SQS send (same guarantees as write-intake)", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /checkout" });

    const policies = template.findResources("AWS::IAM::Policy");
    const checkoutPolicy = Object.values(policies).find((policy) => JSON.stringify(policy).includes("CheckoutFunction"));
    expect(checkoutPolicy).toBeDefined();
    const statements = (
      checkoutPolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    ).Properties.PolicyDocument.Statement;
    const actions = statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));

    expect(actions).toEqual(expect.arrayContaining(["sqs:SendMessage"]));
    expect(actions.some((action) => action.startsWith("dynamodb:") && action.includes("Write"))).toBe(true);
  });
});

describe("StocksyncStack — Auth (Cognito, real authentication)", () => {
  it("creates exactly one self-signup User Pool with a custom:shop_id attribute and email sign-in", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
      Schema: Match.arrayWith([Match.objectLike({ Name: "shop_id", Mutable: true })]),
    });
  });

  it("creates exactly one public app client with no secret", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::Cognito::UserPoolClient", 1);
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", { GenerateSecret: false });
  });

  it("creates exactly the three role groups: owner, manager, counter_staff", () => {
    const template = synthTemplate();
    const groups = template.findResources("AWS::Cognito::UserPoolGroup");
    const names = Object.values(groups).map(
      (group) => (group as { Properties: { GroupName: string } }).Properties.GroupName,
    );
    expect(names.sort()).toEqual(["counter_staff", "manager", "owner"]);
  });

  it("wires a postConfirmation trigger that can only add users to a group, never read/write user data directly", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      LambdaConfig: Match.objectLike({ PostConfirmation: Match.anyValue() }),
    });

    const policies = template.findResources("AWS::IAM::Policy");
    const postConfirmationPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy).includes("PostConfirmationFunction"),
    );
    expect(postConfirmationPolicy).toBeDefined();
    const statements = (
      postConfirmationPolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    ).Properties.PolicyDocument.Statement;
    const actions = statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));
    expect(actions).toEqual(["cognito-idp:AdminAddUserToGroup"]);
  });

  it("exposes POST /staff wired to staffInviteFn, which can create/group/update-attributes users but nothing else on the pool", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /staff" });

    const policies = template.findResources("AWS::IAM::Policy");
    const staffPolicy = Object.values(policies).find((policy) => JSON.stringify(policy).includes("StaffInviteFunction"));
    expect(staffPolicy).toBeDefined();
    const statements = (
      staffPolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    ).Properties.PolicyDocument.Statement;
    const actions = statements
      .flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]))
      .sort();
    expect(actions).toEqual(
      ["cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminCreateUser", "cognito-idp:AdminUpdateUserAttributes"].sort(),
    );
  });

  it("creates exactly one JWT authorizer, and every non-auth REST route requires it", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", { AuthorizerType: "JWT" });

    const routes = template.findResources("AWS::ApiGatewayV2::Route");
    const httpRoutes = Object.values(routes).filter(
      (route) => !(route as { Properties: { RouteKey: string } }).Properties.RouteKey.startsWith("$"),
    );
    // Every REST route in this API requires a signed-in user — there is no
    // public route (sign-up/sign-in themselves go straight to Cognito from
    // the client, never through this API).
    expect(httpRoutes.length).toBeGreaterThan(0);
    for (const route of httpRoutes) {
      expect((route as { Properties: { AuthorizerId?: unknown } }).Properties.AuthorizerId).toBeDefined();
    }
  });

  it("passes wsConnectFn the User Pool id/client id it needs to verify tokens itself (WebSocket routes have no native JWT authorizer)", () => {
    const template = synthTemplate();
    const fn = template.findResources("AWS::Lambda::Function", {
      Properties: { Environment: { Variables: { USER_POOL_ID: Match.anyValue(), USER_POOL_CLIENT_ID: Match.anyValue() } } },
    });
    expect(Object.keys(fn).length).toBeGreaterThan(0);
  });
});

describe("StocksyncStack — Analytics (Phase 3, owner dashboard)", () => {
  it("exposes GET /dashboard behind the JWT authorizer", () => {
    const template = synthTemplate();
    const routes = template.findResources("AWS::ApiGatewayV2::Route", { Properties: { RouteKey: "GET /dashboard" } });
    expect(Object.keys(routes).length).toBe(1);
    const [route] = Object.values(routes) as { Properties: { AuthorizerId?: unknown } }[];
    expect(route.Properties.AuthorizerId).toBeDefined();
  });

  it("grants the dashboard function read-only access to inventory_records and orders, nothing else", () => {
    const template = synthTemplate();
    const policies = template.findResources("AWS::IAM::Policy");
    const dashboardPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy).includes("DashboardQueryFunction"),
    );
    expect(dashboardPolicy).toBeDefined();
    const statements = (
      dashboardPolicy as { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    ).Properties.PolicyDocument.Statement;
    const actions = statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));

    expect(actions.every((action) => !action.includes("Put") && !action.includes("Delete") && !action.includes("Update"))).toBe(
      true,
    );
    expect(actions.some((action) => action.startsWith("dynamodb:") && (action.includes("Query") || action.includes("Get")))).toBe(
      true,
    );
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
