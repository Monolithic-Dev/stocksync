import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateTableCommand, ResourceInUseException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import dynalite from "dynalite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InventoryRecordItem } from "../src/lib/inventoryRecord";
import { localTableDefinitions } from "../src/lib/localTables";

// Same fixed-endpoint-before-any-import pattern as writeIntake.test.ts.
// dynalite (not real DynamoDB Local) is sufficient here: conflictResolve.ts
// never uses TransactWriteItems, unlike conflictResolver.ts.
const PORT = 8128;
const INVENTORY_TABLE = "inventory_records_test";
const AUDIT_TABLE = "audit_log_test";
const WS_CONNECTIONS_TABLE = "ws_connections_test";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.INVENTORY_RECORDS_TABLE_NAME = INVENTORY_TABLE;
process.env.AUDIT_LOG_TABLE_NAME = AUDIT_TABLE;
process.env.WS_CONNECTIONS_TABLE_NAME = WS_CONNECTIONS_TABLE;
// No WEBSOCKET_CALLBACK_URL: every test below seeds an empty
// ws_connections table, so wsPush's early "no connections" return means
// the ApiGatewayManagementApiClient is never actually constructed.

let dynaliteServer: ReturnType<typeof dynalite>;
let ddb: typeof import("../src/lib/dynamo").ddb;
let handler: typeof import("../src/handlers/conflictResolve").handler;

function shopPk(itemId: string): string {
  return `SHOP#demo-shop#ITEM#${itemId}`;
}

async function seedItem(itemId: string, overrides: Partial<InventoryRecordItem> = {}): Promise<void> {
  const item: InventoryRecordItem = {
    pk: shopPk(itemId),
    sk: "CURRENT",
    shop_id: "demo-shop",
    item_id: itemId,
    base_stock: 50,
    pn_counter: { increments: {}, decrements: {} },
    stock: 50,
    vector_clock: { counter_a: 1, counter_b: 1 },
    field_last_writer: { price: "counter_a" },
    conflict_status: "needs_review",
    conflict_candidates: {
      field: "price",
      overlap_seconds: 120,
      values: [
        { counter_id: "counter_a", value: 10, server_timestamp: new Date(0).toISOString() },
        { counter_id: "counter_b", value: 12, server_timestamp: new Date(0).toISOString() },
      ],
    },
    price: 10,
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
  await ddb.send(new PutCommand({ TableName: INVENTORY_TABLE, Item: item }));
}

async function getItem(itemId: string): Promise<InventoryRecordItem | undefined> {
  const result = await ddb.send(new GetCommand({ TableName: INVENTORY_TABLE, Key: { pk: shopPk(itemId), sk: "CURRENT" } }));
  return result.Item as InventoryRecordItem | undefined;
}

async function getAuditEntries(itemId: string): Promise<Record<string, unknown>[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": shopPk(itemId) },
    }),
  );
  return (result.Items ?? []) as Record<string, unknown>[];
}

async function invoke(itemId: string | undefined, body: unknown): Promise<{ statusCode: number; body: string }> {
  const event = {
    pathParameters: itemId ? { item_id: itemId } : undefined,
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
  return (await handler(event)) as { statusCode: number; body: string };
}

let itemCounter = 0;
function uniqueItemId(): string {
  itemCounter += 1;
  return `test-item-${itemCounter}`;
}

beforeAll(async () => {
  dynaliteServer = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    dynaliteServer.listen(PORT, (err?: Error) => (err ? reject(err) : resolve()));
  });

  ({ ddb } = await import("../src/lib/dynamo"));
  ({ handler } = await import("../src/handlers/conflictResolve"));

  for (const command of localTableDefinitions({
    inventoryRecords: INVENTORY_TABLE,
    auditLog: AUDIT_TABLE,
    writeDedup: "write_dedup_test",
    wsConnections: WS_CONNECTIONS_TABLE,
  })) {
    try {
      await ddb.send(command as unknown as CreateTableCommand);
    } catch (error) {
      if (!(error instanceof ResourceInUseException)) throw error;
    }
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => dynaliteServer.close(() => resolve()));
});

describe("conflictResolve — a human picks a value", () => {
  it("applies the chosen value, clears the conflict, and appends a conflict_resolved_manual audit entry", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId);

    const response = await invoke(itemId, { shop_id: "demo-shop", field: "price", chosen_value: 10, resolved_by: "shop_owner" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual({ item_id: itemId, field: "price", status: "resolved", value: 10 });

    const item = await getItem(itemId);
    expect(item?.price).toBe(10);
    expect(item?.conflict_status).toBe("none");
    expect(item?.conflict_candidates).toBeUndefined();
    expect(item?.field_last_writer.price).toBe("shop_owner");

    const auditEntries = await getAuditEntries(itemId);
    expect(auditEntries.some((e) => e.action === "conflict_resolved_manual")).toBe(true);
    const resolvedEntry = auditEntries.find((e) => e.action === "conflict_resolved_manual");
    expect(resolvedEntry?.details).toEqual({ field: "price", chosen_value: 10 });
  });

  it("returns 409 conflict_already_resolved when a second person resolves after the first already did (04-API-SPEC.md §4)", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId);

    const first = await invoke(itemId, { shop_id: "demo-shop", field: "price", chosen_value: 10, resolved_by: "counter_a" });
    expect(first.statusCode).toBe(200);

    const second = await invoke(itemId, { shop_id: "demo-shop", field: "price", chosen_value: 12, resolved_by: "counter_b" });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body as string).error).toBe("conflict_already_resolved");

    // The first resolution's value is untouched by the rejected second attempt.
    const item = await getItem(itemId);
    expect(item?.price).toBe(10);
  });

  it("returns 409 when the item was never in needs_review at all", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId, { conflict_status: "none", conflict_candidates: undefined });

    const response = await invoke(itemId, { shop_id: "demo-shop", field: "price", chosen_value: 10, resolved_by: "shop_owner" });
    expect(response.statusCode).toBe(409);
  });

  it("returns 404 for an item that doesn't exist", async () => {
    const response = await invoke("no-such-item", { shop_id: "demo-shop", field: "price", chosen_value: 10, resolved_by: "shop_owner" });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for a missing required field", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId);

    const response = await invoke(itemId, { shop_id: "demo-shop", field: "price", resolved_by: "shop_owner" });
    expect(response.statusCode).toBe(400);
  });
});
