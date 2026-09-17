import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo";
import { createLogger } from "../lib/logger";

const logger = createLogger("ws-disconnect");

/** $disconnect: removes the connection's row directly by connection_id. */
export async function handler(event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;

  await ddb.send(
    new DeleteCommand({
      TableName: process.env.WS_CONNECTIONS_TABLE_NAME,
      Key: { connection_id: connectionId },
    }),
  );

  logger.info("connection removed", { connectionId });

  return { statusCode: 200, body: "disconnected" };
}
