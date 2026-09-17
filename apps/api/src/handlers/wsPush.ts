import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { WsPushMessage } from "@stocksync/core";
import { ddb } from "../lib/dynamo";
import { createLogger } from "../lib/logger";

const logger = createLogger("ws-push");

// The shared wire shape from packages/core, under the name this module's
// existing callers (conflictResolver.ts) already import.
export type WsPushPayload = WsPushMessage;

let managementClient: ApiGatewayManagementApiClient | undefined;
function getManagementClient(): ApiGatewayManagementApiClient {
  managementClient ??= new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_CALLBACK_URL });
  return managementClient;
}

/**
 * Pushes `payload` to every WebSocket connection watching `shopId`. Never
 * throws for an individual dead connection (edge case D-1: cleans up the
 * stale ws_connections row and moves on) or a slow one (edge case D-3:
 * pushes are parallelized via Promise.allSettled, not sequential).
 */
export async function pushToShop(shopId: string, payload: WsPushPayload): Promise<void> {
  const connectionsResult = await ddb.send(
    new QueryCommand({
      TableName: process.env.WS_CONNECTIONS_TABLE_NAME,
      IndexName: "ShopConnectionsIndex",
      KeyConditionExpression: "shop_id = :shopId",
      ExpressionAttributeValues: { ":shopId": shopId },
    }),
  );

  const connections = connectionsResult.Items ?? [];
  if (connections.length === 0) return;

  const client = getManagementClient();
  const data = Buffer.from(JSON.stringify(payload));

  await Promise.allSettled(
    connections.map(async (connection) => {
      const connectionId = connection.connection_id as string;
      try {
        await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
      } catch (error) {
        if (error instanceof GoneException) {
          logger.info("stale WebSocket connection, cleaning up", { connectionId });
          await ddb.send(
            new DeleteCommand({
              TableName: process.env.WS_CONNECTIONS_TABLE_NAME,
              Key: { connection_id: connectionId },
            }),
          );
          return;
        }
        logger.error("failed to push to a WebSocket connection", { connectionId, error });
      }
    }),
  );
}
