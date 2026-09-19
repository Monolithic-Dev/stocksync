import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { ddb } from "../lib/dynamo";
import { createLogger } from "../lib/logger";

const logger = createLogger("ws-connect");

// WebSocket routes on an API Gateway v2 WebSocket API don't get the same
// native JWT authorizer HTTP API routes do (Auth.ts's HttpJwtAuthorizer is
// HTTP-API-only) — the ID token is verified here instead, from a `token`
// query param (WebSocket handshakes can't carry a custom header from a
// browser's native WebSocket client). Verifier is built once per cold
// start, same singleton-client pattern as apps/api/src/lib/dynamo.ts.
//
// Unset USER_POOL_ID (local dev — src/local/server.ts has no Cognito
// integration) skips verification entirely, same fallback pattern
// authContext.ts uses for every REST handler.
const USER_POOL_ID = process.env.USER_POOL_ID;
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID;
const verifier =
  USER_POOL_ID && USER_POOL_CLIENT_ID
    ? CognitoJwtVerifier.create({ userPoolId: USER_POOL_ID, tokenUse: "id", clientId: USER_POOL_CLIENT_ID })
    : undefined;

/** $connect: writes { connection_id, shop_id, counter_id, connected_at } per 04-API-SPEC.md §2's wss://...?shop_id=X&counter_id=Y. */
export async function handler(event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;
  const counterId = event.queryStringParameters?.counter_id;

  let shopId = event.queryStringParameters?.shop_id;

  if (verifier) {
    const token = event.queryStringParameters?.token;
    if (!token) {
      logger.warn("rejected $connect missing token", { connectionId });
      return { statusCode: 401, body: "token query parameter is required" };
    }
    try {
      const payload = await verifier.verify(token);
      const claimedShopId = payload["custom:shop_id"];
      if (typeof claimedShopId !== "string" || !claimedShopId) {
        logger.warn("rejected $connect token missing custom:shop_id", { connectionId });
        return { statusCode: 401, body: "token is missing custom:shop_id" };
      }
      // The verified token's shop_id is authoritative, same pattern as
      // authContext.ts for every REST route — never trust the query
      // param's shop_id once a token is required.
      shopId = claimedShopId;
    } catch (error) {
      logger.warn("rejected $connect invalid token", { connectionId, error });
      return { statusCode: 401, body: "invalid token" };
    }
  }

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
