import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { mockClient, type AwsStub } from "aws-sdk-client-mock";
import dynalite from "dynalite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fixed, known values set BEFORE the handler (and its lib/dynamo.ts,
// lib/sqs.ts clients) are ever imported — those construct their SDK
// clients once at module-load time, so the env vars must exist first.
// Dynamic imports below (inside beforeAll) guarantee that ordering
// regardless of how the test runner schedules static import hoisting.
const PORT = 8123;
const TABLE_NAME = "write_dedup_test";
const QUEUE_URL = "https://sqs.local.test/000000000000/write-queue-test.fifo";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.WRITE_DEDUP_TABLE_NAME = TABLE_NAME;
process.env.WRITE_QUEUE_URL = QUEUE_URL;

let dynaliteServer: ReturnType<typeof dynalite>;
let handler: typeof import("../src/handlers/writeIntake").handler;
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

let idCounter = 0;
function uniqueKey(): string {
  idCounter += 1;
  return `test-key-${idCounter}`;
}

const validRequest = (overrides: Record<string, unknown> = {}) => ({
  shop_id: "demo-shop",
  counter_id: "counter_a",
  transactions: [
    {
      idempotency_key: uniqueKey(),
      item_id: "parle-g",
      type: "sale",
      quantity: 5,
      client_vector_clock: { counter_a: 1 },
      client_timestamp: "2026-09-17T10:04:00Z",
    },
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
  ({ handler } = await import("../src/handlers/writeIntake"));

  sqsMock = mockClient(sqsModule.sqs);

  await ddb.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
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

describe("POST /transactions — happy path", () => {
  it("creates exactly one write_dedup row and enqueues exactly one message for a new idempotency key", async () => {
    const idempotencyKey = uniqueKey();
    const result = await invoke(
      validRequest({
        transactions: [{ idempotency_key: idempotencyKey, item_id: "parle-g", type: "sale", quantity: 5 }],
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toEqual({ results: [{ idempotency_key: idempotencyKey, status: "queued" }] });

    const row = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { idempotency_key: idempotencyKey } }));
    expect(row.Item?.status).toBe("queued");
    expect(row.Item?.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));

    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
  });

  it("preserves per-item submission order into SQS even when two batched transactions target the same item (edge case A-4)", async () => {
    const keyOne = uniqueKey();
    const keyTwo = uniqueKey();

    // Artificially slows keyOne's dedup check so a buggy
    // Promise.all(transactions.map(processTransaction)) implementation —
    // racing both transactions concurrently — would let keyTwo's
    // SendMessageCommand fire first. Proves the batch's per-item
    // sequential grouping is what actually prevents that, not incidental
    // mock-speed timing (both chains would otherwise resolve near-
    // instantly against these fast mocks either way).
    const originalSend = ddb.send.bind(ddb);
    const sendSpy = vi.spyOn(ddb, "send").mockImplementation(async (command: unknown) => {
      if (
        command instanceof GetCommand &&
        (command as InstanceType<typeof GetCommand>).input.Key?.idempotency_key === keyOne
      ) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalSend(command as any);
    });

    try {
      await invoke(
        validRequest({
          transactions: [
            { idempotency_key: keyOne, item_id: "parle-g", type: "field_update", field: "price", value: 11 },
            { idempotency_key: keyTwo, item_id: "parle-g", type: "field_update", field: "price", value: 13 },
          ],
        }),
      );
    } finally {
      sendSpy.mockRestore();
    }

    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input.MessageDeduplicationId).toBe(keyOne);
    expect(calls[1].args[0].input.MessageDeduplicationId).toBe(keyTwo);
  });

  it("sets MessageGroupId to the item_id, never the counter_id (the bug this test exists to catch)", async () => {
    const idempotencyKey = uniqueKey();
    await invoke(
      validRequest({
        counter_id: "counter_b",
        transactions: [{ idempotency_key: idempotencyKey, item_id: "rice-5kg", type: "restock", quantity: 10 }],
      }),
    );

    const [call] = sqsMock.commandCalls(SendMessageCommand);
    expect(call.args[0].input.MessageGroupId).toBe("rice-5kg");
    expect(call.args[0].input.MessageGroupId).not.toBe("counter_b");
    expect(call.args[0].input.MessageDeduplicationId).toBe(idempotencyKey);
  });
});

describe("POST /transactions — idempotency", () => {
  it("returns duplicate on the second submission of the same idempotency key and does not enqueue again", async () => {
    const idempotencyKey = uniqueKey();
    const request = validRequest({
      transactions: [{ idempotency_key: idempotencyKey, item_id: "parle-g", type: "sale", quantity: 5 }],
    });

    const first = await invoke(request);
    expect(parseBody<{ results: { status: string }[] }>(first).results[0].status).toBe("queued");

    const second = await invoke(request);
    expect(parseBody<{ results: { status: string }[] }>(second).results[0].status).toBe("duplicate");

    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
  });
});

describe("POST /transactions — validation", () => {
  it("returns 400 when item_id is missing", async () => {
    const result = await invoke({
      shop_id: "demo-shop",
      counter_id: "counter_a",
      transactions: [{ idempotency_key: uniqueKey(), type: "sale", quantity: 5 }],
    });
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 for a sale with a negative quantity (edge case E-3)", async () => {
    const result = await invoke(
      validRequest({
        transactions: [{ idempotency_key: uniqueKey(), item_id: "parle-g", type: "sale", quantity: -5 }],
      }),
    );
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 for a batch exceeding 100 transactions (edge case E-2)", async () => {
    const transactions = Array.from({ length: 101 }, () => ({
      idempotency_key: uniqueKey(),
      item_id: "parle-g",
      type: "sale",
      quantity: 1,
    }));
    const result = await invoke(validRequest({ transactions }));
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when shop_id is missing", async () => {
    const result = await invoke({
      counter_id: "counter_a",
      transactions: [{ idempotency_key: uniqueKey(), item_id: "parle-g", type: "sale", quantity: 5 }],
    });
    expect(result.statusCode).toBe(400);
  });
});
