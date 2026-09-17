import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import dynalite from "dynalite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 8127;
const TABLE_NAME = "audit_log_test";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.AUDIT_LOG_TABLE_NAME = TABLE_NAME;

let dynaliteServer: ReturnType<typeof dynalite>;
let ddb: typeof import("../src/lib/dynamo").ddb;
let handler: typeof import("../src/handlers/auditQuery").handler;

function invoke(itemId: string, query: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  const event = {
    pathParameters: { item_id: itemId },
    queryStringParameters: query,
  } as unknown as APIGatewayProxyEventV2;
  return handler(event) as Promise<{ statusCode: number; body: string }>;
}

function parseBody<T>(result: { body: string }): T {
  return JSON.parse(result.body) as T;
}

async function seedEntry(pk: string, timestamp: string, rest: Record<string, unknown>): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk, sk: `${timestamp}#${rest.eventId ?? "evt"}`, ...rest },
    }),
  );
}

beforeAll(async () => {
  dynaliteServer = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    dynaliteServer.listen(PORT, (err?: Error) => (err ? reject(err) : resolve()));
  });

  ({ ddb } = await import("../src/lib/dynamo"));
  ({ handler } = await import("../src/handlers/auditQuery"));

  await ddb.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
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
});

afterAll(async () => {
  await new Promise<void>((resolve) => dynaliteServer.close(() => resolve()));
});

describe("GET /audit/{item_id}", () => {
  it("returns the full chronological history for the item, oldest first", async () => {
    const pk = "SHOP#audit-shop-1#ITEM#parle-g";
    await seedEntry(pk, "2026-09-17T10:05:00.000Z", {
      eventId: "c",
      counter_id: "counter_a",
      action: "conflict_detected",
      resolution_strategy: "needs_review",
      details: { field: "price", values: [10, 12] },
    });
    await seedEntry(pk, "2026-09-17T10:04:00.000Z", {
      eventId: "a",
      counter_id: "counter_a",
      action: "sale",
      details: { quantity: 5, resulting_stock: 45 },
    });
    await seedEntry(pk, "2026-09-17T10:04:05.000Z", {
      eventId: "b",
      counter_id: "counter_b",
      action: "sale",
      details: { quantity: 3, resulting_stock: 42 },
    });

    const result = await invoke("parle-g", { shop_id: "audit-shop-1" });
    expect(result.statusCode).toBe(200);

    const body = parseBody<{ item_id: string; history: { timestamp: string; counter_id: string; action: string }[] }>(result);
    expect(body.item_id).toBe("parle-g");
    expect(body.history).toHaveLength(3);
    expect(body.history.map((h) => h.counter_id)).toEqual(["counter_a", "counter_b", "counter_a"]);
    expect(body.history[0].timestamp).toBe("2026-09-17T10:04:00.000Z");
    expect(body.history[2].action).toBe("conflict_detected");
  });

  it("does not leak another item's history", async () => {
    await seedEntry("SHOP#audit-shop-1#ITEM#rice-5kg", "2026-09-17T10:00:00.000Z", {
      eventId: "x",
      counter_id: "counter_a",
      action: "restock",
      details: { quantity: 10 },
    });

    const result = await invoke("parle-g", { shop_id: "audit-shop-1" });
    const body = parseBody<{ history: unknown[] }>(result);
    expect(body.history).toHaveLength(3); // only the entries seeded for parle-g in the previous test
  });

  it("returns 400 when shop_id is missing", async () => {
    const result = await invoke("parle-g", {});
    expect(result.statusCode).toBe(400);
  });
});
