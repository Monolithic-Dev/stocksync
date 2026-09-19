import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { SyncItem } from "@stocksync/core";
import { ddb } from "../lib/dynamo";
import { getAuthContext } from "../lib/authContext";
import type { InventoryRecordItem } from "../lib/inventoryRecord";

function invalidPayload(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, body: JSON.stringify({ error: "invalid_payload", message }) };
}

function toSyncItem(item: InventoryRecordItem): SyncItem {
  return {
    item_id: item.item_id,
    name: item.name,
    stock: item.stock,
    price: item.price,
    shelf_location: item.shelf_location,
    supplier: item.supplier,
    expiry_date: item.expiry_date,
    field_last_writer: item.field_last_writer ?? {},
    conflict_status: item.conflict_status,
    // Not shown in 04-API-SPEC.md's example (which only illustrates a
    // clean item), but the underlying data model already carries this —
    // omitting it here would force a reconnecting client to wait for a
    // WebSocket push it may have already missed before it can render an
    // already-flagged conflict.
    conflict_candidates: item.conflict_status === "needs_review" ? item.conflict_candidates : undefined,
    // edge case B-1: a real signal, not raw-data-only — must reach the
    // client so it can be shown, not just recorded in DynamoDB.
    stock_anomaly: item.stock_anomaly,
    // Required for the client to build a correct next client_vector_clock
    // — see SyncItem.vector_clock's doc comment in packages/core.
    vector_clock: item.vector_clock ?? {},
  };
}

/**
 * GET /sync?shop_id=X&counter_id=Y — the reconnect/initial-load read path
 * (04-API-SPEC.md §1). Deliberately a "fetch current state" query, not a
 * "replay every event" one: per edge case C-3, this is what makes a very
 * long offline period resolve correctly regardless of how many writes it
 * missed — the client always converges by reading the current row, never
 * by trying to re-derive it from history.
 *
 * `counter_id` is accepted (and required, matching the documented query
 * shape) but not used to filter results — every counter for a shop sees
 * the same fully-reconciled state; it exists in the query string for
 * symmetry with the rest of the API and potential future per-counter
 * personalization, not because the response differs by counter today.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const shopId = getAuthContext(event)?.shopId ?? event.queryStringParameters?.shop_id;
  const counterId = event.queryStringParameters?.counter_id;

  if (!shopId) return invalidPayload("shop_id is required");
  if (!counterId) return invalidPayload("counter_id is required");

  const result = await ddb.send(
    new QueryCommand({
      TableName: process.env.INVENTORY_RECORDS_TABLE_NAME,
      IndexName: "ShopConflictIndex",
      KeyConditionExpression: "shop_id = :shopId",
      ExpressionAttributeValues: { ":shopId": shopId },
    }),
  );

  const items = ((result.Items ?? []) as InventoryRecordItem[]).map(toSyncItem);

  return { statusCode: 200, body: JSON.stringify({ items }) };
}
