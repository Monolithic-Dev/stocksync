import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo";
import { createLogger } from "../lib/logger";
import { inventoryRecordKey, type InventoryRecordItem } from "../lib/inventoryRecord";
import { pushToShop } from "./wsPush";

const logger = createLogger("conflict-resolve");

interface RequestBody {
  shop_id?: unknown;
  field?: unknown;
  chosen_value?: unknown;
  resolved_by?: unknown;
}

function invalidPayload(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, body: JSON.stringify({ error: "invalid_payload", message }) };
}

function notFound(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 404, body: JSON.stringify({ error: "not_found", message }) };
}

function alreadyResolved(): APIGatewayProxyResultV2 {
  return {
    statusCode: 409,
    body: JSON.stringify({
      error: "conflict_already_resolved",
      message: "this item is no longer needs_review for the given field — someone else may have already resolved it",
    }),
  };
}

function requireNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * POST /conflicts/{item_id}/resolve (04-API-SPEC.md §1) — a human picks
 * one of the two candidate values for a flagged conflict. Deliberately a
 * simple, non-concurrent write (only one person resolves a given
 * conflict; see the PRD's open question on this), not routed through the
 * vector-clock/FIFO write pipeline — it's an administrative decision on
 * an already-known pair of values, not a new concurrent write.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const itemId = event.pathParameters?.item_id;
  if (!itemId) return invalidPayload("item_id is required");

  let body: RequestBody;
  try {
    body = JSON.parse(event.body ?? "{}") as RequestBody;
  } catch {
    return invalidPayload("request body must be valid JSON");
  }

  const shopId = requireNonEmptyString(body.shop_id);
  const field = requireNonEmptyString(body.field);
  const resolvedBy = requireNonEmptyString(body.resolved_by);
  if (!shopId) return invalidPayload("shop_id is required");
  if (!field) return invalidPayload("field is required");
  if (!resolvedBy) return invalidPayload("resolved_by is required");
  if (!("chosen_value" in body) || body.chosen_value === undefined) {
    return invalidPayload("chosen_value is required");
  }
  const chosenValue = body.chosen_value;

  const { pk, sk } = inventoryRecordKey(shopId, itemId);
  const existing = await ddb.send(new GetCommand({ TableName: process.env.INVENTORY_RECORDS_TABLE_NAME, Key: { pk, sk } }));
  const item = existing.Item as InventoryRecordItem | undefined;
  if (!item) return notFound(`no item ${itemId} for shop ${shopId}`);

  if (item.conflict_status !== "needs_review" || item.conflict_candidates?.field !== field) {
    return alreadyResolved();
  }

  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.INVENTORY_RECORDS_TABLE_NAME,
        Key: { pk, sk },
        // Re-checked at write time, not just at the read above — a second
        // person resolving concurrently loses this race and gets 409,
        // never a silently-clobbered value (04-API-SPEC.md §4).
        UpdateExpression: "SET #field = :value, #flw.#field = :resolvedBy, #status = :none, #updatedAt = :now REMOVE #cc",
        // #candidateField is the *literal* "field" attribute name inside
        // conflict_candidates (its value happens to be the same string as
        // the `field` variable, e.g. "price" — but as a DynamoDB path
        // component it's a different name and needs its own alias; reusing
        // #field here would resolve to conflict_candidates.price, which
        // doesn't exist).
        ConditionExpression: "#status = :needsReview AND #cc.#candidateField = :field",
        ExpressionAttributeNames: {
          "#field": field,
          "#flw": "field_last_writer",
          "#status": "conflict_status",
          "#updatedAt": "updated_at",
          "#cc": "conflict_candidates",
          "#candidateField": "field",
        },
        ExpressionAttributeValues: {
          ":value": chosenValue,
          ":resolvedBy": resolvedBy,
          ":none": "none",
          ":now": now,
          ":needsReview": "needs_review",
          ":field": field,
        },
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return alreadyResolved();
    }
    throw error;
  }

  await ddb.send(
    new PutCommand({
      TableName: process.env.AUDIT_LOG_TABLE_NAME,
      Item: {
        pk,
        sk: `${now}#${randomUUID()}`,
        counter_id: resolvedBy,
        action: "conflict_resolved_manual",
        details: { field, chosen_value: chosenValue },
      },
    }),
  );

  // Additive, never a dependency of correctness — the commit above has
  // already succeeded regardless of whether this fails. Without it, the
  // other counter's panel would only clear on its next GET /sync.
  await pushToShop(shopId, {
    type: "record_updated",
    item_id: itemId,
    ...(field === "price" ? { price: chosenValue as number } : {}),
    ...(field === "shelf_location" ? { shelf_location: chosenValue as string } : {}),
    field_last_writer: { ...item.field_last_writer, [field]: resolvedBy },
    vector_clock: item.vector_clock,
  }).catch((error) => {
    logger.error("wsPush failed after a successful conflict resolution", { error, item_id: itemId });
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ item_id: itemId, field, status: "resolved", value: chosenValue }),
  };
}
