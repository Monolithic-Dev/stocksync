import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo";
import { createLogger } from "../lib/logger";

const logger = createLogger("ws-connect");

/** $connect: writes { connection_id, shop_id, counter_id, connected_at } per 04-API-SPEC.md §2's wss://...?shop_id=X&counter_id=Y. */
export async function handler(event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;
  const shopId = event.queryStringParameters?.shop_id;
  const counterId = event.queryStringParameters?.counter_id;

  if (!shopId || !counterId) {
    logger.warn("rejected $connect missing shop_id/counter_id", { connectionId });
    return { statusCode: 400, body: "shop_id and counter_id query parameters are required" };
  }

  await ddb.send(
    new PutCommand({
      TableName: process.env.WS_CONNECTIONS_TABLE_NAME,
      Item: {
        connection_id: connectionId,
        shop_id: shopId,
        counter_id: counterId,
        connected_at: new Date().toISOString(),
      },
    }),
  );

  // Traceable alongside conflictResolver.ts's push logs (edge case D-1/D-2:
  // confirming a specific connection actually registered, and which
  // counter/shop it belongs to, without needing to query ws_connections
  // directly).
  logger.info("connection registered", { connectionId, shopId, counterId });

  return { statusCode: 200, body: "connected" };
}
