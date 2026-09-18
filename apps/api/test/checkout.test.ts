import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { mockClient, type AwsStub } from "aws-sdk-client-mock";
import dynalite from "dynalite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Same fixed-endpoint-before-any-import pattern as writeIntake.test.ts —
// checkout.ts calls writeIntake.ts's handler directly, in-process, so
// this suite needs the same two env vars write-intake itself does, plus
// its own orders table.
const PORT = 8130;
const ORDERS_TABLE = "orders_test";
const DEDUP_TABLE = "write_dedup_test";
const QUEUE_URL = "https://sqs.local.test/000000000000/write-queue-test.fifo";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.ORDERS_TABLE_NAME = ORDERS_TABLE;
process.env.WRITE_DEDUP_TABLE_NAME = DEDUP_TABLE;
process.env.WRITE_QUEUE_URL = QUEUE_URL;

let dynaliteServer: ReturnType<typeof dynalite>;
let handler: typeof import("../src/handlers/checkout").handler;
let ddb: typeof import("../src/lib/dynamo").ddb;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqsMock: AwsStub<any, any, any>;

function invoke(body: unknown): Promise<{ statusCode: number; body: string }> {
  const event = { body: JSON.stringify(body) } as APIGatewayProxyEventV2;
  return handler(event) as Promise<{ statusCode: number; body: string }>;
}

function parseBody<T>(result: { body: string }): T {
  return JSON.parse(result.body) as T;
}

const validRequest = (overrides: Record<string, unknown> = {}) => ({
  shop_id: "demo-shop",
  counter_id: "counter_a",
  line_items: [
    { product_id: "parle-g", quantity: 3, unit_price: 10 },
    { product_id: "milk-500ml", quantity: 2, unit_price: 25 },
  ],
  ...overrides,
});

beforeAll(async () => {
  dynaliteServer = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    dynaliteServer.listen(PORT, (err?: Error) => (err ? reject(err) : resolve()));
  });

  ({ ddb } = await import("../src/lib/dynamo"));
  const sqsModule = await import("../src/lib/sqs");
  ({ handler } = await import("../src/handlers/checkout"));

  sqsMock = mockClient(sqsModule.sqs);

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
  await ddb.send(
    new CreateTableCommand({
      TableName: DEDUP_TABLE,
      AttributeDefinitions: [{ AttributeName: "idempotency_key", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "idempotency_key", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => dynaliteServer.close(() => resolve()));
});

beforeEach(() => {
  sqsMock.reset();
  sqsMock.on(SendMessageCommand).resolves({ MessageId: "test-message-id" });
});

describe("POST /checkout — a batch of sale transactions through the real write-intake pipeline", () => {
  it("computes the correct total, records an orders summary row, and enqueues one write per line item", async () => {
    const result = await invoke(validRequest({ order_id: "ord-checkout-1" }));

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toEqual({ order_id: "ord-checkout-1", total_amount: 80, status: "completed" });

    const order = await ddb.send(
      new GetCommand({ TableName: ORDERS_TABLE, Key: { pk: "SHOP#demo-shop", sk: "ORDER#ord-checkout-1" } }),
    );
    expect(order.Item?.total_amount).toBe(80);
    expect(order.Item?.line_items).toHaveLength(2);

    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(2);
  });

  it("uses a deterministic idempotency key per order+product, so retrying the same order never double-enqueues", async () => {
    await invoke(validRequest({ order_id: "ord-checkout-2" }));
    sqsMock.reset();
    sqsMock.on(SendMessageCommand).resolves({ MessageId: "test-message-id" });

    // Same order_id, same line items — a client retry after a dropped response.
    const retry = await invoke(validRequest({ order_id: "ord-checkout-2" }));

    expect(retry.statusCode).toBe(200);
    // write-intake's own dedup table already recognizes both idempotency
    // keys from the first call, so the retry enqueues nothing new.
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it("returns 400 for an empty cart", async () => {
    const result = await invoke(validRequest({ line_items: [] }));
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 for a non-positive quantity", async () => {
    const result = await invoke(
      validRequest({ line_items: [{ product_id: "parle-g", quantity: 0, unit_price: 10 }] }),
    );
    expect(result.statusCode).toBe(400);
  });
});
