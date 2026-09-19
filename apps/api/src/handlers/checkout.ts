import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { TransactionInput } from "@stocksync/core";
import { ddb } from "../lib/dynamo";
import { getAuthContext } from "../lib/authContext";
import { handler as writeIntakeHandler } from "./writeIntake";

interface LineItemInput {
  product_id?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
}

interface RequestBody {
  shop_id?: unknown;
  counter_id?: unknown;
  order_id?: unknown;
  line_items?: unknown;
}

interface ValidatedLineItem {
  product_id: string;
  quantity: number;
  unit_price: number;
}

function invalidPayload(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, body: JSON.stringify({ error: "invalid_payload", message }) };
}

function requireNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validateLineItem(raw: unknown, index: number): ValidatedLineItem {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`line_items[${index}] must be an object`);
  }
  const entry = raw as LineItemInput;
  const productId = requireNonEmptyString(entry.product_id);
  if (!productId) throw new Error(`line_items[${index}].product_id is required`);
  if (typeof entry.quantity !== "number" || !(entry.quantity > 0)) {
    throw new Error(`line_items[${index}].quantity must be a positive number`);
  }
  if (typeof entry.unit_price !== "number" || entry.unit_price < 0) {
    throw new Error(`line_items[${index}].unit_price must be a non-negative number`);
  }
  return { product_id: productId, quantity: entry.quantity, unit_price: entry.unit_price };
}

/**
 * POST /checkout (19b, 04-API-SPEC.md §5.2) — a thin translation layer,
 * not a parallel write system. Every line item becomes a standard
 * `sale` transaction submitted through writeIntake's real, unmodified
 * handler (called directly, in-process — the same pattern the local dev
 * server uses to wire handlers together without a network hop), so
 * every correctness guarantee (idempotency, per-item FIFO ordering,
 * conflict resolution) applies to a checkout exactly like it does to a
 * manual sale. The only new state this handler owns is the `orders`
 * table's receipt/analytics summary row — it is never a second source
 * of truth for stock.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  let body: RequestBody;
  try {
    body = JSON.parse(event.body ?? "{}") as RequestBody;
  } catch {
    return invalidPayload("request body must be valid JSON");
  }

  // The verified JWT's shop_id wins over whatever the client sent (same
  // pattern as writeIntake.ts/crudTable.ts) — falls back to body.shop_id
  // only for local dev, which has no Cognito integration.
  const shopId = getAuthContext(event)?.shopId ?? requireNonEmptyString(body.shop_id);
  const counterId = requireNonEmptyString(body.counter_id);
  if (!shopId) return invalidPayload("shop_id is required");
  if (!counterId) return invalidPayload("counter_id is required");

  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    return invalidPayload("line_items must be a non-empty array");
  }

  let lineItems: ValidatedLineItem[];
  try {
    lineItems = body.line_items.map(validateLineItem);
  } catch (error) {
    return invalidPayload((error as Error).message);
  }

  const orderId = requireNonEmptyString(body.order_id) ?? randomUUID();

  const transactions: TransactionInput[] = lineItems.map((lineItem) => ({
    // Deterministic, not random: a client retrying the same checkout
    // (e.g. after a dropped response) resubmits the same order_id, which
    // reproduces the exact same idempotency keys — write-intake's
    // existing dedup then makes the retry a safe no-op instead of
    // double-selling every line item again.
    idempotency_key: `checkout:${orderId}:${lineItem.product_id}`,
    item_id: lineItem.product_id,
    type: "sale",
    quantity: lineItem.quantity,
    client_timestamp: new Date().toISOString(),
    order_id: orderId,
  }));

  const intakeEvent = {
    body: JSON.stringify({ shop_id: shopId, counter_id: counterId, transactions }),
  } as APIGatewayProxyEventV2;
  const intakeResult = (await writeIntakeHandler(intakeEvent)) as { statusCode: number; body: string };
  if (intakeResult.statusCode !== 200) return intakeResult;

  const totalAmount = lineItems.reduce((sum, lineItem) => sum + lineItem.quantity * lineItem.unit_price, 0);
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: process.env.ORDERS_TABLE_NAME,
      Item: {
        pk: `SHOP#${shopId}`,
        sk: `ORDER#${orderId}`,
        shop_id: shopId,
        order_id: orderId,
        counter_id: counterId,
        line_items: lineItems,
        total_amount: totalAmount,
        status: "completed",
        created_at: now,
      },
    }),
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ order_id: orderId, total_amount: totalAmount, status: "completed" }),
  };
}
