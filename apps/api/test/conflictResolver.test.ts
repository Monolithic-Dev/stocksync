import { randomUUID } from "node:crypto";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { QueuedTransactionMessage } from "../src/lib/queueMessage";
import type { InventoryRecordItem } from "../src/lib/inventoryRecord";
import { localTableDefinitions } from "../src/lib/localTables";
import { createTableIfNotExists, startDynamoDbLocal, type DynamoDbLocalHandle } from "./helpers/dynamoDbLocal";

// Bedrock isn't part of this file's DynamoDB Local setup — it's mocked at
// the SDK client level so the Bedrock price-conflict describe block below
// can run fully offline, with no live AWS credentials or network access.
const bedrockMock = mockClient(BedrockRuntimeClient);

// InvokeModelCommandOutput.body is typed as an SDK-internal blob adapter
// (IUint8ArrayBlobAdapter), not a plain Uint8Array — casting via `never`
// here is simpler than constructing that adapter type just for a mock.
function bedrockRespondsWith(text: string): void {
  bedrockMock.on(InvokeModelCommand).resolves({
    body: new TextEncoder().encode(JSON.stringify({ content: [{ type: "text", text }] })),
  } as never);
}

// Same fixed-endpoint-before-any-import pattern as writeIntake.test.ts —
// see that file for why dynamic imports (in beforeAll) are required here.
// Unlike writeIntake/wsPush's dynalite, this uses the real DynamoDB Local
// (see helpers/dynamoDbLocal.ts) because this suite exercises
// TransactWriteItems, which dynalite doesn't implement at all.
const PORT = 8124;
const INVENTORY_TABLE = "inventory_records_test";
const AUDIT_TABLE = "audit_log_test";
const DEDUP_TABLE = "write_dedup_test";
const WS_CONNECTIONS_TABLE = "ws_connections_test";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.INVENTORY_RECORDS_TABLE_NAME = INVENTORY_TABLE;
process.env.AUDIT_LOG_TABLE_NAME = AUDIT_TABLE;
process.env.WRITE_DEDUP_TABLE_NAME = DEDUP_TABLE;
process.env.WS_CONNECTIONS_TABLE_NAME = WS_CONNECTIONS_TABLE;
// No WEBSOCKET_CALLBACK_URL: every test below seeds an empty
// ws_connections table, so wsPush's early "no connections" return means
// the ApiGatewayManagementApiClient is never actually constructed.

let dynamoDbLocal: DynamoDbLocalHandle;
let ddb: typeof import("../src/lib/dynamo").ddb;
let handler: typeof import("../src/handlers/conflictResolver").handler;

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
    vector_clock: {},
    field_last_writer: {},
    conflict_status: "none",
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
  await ddb.send(new PutCommand({ TableName: INVENTORY_TABLE, Item: item }));
}

function buildMessage(overrides: Partial<QueuedTransactionMessage>): QueuedTransactionMessage {
  return {
    shop_id: "demo-shop",
    counter_id: "counter_a",
    idempotency_key: randomUUID(),
    item_id: "parle-g",
    type: "sale",
    quantity: 1,
    client_vector_clock: {},
    client_timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function toRecord(message: QueuedTransactionMessage): SQSRecord {
  return {
    messageId: message.idempotency_key,
    receiptHandle: "test-receipt-handle",
    body: JSON.stringify(message),
    attributes: {} as SQSRecord["attributes"],
    messageAttributes: {},
    md5OfBody: "",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:local:000000000000:write-queue-test.fifo",
    awsRegion: "local",
  };
}

async function invoke(messages: QueuedTransactionMessage[]) {
  const event: SQSEvent = { Records: messages.map(toRecord) };
  return handler(event);
}

async function getItem(itemId: string): Promise<InventoryRecordItem | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: INVENTORY_TABLE,
      Key: { pk: shopPk(itemId), sk: "CURRENT" },
    }),
  );
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

async function getDedupStatus(idempotencyKey: string): Promise<string | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: DEDUP_TABLE,
      Key: { idempotency_key: idempotencyKey },
    }),
  );
  return result.Item?.status as string | undefined;
}

let itemCounter = 0;
function uniqueItemId(): string {
  itemCounter += 1;
  return `test-item-${itemCounter}`;
}

beforeAll(async () => {
  dynamoDbLocal = await startDynamoDbLocal(PORT);

  ({ ddb } = await import("../src/lib/dynamo"));
  ({ handler } = await import("../src/handlers/conflictResolver"));

  for (const command of localTableDefinitions({
    inventoryRecords: INVENTORY_TABLE,
    auditLog: AUDIT_TABLE,
    writeDedup: DEDUP_TABLE,
    wsConnections: WS_CONNECTIONS_TABLE,
  })) {
    await createTableIfNotExists(ddb, command);
  }
}, 180000); // generous: covers a cold JVM start plus a first-time ~55MB jar download on a slow connection

afterAll(async () => {
  await dynamoDbLocal.stop();
});

// Every price-conflict test in this file (not just the Bedrock-specific
// describe block below) now exercises maybeExplainPriceConflict, since
// it's unconditionally wired into any needs_review resolution on the
// price field. Defaulting to a rejection here means the pre-Phase-8 US-5
// test degrades gracefully and quietly (as production would if Bedrock
// were simply unreachable) instead of hitting an unmocked-command crash;
// individual tests below override with a more specific InvokeModelCommand
// mock where the explanation itself is what's under test.
beforeEach(() => {
  bedrockMock.reset();
  bedrockMock.onAnyCommand().rejects(new Error("Bedrock not mocked for this test"));
});

describe("conflictResolver — the canonical US-3 scenario", () => {
  it("merges concurrent decrements to 40, arrival order A-A-B", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId);

    const a1 = buildMessage({ item_id: itemId, counter_id: "counter_a", client_vector_clock: { counter_a: 1 }, quantity: 5 });
    await invoke([a1]);
    const a2 = buildMessage({ item_id: itemId, counter_id: "counter_a", client_vector_clock: { counter_a: 2 }, quantity: 2 });
    await invoke([a2]);
    const b1 = buildMessage({ item_id: itemId, counter_id: "counter_b", client_vector_clock: { counter_b: 1 }, quantity: 3 });
    await invoke([b1]);

    const item = await getItem(itemId);
    expect(item?.stock).toBe(40);

    const auditEntries = await getAuditEntries(itemId);
    expect(auditEntries).toHaveLength(3);
    expect(auditEntries.map((e) => e.counter_id).sort()).toEqual(["counter_a", "counter_a", "counter_b"]);
  });

  it("merges concurrent decrements to 40, arrival order B-A-A (reversed)", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId);

    const b1 = buildMessage({ item_id: itemId, counter_id: "counter_b", client_vector_clock: { counter_b: 1 }, quantity: 3 });
    await invoke([b1]);
    const a1 = buildMessage({ item_id: itemId, counter_id: "counter_a", client_vector_clock: { counter_a: 1 }, quantity: 5 });
    await invoke([a1]);
    const a2 = buildMessage({ item_id: itemId, counter_id: "counter_a", client_vector_clock: { counter_a: 2 }, quantity: 2 });
    await invoke([a2]);

    const item = await getItem(itemId);
    expect(item?.stock).toBe(40);

    const auditEntries = await getAuditEntries(itemId);
    expect(auditEntries).toHaveLength(3);
  });
});

describe("conflictResolver — three or more concurrent counters, not just two (edge case A-3)", () => {
  it("merges three counters' concurrent decrements to the correct total", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId);

    // All three arrive fully concurrent — each vector clock has only its
    // own component, so none has observed any of the others' progress.
    const a1 = buildMessage({ item_id: itemId, counter_id: "counter_a", client_vector_clock: { counter_a: 1 }, quantity: 5 });
    const b1 = buildMessage({ item_id: itemId, counter_id: "counter_b", client_vector_clock: { counter_b: 1 }, quantity: 3 });
    const c1 = buildMessage({ item_id: itemId, counter_id: "counter_c", client_vector_clock: { counter_c: 1 }, quantity: 2 });
    await invoke([b1]);
    await invoke([c1]);
    await invoke([a1]);

    const item = await getItem(itemId);
    expect(item?.stock).toBe(40); // 50 - 5 - 3 - 2

    const auditEntries = await getAuditEntries(itemId);
    expect(auditEntries).toHaveLength(3);
    expect(auditEntries.map((e) => e.counter_id).sort()).toEqual(["counter_a", "counter_b", "counter_c"]);
  });
});

describe("conflictResolver — US-4 field-merge", () => {
  it("applies concurrent writes to different fields without conflict", async () => {
    const itemId = uniqueItemId();
    // vector_clock reflects that counter_a's earlier write is what set
    // price to 10 — an empty clock would make a later write trivially
    // "dominate" (nothing to be behind), never reaching the concurrent
    // branch that field-conflict detection depends on.
    await seedItem(itemId, { price: 10, field_last_writer: { price: "counter_a" }, vector_clock: { counter_a: 1 } });

    await invoke([
      buildMessage({
        item_id: itemId,
        counter_id: "counter_a",
        type: "field_update",
        field: "shelf_location",
        value: "Aisle 3",
        client_vector_clock: { counter_a: 1 },
      }),
    ]);
    await invoke([
      buildMessage({
        item_id: itemId,
        counter_id: "counter_b",
        type: "field_update",
        field: "supplier",
        value: "New Supplier",
        client_vector_clock: { counter_b: 1 },
      }),
    ]);

    const item = await getItem(itemId);
    expect(item?.shelf_location).toBe("Aisle 3");
    expect(item?.supplier).toBe("New Supplier");
    expect(item?.conflict_status).toBe("none");
  });
});

describe("conflictResolver — US-5 needs-review", () => {
  it("flags a genuine same-field conflict, preserves both candidates, and stock keeps updating", async () => {
    const itemId = uniqueItemId();
    // vector_clock reflects that counter_a's earlier write is what set
    // price to 10 — an empty clock would make a later write trivially
    // "dominate" (nothing to be behind), never reaching the concurrent
    // branch that field-conflict detection depends on.
    await seedItem(itemId, { price: 10, field_last_writer: { price: "counter_a" }, vector_clock: { counter_a: 1 } });

    await invoke([
      buildMessage({
        item_id: itemId,
        counter_id: "counter_b",
        type: "field_update",
        field: "price",
        value: 12,
        client_vector_clock: { counter_b: 1 },
      }),
    ]);

    let item = await getItem(itemId);
    expect(item?.conflict_status).toBe("needs_review");
    expect(item?.price).toBe(10); // untouched pending review
    expect(item?.conflict_candidates?.field).toBe("price");
    expect(item?.conflict_candidates?.values.map((v) => v.value)).toEqual([10, 12]);

    const auditEntries = await getAuditEntries(itemId);
    expect(auditEntries.some((e) => e.action === "conflict_detected")).toBe(true);

    // Stock, unaffected by the price conflict, continues updating normally.
    // counter_a's clock advances to 2 — this is its second local operation
    // (the seed represents its first, which set price to 10).
    await invoke([
      buildMessage({ item_id: itemId, counter_id: "counter_a", type: "sale", quantity: 5, client_vector_clock: { counter_a: 2 } }),
    ]);
    item = await getItem(itemId);
    expect(item?.stock).toBe(45);
    expect(item?.conflict_status).toBe("needs_review"); // still pending — unrelated write didn't clear it
  });
});

describe("conflictResolver — B-1 negative stock is written as-is and flagged, never clamped", () => {
  it("flags stock_anomaly when a sale takes stock negative, and clears it once stock recovers", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId, { base_stock: 5, stock: 5 });

    await invoke([
      buildMessage({ item_id: itemId, counter_id: "counter_a", type: "sale", quantity: 8, client_vector_clock: { counter_a: 1 } }),
    ]);

    let item = await getItem(itemId);
    expect(item?.stock).toBe(-3); // written as-is, never clamped to zero
    expect(item?.stock_anomaly).toBe(true);

    // A restock that brings stock back to non-negative clears the flag —
    // it must not persist forever once the discrepancy is actually resolved.
    await invoke([
      buildMessage({ item_id: itemId, counter_id: "counter_a", type: "restock", quantity: 10, client_vector_clock: { counter_a: 2 } }),
    ]);
    item = await getItem(itemId);
    expect(item?.stock).toBe(7);
    expect(item?.stock_anomaly).toBe(false);
  });
});

describe("conflictResolver — US-6 malformed message doesn't block other items", () => {
  it("reports the malformed message as a batch item failure and still processes a valid one", async () => {
    const goodItemId = uniqueItemId();
    await seedItem(goodItemId);

    const malformedRecord: SQSRecord = {
      messageId: "malformed-1",
      receiptHandle: "test-receipt-handle",
      body: JSON.stringify({ shop_id: "demo-shop" }), // missing item_id, type, idempotency_key
      attributes: {} as SQSRecord["attributes"],
      messageAttributes: {},
      md5OfBody: "",
      eventSource: "aws:sqs",
      eventSourceARN: "arn:aws:sqs:local:000000000000:write-queue-test.fifo",
      awsRegion: "local",
    };
    const goodMessage = buildMessage({ item_id: goodItemId, quantity: 5, client_vector_clock: { counter_a: 1 } });

    const response = await handler({ Records: [malformedRecord, toRecord(goodMessage)] });

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "malformed-1" }]);

    const item = await getItem(goodItemId);
    expect(item?.stock).toBe(45);
  });
});

describe("conflictResolver — C-3 a very long offline period with many missed writes", () => {
  it("the current row stays correct after many sequential writes — GET /sync (syncQuery.ts) reads exactly this row, never replays history", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId);

    // Simulates many other counters' changes accumulating while one
    // counter was offline for a long stretch — GET /sync's job (proven in
    // syncQuery.test.ts's mapping tests) is to return this current row
    // as-is; the actual guarantee under test here is that the row itself
    // stays correct no matter how many writes preceded it, since nothing
    // in this pipeline ever needs to "replay" audit_log to reconstruct
    // current state.
    for (let i = 1; i <= 25; i += 1) {
      await invoke([
        buildMessage({ item_id: itemId, counter_id: "counter_a", type: "sale", quantity: 1, client_vector_clock: { counter_a: i } }),
      ]);
    }

    const item = await getItem(itemId);
    expect(item?.stock).toBe(25); // 50 seeded - 25 sales
    expect(await getAuditEntries(itemId)).toHaveLength(25);
  });
});

describe("conflictResolver — idempotent re-invocation", () => {
  it("produces no further state change when redelivered after already being applied", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId);

    const message = buildMessage({ item_id: itemId, quantity: 5, client_vector_clock: { counter_a: 1 } });
    await invoke([message]);

    const afterFirst = await getItem(itemId);
    expect(afterFirst?.stock).toBe(45);
    expect(await getDedupStatus(message.idempotency_key)).toBe("applied");

    // SQS redelivers the exact same message (visibility timeout, retry, etc).
    await invoke([message]);

    const afterSecond = await getItem(itemId);
    expect(afterSecond?.stock).toBe(45); // unchanged — not double-applied
    expect(await getAuditEntries(itemId)).toHaveLength(1); // no second audit entry either
  });
});

describe("conflictResolver — audit entries carry the compared vector clocks (13b, VectorClockExplainer)", () => {
  it("records current_vector_clock and incoming_vector_clock on a clean-apply audit entry", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId, { vector_clock: { counter_a: 1 } });

    const message = buildMessage({
      item_id: itemId,
      quantity: 3,
      client_vector_clock: { counter_a: 2 },
    });
    await invoke([message]);

    const [entry] = await getAuditEntries(itemId);
    const details = entry?.details as Record<string, unknown>;
    expect(details.current_vector_clock).toEqual({ counter_a: 1 });
    expect(details.incoming_vector_clock).toEqual({ counter_a: 2 });
  });

  it("records both clocks on a needs_review (conflict_detected) audit entry", async () => {
    const itemId = uniqueItemId();
    await seedItem(itemId, {
      price: 10,
      vector_clock: { counter_a: 1 },
      field_last_writer: { price: "counter_a" },
    });

    const message = buildMessage({
      item_id: itemId,
      type: "field_update",
      field: "price",
      value: 12,
      quantity: undefined,
      client_vector_clock: { counter_b: 1 },
    });
    await invoke([message]);

    const [entry] = await getAuditEntries(itemId);
    expect(entry?.action).toBe("conflict_detected");
    const details = entry?.details as Record<string, unknown>;
    expect(details.current_vector_clock).toEqual({ counter_a: 1 });
    expect(details.incoming_vector_clock).toEqual({ counter_b: 1 });
  });
});

describe("conflictResolver — Bedrock price-conflict explanation (FR-7, Phase 8)", () => {
  it("attaches the explanation to conflict_candidates once Bedrock responds, on top of the already-flagged conflict", async () => {
    const itemId = uniqueItemId();
    bedrockRespondsWith("Both counters set a different price while offline, about 2 minutes apart.");
    await seedItem(itemId, { price: 10, field_last_writer: { price: "counter_a" }, vector_clock: { counter_a: 1 } });

    await invoke([
      buildMessage({
        item_id: itemId,
        counter_id: "counter_b",
        type: "field_update",
        field: "price",
        value: 12,
        client_vector_clock: { counter_b: 1 },
      }),
    ]);

    // The conflict itself is flagged and both raw values are already
    // stored — this part of the flow never depends on Bedrock at all.
    const item = await getItem(itemId);
    expect(item?.conflict_status).toBe("needs_review");
    expect(item?.conflict_candidates?.values.map((v) => v.value)).toEqual([10, 12]);
    // The mocked Bedrock explanation was attached by the same invocation,
    // after that core state was already committed and pushed.
    expect(item?.conflict_candidates?.bedrock_explanation).toBe(
      "Both counters set a different price while offline, about 2 minutes apart.",
    );

    const calls = bedrockMock.commandCalls(InvokeModelCommand);
    expect(calls).toHaveLength(1);
  });

  it("still flags the conflict correctly, with no explanation attached, when Bedrock fails (edge case G-1)", async () => {
    const itemId = uniqueItemId();
    bedrockMock.on(InvokeModelCommand).rejects(new Error("service unavailable"));
    await seedItem(itemId, { price: 10, field_last_writer: { price: "counter_a" }, vector_clock: { counter_a: 1 } });

    await invoke([
      buildMessage({
        item_id: itemId,
        counter_id: "counter_b",
        type: "field_update",
        field: "price",
        value: 12,
        client_vector_clock: { counter_b: 1 },
      }),
    ]);

    const item = await getItem(itemId);
    expect(item?.conflict_status).toBe("needs_review");
    expect(item?.conflict_candidates?.values.map((v) => v.value)).toEqual([10, 12]);
    expect(item?.conflict_candidates?.bedrock_explanation).toBeUndefined();
  });

  it("never calls Bedrock for a same-field conflict on a field other than price (FR-7's scope)", async () => {
    const itemId = uniqueItemId();
    bedrockRespondsWith("should never be requested");
    await seedItem(itemId, {
      shelf_location: "Aisle 2",
      field_last_writer: { shelf_location: "counter_a" },
      vector_clock: { counter_a: 1 },
    });

    await invoke([
      buildMessage({
        item_id: itemId,
        counter_id: "counter_b",
        type: "field_update",
        field: "shelf_location",
        value: "Aisle 9",
        client_vector_clock: { counter_b: 1 },
      }),
    ]);

    const item = await getItem(itemId);
    expect(item?.conflict_status).toBe("needs_review");
    expect(item?.conflict_candidates?.bedrock_explanation).toBeUndefined();
    expect(bedrockMock.commandCalls(InvokeModelCommand)).toHaveLength(0);
  });

  it("discards a late explanation if the conflict was already resolved before Bedrock responded (edge case F-3)", async () => {
    const itemId = uniqueItemId();
    // While Bedrock is "thinking" (this callback fires from inside
    // explainPriceConflict's await), simulate a human resolving the
    // conflict directly via conflictResolve.ts's own update shape —
    // exactly the race maybeExplainPriceConflict's ConditionExpression
    // guard exists to handle.
    bedrockMock.on(InvokeModelCommand).callsFake(async () => {
      await ddb.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { pk: shopPk(itemId), sk: "CURRENT" },
          UpdateExpression: "SET conflict_status = :none REMOVE conflict_candidates",
          ExpressionAttributeValues: { ":none": "none" },
        }),
      );
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ type: "text", text: "too late" }] })) } as never;
    });
    await seedItem(itemId, { price: 10, field_last_writer: { price: "counter_a" }, vector_clock: { counter_a: 1 } });

    await invoke([
      buildMessage({
        item_id: itemId,
        counter_id: "counter_b",
        type: "field_update",
        field: "price",
        value: 12,
        client_vector_clock: { counter_b: 1 },
      }),
    ]);

    const item = await getItem(itemId);
    expect(item?.conflict_status).toBe("none");
    expect(item?.conflict_candidates).toBeUndefined(); // not resurrected by the late, discarded explanation
  });
});
