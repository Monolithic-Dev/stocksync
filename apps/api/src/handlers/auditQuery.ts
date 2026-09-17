import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { AuditHistoryEntry } from "@stocksync/core";
import { ddb } from "../lib/dynamo";
import { inventoryRecordKey } from "../lib/inventoryRecord";

function invalidPayload(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, body: JSON.stringify({ error: "invalid_payload", message }) };
}

/** audit_log's sk is `<ISO timestamp>#<event_id>` (03-DATABASE-SCHEMA.md §4) — the timestamp is never stored as its own attribute, only encoded as the sk's prefix. */
function timestampFromSortKey(sk: string): string {
  const separatorIndex = sk.indexOf("#");
  return separatorIndex === -1 ? sk : sk.slice(0, separatorIndex);
}

/**
 * GET /audit/{item_id}?shop_id=X (04-API-SPEC.md §1) — powers the demo's
 * proof-of-correctness screen. audit_log's key design (pk = the item,
 * sk = a chronologically-sortable timestamp+event_id) means the full
 * history for an item is exactly one Query, already in chronological
 * order — no client-side sorting needed.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const itemId = event.pathParameters?.item_id;
  const shopId = event.queryStringParameters?.shop_id;

  if (!itemId) return invalidPayload("item_id is required");
  if (!shopId) return invalidPayload("shop_id is required");

  const { pk } = inventoryRecordKey(shopId, itemId);

  const result = await ddb.send(
    new QueryCommand({
      TableName: process.env.AUDIT_LOG_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk },
    }),
  );

  const history: AuditHistoryEntry[] = (result.Items ?? []).map((item) => ({
    timestamp: timestampFromSortKey(item.sk as string),
    counter_id: item.counter_id as string,
    action: item.action as string,
    resolution_strategy: item.resolution_strategy as string | undefined,
    details: item.details,
  }));

  return { statusCode: 200, body: JSON.stringify({ item_id: itemId, history }) };
}
