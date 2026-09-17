/**
 * A local stand-in for API Gateway + Lambda + SQS, used only for Phase 7's
 * Playwright suite and manual dev iteration while real AWS deployment is
 * blocked (see docs/phases/phase-7-integration-demo-scenario.md). It
 * imports and calls the real handler functions directly — zero business
 * logic is reimplemented here, only the AWS transport layer is swapped
 * for a local one:
 *   - REST (POST /transactions, GET /sync, GET /audit/:item_id) → Express,
 *     adapting req/res to the same event/result shapes API Gateway v2 uses.
 *   - The SQS write queue → an in-memory FIFO per item_id, processed by a
 *     single always-sequential worker per item. This preserves exactly the
 *     property that matters (no two writes for the same item ever race
 *     each other — the same guarantee MessageGroupId gives in production),
 *     without needing a real or emulated SQS broker.
 *   - The WebSocket API → a `ws` server for $connect/$disconnect, plus a
 *     tiny HTTP shim reproducing the ApiGatewayManagementApi's
 *     `POST /@connections/{connectionId}` contract, so wsPush.ts's real,
 *     unmodified code can push to it.
 *
 * Never imported by any deployed Lambda handler — NodejsFunction bundles
 * are built per-entry-file via esbuild, so nothing under src/local ever
 * ships.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2,
  SQSEvent,
  SQSRecord,
} from "aws-lambda";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { createTableIfNotExists, startDynamoDbLocal } from "../../test/helpers/dynamoDbLocal";
import { localTableDefinitions } from "../lib/localTables";

const DYNAMODB_PORT = Number(process.env.LOCAL_DYNAMODB_PORT ?? 8200);
const HTTP_PORT = Number(process.env.LOCAL_API_PORT ?? 4000);
const WS_PORT = Number(process.env.LOCAL_WS_PORT ?? 4001);
const MANAGEMENT_PORT = Number(process.env.LOCAL_WS_MANAGEMENT_PORT ?? 4002);

const TABLE_NAMES = {
  inventoryRecords: "inventory_records_local",
  auditLog: "audit_log_local",
  writeDedup: "write_dedup_local",
  wsConnections: "ws_connections_local",
};

process.env.DYNAMODB_ENDPOINT = `http://localhost:${DYNAMODB_PORT}`;
process.env.INVENTORY_RECORDS_TABLE_NAME = TABLE_NAMES.inventoryRecords;
process.env.AUDIT_LOG_TABLE_NAME = TABLE_NAMES.auditLog;
process.env.WRITE_DEDUP_TABLE_NAME = TABLE_NAMES.writeDedup;
process.env.WS_CONNECTIONS_TABLE_NAME = TABLE_NAMES.wsConnections;
process.env.WEBSOCKET_CALLBACK_URL = `http://localhost:${MANAGEMENT_PORT}`;

async function main(): Promise<void> {
  await startDynamoDbLocal(DYNAMODB_PORT);

  const { ddb } = await import("../lib/dynamo");
  for (const command of localTableDefinitions(TABLE_NAMES)) {
    await createTableIfNotExists(ddb, command);
  }

  const { handler: writeIntakeHandler } = await import("../handlers/writeIntake");
  const { handler: syncQueryHandler } = await import("../handlers/syncQuery");
  const { handler: auditQueryHandler } = await import("../handlers/auditQuery");
  const { handler: conflictResolverHandler } = await import("../handlers/conflictResolver");
  const { handler: conflictResolveHandler } = await import("../handlers/conflictResolve");
  const { handler: wsConnectHandler } = await import("../handlers/wsConnect");
  const { handler: wsDisconnectHandler } = await import("../handlers/wsDisconnect");
  const { sqs } = await import("../lib/sqs");

  // ---- WebSocket: $connect / $disconnect + the raw connections used by
  // the management-API push shim below. ----
  const connections = new Map<string, WebSocket>();

  const wsServer = new WebSocketServer({ port: WS_PORT });
  wsServer.on("connection", (socket, request: IncomingMessage) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const connectionId = randomUUID();
    connections.set(connectionId, socket);

    void wsConnectHandler({
      requestContext: { connectionId, routeKey: "$connect" },
      queryStringParameters: {
        shop_id: url.searchParams.get("shop_id") ?? undefined,
        counter_id: url.searchParams.get("counter_id") ?? undefined,
      },
    } as unknown as APIGatewayProxyWebsocketEventV2);

    socket.on("close", () => {
      connections.delete(connectionId);
      void wsDisconnectHandler({
        requestContext: { connectionId, routeKey: "$disconnect" },
      } as unknown as APIGatewayProxyWebsocketEventV2);
    });
  });

  // ---- Management-API push shim: reproduces enough of
  // ApiGatewayManagementApiClient's POST /@connections/{id} contract for
  // wsPush.ts to work completely unmodified against a local endpoint. ----
  const managementServer = createServer((req, res) => {
    const match = req.url?.match(/^\/@connections\/([^/]+)$/);
    if (req.method !== "POST" || !match) {
      res.writeHead(404);
      res.end();
      return;
    }
    const socket = connections.get(decodeURIComponent(match[1]));
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      res.writeHead(410); // maps to the real API's GoneException for a stale connection
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      // Sent as text, not the raw Buffer: `ws` frames a Buffer as a binary
      // message, which the browser delivers as a Blob — the client only
      // handles string frames (see useWebSocketSync), matching what a real
      // browser WebSocket receives from API Gateway's text-based pushes.
      socket.send(Buffer.concat(chunks).toString("utf-8"));
      res.writeHead(200);
      res.end();
    });
  });
  managementServer.listen(MANAGEMENT_PORT);

  // ---- In-memory per-item FIFO write queue: one always-sequential worker
  // per item_id, mirroring the real queue's MessageGroupId serialization
  // without needing a real or emulated SQS broker. ----
  const queues = new Map<string, string[]>();
  const draining = new Set<string>();

  function synthesizeSqsRecord(body: string): SQSRecord {
    return {
      messageId: randomUUID(),
      receiptHandle: randomUUID(),
      body,
      attributes: {
        ApproximateReceiveCount: "1",
        SentTimestamp: String(Date.now()),
        SenderId: "local",
        ApproximateFirstReceiveTimestamp: String(Date.now()),
      } as SQSRecord["attributes"],
      messageAttributes: {},
      md5OfBody: "",
      eventSource: "aws:sqs",
      eventSourceARN: "arn:aws:sqs:local:000000000000:local-write-queue.fifo",
      awsRegion: "local",
    };
  }

  async function drain(itemId: string): Promise<void> {
    if (draining.has(itemId)) return;
    draining.add(itemId);
    try {
      const queue = queues.get(itemId);
      while (queue && queue.length > 0) {
        const body = queue.shift();
        if (body === undefined) break;
        const event: SQSEvent = { Records: [synthesizeSqsRecord(body)] };
        await conflictResolverHandler(event);
      }
    } finally {
      draining.delete(itemId);
    }
  }

  // Intercepts writeIntake.ts's real SendMessageCommand call and routes it
  // into the in-memory queue instead of a real SQS API call — write-intake
  // itself is completely unaware this is happening; its validation and
  // idempotency logic runs exactly as it does in production.
  const originalSend = sqs.send.bind(sqs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (sqs as any).send = async (command: unknown) => {
    if (command instanceof SendMessageCommand) {
      const { MessageBody, MessageGroupId } = command.input;
      if (MessageBody && MessageGroupId) {
        const queue = queues.get(MessageGroupId) ?? [];
        queue.push(MessageBody);
        queues.set(MessageGroupId, queue);
        void drain(MessageGroupId);
      }
      return { MessageId: randomUUID() };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return originalSend(command as any);
  };

  // ---- REST API ----
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "content-type, x-api-key");
    next();
  });

  function send(res: express.Response, result: APIGatewayProxyResultV2): void {
    const { statusCode, body } = result as { statusCode: number; body: string };
    res.status(statusCode).type("application/json").send(body);
  }

  app.post("/transactions", async (req, res) => {
    const event = { body: JSON.stringify(req.body) } as APIGatewayProxyEventV2;
    send(res, await writeIntakeHandler(event));
  });

  app.get("/sync", async (req, res) => {
    const event = { queryStringParameters: req.query } as unknown as APIGatewayProxyEventV2;
    send(res, await syncQueryHandler(event));
  });

  app.get("/audit/:item_id", async (req, res) => {
    const event = {
      pathParameters: { item_id: req.params.item_id },
      queryStringParameters: req.query,
    } as unknown as APIGatewayProxyEventV2;
    send(res, await auditQueryHandler(event));
  });

  app.post("/conflicts/:item_id/resolve", async (req, res) => {
    const event = {
      pathParameters: { item_id: req.params.item_id },
      body: JSON.stringify(req.body),
    } as unknown as APIGatewayProxyEventV2;
    send(res, await conflictResolveHandler(event));
  });

  app.listen(HTTP_PORT, () => {
    console.log(`[local-server] REST API listening on http://localhost:${HTTP_PORT}`);
    console.log(`[local-server] WebSocket listening on ws://localhost:${WS_PORT}`);
    console.log(`[local-server] DynamoDB Local on http://localhost:${DYNAMODB_PORT}`);
  });
}

main().catch((error: unknown) => {
  console.error("[local-server] failed to start:", error);
  process.exit(1);
});
