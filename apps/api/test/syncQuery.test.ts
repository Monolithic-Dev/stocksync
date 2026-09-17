import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import dynalite from "dynalite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InventoryRecordItem } from "../src/lib/inventoryRecord";

const PORT = 8126;
const TABLE_NAME = "inventory_records_sync_test";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.INVENTORY_RECORDS_TABLE_NAME = TABLE_NAME;

let dynaliteServer: ReturnType<typeof dynalite>;
let ddb: typeof import("../src/lib/dynamo").ddb;
let handler: typeof import("../src/handlers/syncQuery").handler;

function invoke(query: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  const event = { queryStringParameters: query } as unknown as APIGatewayProxyEventV2;
  return handler(event) as Promise<{ statusCode: number; body: string }>;
}

function parseBody<T>(result: { body: string }): T {
  return JSON.parse(result.body) as T;
}

async function seedItem(item: Partial<InventoryRecordItem> & { shop_id: string; item_id: string }): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `SHOP#${item.shop_id}#ITEM#${item.item_id}`,
        sk: "CURRENT",
        base_stock: 0,
        pn_counter: { increments: {}, decrements: {} },
        stock: 0,
        vector_clock: {},
        field_last_writer: {},
        conflict_status: "none",
        updated_at: new Date().toISOString(),
        ...item,
      },
    }),
  );
}

beforeAll(async () => {
  dynaliteServer = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    dynaliteServer.listen(PORT, (err?: Error) => (err ? reject(err) : resolve()));
  });

  ({ ddb } = await import("../src/lib/dynamo"));
  ({ handler } = await import("../src/handlers/syncQuery"));

  await ddb.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
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
});

afterAll(async () => {
  await new Promise<void>((resolve) => dynaliteServer.close(() => resolve()));
});

describe("GET /sync", () => {
  it("returns every item for the shop, mapped to the documented sync shape", async () => {
    await seedItem({
      shop_id: "sync-shop-1",
      item_id: "parle-g",
      name: "Parle-G 100g",
      stock: 40,
      price: 10,
      shelf_location: "Aisle 2",
      field_last_writer: { price: "counter_a" },
    });
    await seedItem({ shop_id: "sync-shop-1", item_id: "rice-5kg", stock: 12 });
    await seedItem({ shop_id: "sync-shop-other", item_id: "milk-500ml", stock: 5 });

    const result = await invoke({ shop_id: "sync-shop-1", counter_id: "counter_a" });
    expect(result.statusCode).toBe(200);

    const body = parseBody<{ items: { item_id: string; stock: number }[] }>(result);
    const itemIds = body.items.map((i) => i.item_id).sort();
    expect(itemIds).toEqual(["parle-g", "rice-5kg"]);

    const parleG = body.items.find((i) => i.item_id === "parle-g");
    expect(parleG).toMatchObject({ stock: 40, price: 10, shelf_location: "Aisle 2" });
  });

  it("includes conflict_candidates only when conflict_status is needs_review", async () => {
    await seedItem({
      shop_id: "sync-shop-2",
      item_id: "parle-g",
      conflict_status: "needs_review",
      conflict_candidates: { field: "price", overlap_seconds: 300, values: [] },
    });
    await seedItem({ shop_id: "sync-shop-2", item_id: "rice-5kg", conflict_status: "none" });

    const result = await invoke({ shop_id: "sync-shop-2", counter_id: "counter_a" });
    const body = parseBody<{ items: { item_id: string; conflict_candidates?: unknown }[] }>(result);

    const conflicted = body.items.find((i) => i.item_id === "parle-g");
    const clean = body.items.find((i) => i.item_id === "rice-5kg");
    expect(conflicted?.conflict_candidates).toBeDefined();
    expect(clean?.conflict_candidates).toBeUndefined();
  });

  it("surfaces stock_anomaly to the client, not just DynamoDB's raw data (edge case B-1)", async () => {
    await seedItem({ shop_id: "sync-shop-3", item_id: "parle-g", stock: -2, stock_anomaly: true });
    await seedItem({ shop_id: "sync-shop-3", item_id: "rice-5kg", stock: 5, stock_anomaly: false });

    const result = await invoke({ shop_id: "sync-shop-3", counter_id: "counter_a" });
    const body = parseBody<{ items: { item_id: string; stock_anomaly?: boolean }[] }>(result);

    expect(body.items.find((i) => i.item_id === "parle-g")?.stock_anomaly).toBe(true);
    expect(body.items.find((i) => i.item_id === "rice-5kg")?.stock_anomaly).toBe(false);
  });

  it("returns 400 when shop_id is missing", async () => {
    const result = await invoke({ counter_id: "counter_a" });
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when counter_id is missing", async () => {
    const result = await invoke({ shop_id: "sync-shop-1" });
    expect(result.statusCode).toBe(400);
  });
});
