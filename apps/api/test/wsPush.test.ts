import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient, type AwsStub } from "aws-sdk-client-mock";
import dynalite from "dynalite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PORT = 8125;
const WS_CONNECTIONS_TABLE = "ws_connections_test";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.WS_CONNECTIONS_TABLE_NAME = WS_CONNECTIONS_TABLE;
process.env.WEBSOCKET_CALLBACK_URL = "https://ws.local.test/prod";

let dynaliteServer: ReturnType<typeof dynalite>;
let ddb: typeof import("../src/lib/dynamo").ddb;
let pushToShop: typeof import("../src/handlers/wsPush").pushToShop;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let apiGwMock: AwsStub<any, any, any>;

beforeAll(async () => {
  dynaliteServer = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    dynaliteServer.listen(PORT, (err?: Error) => (err ? reject(err) : resolve()));
  });

  ({ ddb } = await import("../src/lib/dynamo"));
  ({ pushToShop } = await import("../src/handlers/wsPush"));

  apiGwMock = mockClient(ApiGatewayManagementApiClient);

  await ddb.send(
    new CreateTableCommand({
      TableName: WS_CONNECTIONS_TABLE,
      AttributeDefinitions: [
        { AttributeName: "connection_id", AttributeType: "S" },
        { AttributeName: "shop_id", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "connection_id", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "ShopConnectionsIndex",
          KeySchema: [{ AttributeName: "shop_id", KeyType: "HASH" }],
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

beforeEach(() => {
  apiGwMock.reset();
});

async function seedConnection(connectionId: string, shopId: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: WS_CONNECTIONS_TABLE,
      Item: { connection_id: connectionId, shop_id: shopId, counter_id: "counter_a", connected_at: new Date().toISOString() },
    }),
  );
}

describe("pushToShop", () => {
  it("pushes the payload to every connection watching the shop, including two tabs for the same counter (edge case D-2)", async () => {
    apiGwMock.on(PostToConnectionCommand).resolves({});
    // Both connections share counter_id "counter_a" (seedConnection's
    // fixed value) — proving connections are addressed by connection_id,
    // not deduplicated or collapsed by counter_id, so two browser tabs for
    // one logical counter both still receive the push independently.
    await seedConnection("conn-1", "shop-push-1");
    await seedConnection("conn-2", "shop-push-1");
    await seedConnection("conn-3", "shop-other"); // different shop — must not receive this push

    await pushToShop("shop-push-1", { type: "record_updated", item_id: "parle-g", stock: 40, vector_clock: {} });

    const calls = apiGwMock.commandCalls(PostToConnectionCommand);
    expect(calls).toHaveLength(2);
    const targetedConnections = calls.map((call) => call.args[0].input.ConnectionId).sort();
    expect(targetedConnections).toEqual(["conn-1", "conn-2"]);
  });

  it("does nothing when no connections are watching the shop (never constructs a live push)", async () => {
    await pushToShop("shop-with-no-connections", { type: "record_updated", item_id: "parle-g", stock: 40, vector_clock: {} });
    expect(apiGwMock.commandCalls(PostToConnectionCommand)).toHaveLength(0);
  });

  it("cleans up a stale connection on GoneException and still pushes to the rest (edge case D-1)", async () => {
    await seedConnection("conn-stale", "shop-push-2");
    await seedConnection("conn-live", "shop-push-2");

    apiGwMock.on(PostToConnectionCommand).callsFake((input) => {
      if (input.ConnectionId === "conn-stale") {
        throw new GoneException({ message: "Gone", $metadata: {} });
      }
      return {};
    });

    await pushToShop("shop-push-2", { type: "record_updated", item_id: "parle-g", stock: 40, vector_clock: {} });

    // The dead connection's row is removed...
    const staleRow = await ddb.send(new GetCommand({ TableName: WS_CONNECTIONS_TABLE, Key: { connection_id: "conn-stale" } }));
    expect(staleRow.Item).toBeUndefined();

    // ...but the live connection still got the push, unaffected by the other's failure.
    const liveRow = await ddb.send(new GetCommand({ TableName: WS_CONNECTIONS_TABLE, Key: { connection_id: "conn-live" } }));
    expect(liveRow.Item).toBeDefined();
    const calls = apiGwMock.commandCalls(PostToConnectionCommand);
    expect(calls.some((call) => call.args[0].input.ConnectionId === "conn-live")).toBe(true);
  });
});
