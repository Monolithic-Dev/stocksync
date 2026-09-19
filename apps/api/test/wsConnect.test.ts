import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import dynalite from "dynalite";
import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PORT = 8131;
const WS_TABLE = "ws_connections_test";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.WS_CONNECTIONS_TABLE_NAME = WS_TABLE;

let dynaliteServer: ReturnType<typeof dynalite>;
let ddb: typeof import("../src/lib/dynamo").ddb;

const verifyMock = vi.fn();
vi.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: { create: vi.fn().mockImplementation(() => ({ verify: verifyMock })) },
}));

function connectEvent(query: Record<string, string>, connectionId = "conn-1"): APIGatewayProxyWebsocketEventV2 {
  return {
    requestContext: { connectionId, routeKey: "$connect" },
    queryStringParameters: query,
  } as unknown as APIGatewayProxyWebsocketEventV2;
}

async function connect(
  handler: (event: APIGatewayProxyWebsocketEventV2) => Promise<unknown>,
  query: Record<string, string>,
  connectionId: string,
): Promise<{ statusCode: number; body: string }> {
  return (await handler(connectEvent(query, connectionId))) as { statusCode: number; body: string };
}

beforeAll(async () => {
  dynaliteServer = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    dynaliteServer.listen(PORT, (err?: Error) => (err ? reject(err) : resolve()));
  });
  ({ ddb } = await import("../src/lib/dynamo"));
  await ddb.send(
    new CreateTableCommand({
      TableName: WS_TABLE,
      AttributeDefinitions: [{ AttributeName: "connection_id", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "connection_id", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => dynaliteServer.close(() => resolve()));
});

afterEach(() => {
  delete process.env.USER_POOL_ID;
  delete process.env.USER_POOL_CLIENT_ID;
});

describe("wsConnect — no USER_POOL_ID configured (local dev)", () => {
  it("accepts the connection using the query string's shop_id directly, no token required", async () => {
    const { handler } = await import("../src/handlers/wsConnect");
    const result = await connect(handler, { shop_id: "demo-shop", counter_id: "counter_a" }, "conn-local");
    expect(result.statusCode).toBe(200);

    const stored = await ddb.send(new GetCommand({ TableName: WS_TABLE, Key: { connection_id: "conn-local" } }));
    expect(stored.Item?.shop_id).toBe("demo-shop");
  });
});

describe("wsConnect — USER_POOL_ID configured (production)", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    process.env.USER_POOL_ID = "pool-1";
    process.env.USER_POOL_CLIENT_ID = "client-1";
    vi.resetModules();
  });

  it("rejects a connection with no token", async () => {
    const { handler } = await import("../src/handlers/wsConnect");
    const result = await connect(handler, { shop_id: "demo-shop", counter_id: "counter_a" }, "conn-no-token");
    expect(result.statusCode).toBe(401);
  });

  it("rejects an invalid token", async () => {
    verifyMock.mockRejectedValue(new Error("bad signature"));
    const { handler } = await import("../src/handlers/wsConnect");
    const result = await connect(handler, { token: "garbage", counter_id: "counter_a" }, "conn-bad-token");
    expect(result.statusCode).toBe(401);
  });

  it("rejects a validly-signed token missing custom:shop_id", async () => {
    verifyMock.mockResolvedValue({ sub: "u1" });
    const { handler } = await import("../src/handlers/wsConnect");
    const result = await connect(handler, { token: "good-token", counter_id: "counter_a" }, "conn-no-shop");
    expect(result.statusCode).toBe(401);
  });

  it("accepts a valid token and uses its shop_id, not the query string's", async () => {
    verifyMock.mockResolvedValue({ sub: "u1", "custom:shop_id": "real-shop" });
    const { handler } = await import("../src/handlers/wsConnect");
    const result = await connect(
      handler,
      { token: "good-token", shop_id: "attacker-shop", counter_id: "counter_a" },
      "conn-good",
    );
    expect(result.statusCode).toBe(200);

    const stored = await ddb.send(new GetCommand({ TableName: WS_TABLE, Key: { connection_id: "conn-good" } }));
    expect(stored.Item?.shop_id).toBe("real-shop");
  });
});
