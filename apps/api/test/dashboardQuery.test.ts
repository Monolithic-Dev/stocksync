import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import dynalite from "dynalite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 8132;
const INVENTORY_TABLE = "inventory_records_test";
const ORDERS_TABLE = "orders_test_dashboard";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.INVENTORY_RECORDS_TABLE_NAME = INVENTORY_TABLE;
process.env.ORDERS_TABLE_NAME = ORDERS_TABLE;

let dynaliteServer: ReturnType<typeof dynalite>;
let handler: typeof import("../src/handlers/dashboardQuery").handler;
let ddb: typeof import("../src/lib/dynamo").ddb;

function invoke(
  claims: Record<string, string> | undefined,
  query: Record<string, string> = {},
): Promise<{ statusCode: number; body: string }> {
  const event = {
    requestContext: claims ? { authorizer: { jwt: { claims } } } : {},
    queryStringParameters: query,
  } as unknown as APIGatewayProxyEventV2;
  return handler(event) as Promise<{ statusCode: number; body: string }>;
}

function parseBody<T>(result: { body: string }): T {
  return JSON.parse(result.body) as T;
}

const OWNER_CLAIMS = { sub: "u-owner", "custom:shop_id": "dash-shop", "cognito:groups": "owner" };
const STAFF_CLAIMS = { sub: "u-staff", "custom:shop_id": "dash-shop", "cognito:groups": "counter_staff" };

async function seedItem(overrides: Record<string, unknown>): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: INVENTORY_TABLE,
      Item: {
        pk: `SHOP#dash-shop#ITEM#${overrides.item_id}`,
        sk: "CURRENT",
        shop_id: "dash-shop",
        conflict_status: "none",
        ...overrides,
      },
    }),
  );
}

async function seedOrder(orderId: string, totalAmount: number, createdAt: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: ORDERS_TABLE,
      Item: { pk: "SHOP#dash-shop", sk: `ORDER#${orderId}`, order_id: orderId, total_amount: totalAmount, created_at: createdAt },
    }),
  );
}

beforeAll(async () => {
  dynaliteServer = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    dynaliteServer.listen(PORT, (err?: Error) => (err ? reject(err) : resolve()));
  });

  ({ ddb } = await import("../src/lib/dynamo"));
  ({ handler } = await import("../src/handlers/dashboardQuery"));

  await ddb.send(
    new CreateTableCommand({
      TableName: INVENTORY_TABLE,
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "shop_id", AttributeType: "S" },
        { AttributeName: "conflict_status", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "ShopConflictIndex",
          KeySchema: [
            { AttributeName: "shop_id", KeyType: "HASH" },
            { AttributeName: "conflict_status", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await ddb.send(
    new CreateTableCommand({
      TableName: ORDERS_TABLE,
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  await seedItem({ item_id: "parle-g", name: "Parle-G 100g", stock: 40, conflict_status: "none" });
  await seedItem({ item_id: "milk-500ml", name: "Milk 500ml", stock: 2, conflict_status: "none" });
  await seedItem({ item_id: "rice-5kg", name: "Rice 5kg", stock: 0, conflict_status: "needs_review" });

  const now = new Date();
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  await seedOrder("ord-1", 100, now.toISOString());
  await seedOrder("ord-2", 50, now.toISOString());
  await seedOrder("ord-3", 25, eightDaysAgo);
});

afterAll(async () => {
  await new Promise<void>((resolve) => dynaliteServer.close(() => resolve()));
});

interface DashboardBody {
  revenue: { total: number; order_count: number; average_order_value: number; last_7_days: number };
  low_stock: { item_id: string; name?: string; stock: number }[];
  trust_score: { percent: number; total_items: number; items_with_open_conflict: number };
}

describe("GET /dashboard", () => {
  it("403s counter_staff — this is an owner/manager-only view", async () => {
    const result = await invoke(STAFF_CLAIMS);
    expect(result.statusCode).toBe(403);
  });

  it("computes revenue totals, a 7-day window, low-stock items, and a trust score, for an owner", async () => {
    const result = await invoke(OWNER_CLAIMS);
    expect(result.statusCode).toBe(200);
    const body = parseBody<DashboardBody>(result);

    expect(body.revenue).toEqual({ total: 175, order_count: 3, average_order_value: 58.33, last_7_days: 150 });

    expect(body.low_stock.map((item) => item.item_id)).toEqual(["rice-5kg", "milk-500ml"]);

    expect(body.trust_score).toEqual({ percent: 66.7, total_items: 3, items_with_open_conflict: 1 });
  });

  it("uses the JWT's shop_id, not a client-supplied one, when an authorizer context is present", async () => {
    const result = await invoke(OWNER_CLAIMS, { shop_id: "attacker-shop" });
    expect(result.statusCode).toBe(200);
    expect(parseBody<DashboardBody>(result).revenue.order_count).toBe(3);
  });

  it("falls back to the query-string shop_id with no authorizer context (local dev)", async () => {
    const result = await invoke(undefined, { shop_id: "dash-shop" });
    expect(result.statusCode).toBe(200);
    expect(parseBody<DashboardBody>(result).revenue.order_count).toBe(3);
  });

  it("400s when shop_id is missing entirely", async () => {
    const result = await invoke(undefined, {});
    expect(result.statusCode).toBe(400);
  });

  it("respects a custom low_stock_threshold", async () => {
    const result = await invoke(OWNER_CLAIMS, { low_stock_threshold: "0" });
    const body = parseBody<DashboardBody>(result);
    expect(body.low_stock.map((item) => item.item_id)).toEqual(["rice-5kg"]);
  });
});
