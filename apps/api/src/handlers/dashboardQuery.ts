import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo";
import { canViewDashboard, getAuthContext } from "../lib/authContext";
import type { InventoryRecordItem } from "../lib/inventoryRecord";

const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface OrderItem {
  order_id: string;
  total_amount: number;
  created_at: string;
}

function invalidPayload(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, body: JSON.stringify({ error: "invalid_payload", message }) };
}

function forbidden(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 403, body: JSON.stringify({ error: "forbidden", message }) };
}

async function fetchInventoryItems(shopId: string): Promise<InventoryRecordItem[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: process.env.INVENTORY_RECORDS_TABLE_NAME,
      IndexName: "ShopConflictIndex",
      KeyConditionExpression: "shop_id = :shopId",
      ExpressionAttributeValues: { ":shopId": shopId },
    }),
  );
  return (result.Items ?? []) as InventoryRecordItem[];
}

async function fetchOrders(shopId: string): Promise<OrderItem[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: process.env.ORDERS_TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
      ExpressionAttributeValues: { ":pk": `SHOP#${shopId}`, ":skPrefix": "ORDER#" },
    }),
  );
  return (result.Items ?? []) as OrderItem[];
}

/**
 * GET /dashboard?shop_id=X — owner/manager only (authContext.ts's
 * canViewDashboard; counter_staff gets 403, same split as catalog writes).
 * Deliberately reads existing tables with zero schema changes rather than
 * adding a new rollup table or a shop-wide GSI on audit_log: at this
 * product's scale (one shop's catalog/order history, not millions of
 * rows), a per-shop Query + in-Lambda aggregation is simpler and safer
 * than introducing new write-path complexity into the correctness-critical
 * pipeline for a read-only reporting feature. Revisit only if a real
 * shop's order/catalog volume makes this Query too slow.
 *
 * trust_score is deliberately computed from inventory_records' *current*
 * conflict_status (via the existing ShopConflictIndex GSI), not audit_log
 * history — audit_log's pk is scoped per-item (`SHOP#x#ITEM#y`), not
 * per-shop, so there's no efficient shop-wide historical query without a
 * new GSI (and a write-path change to every place that appends to
 * audit_log). "% of the catalog with no open conflict right now" is an
 * honest, useful proxy that needs none of that.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth = getAuthContext(event);
  if (auth && !canViewDashboard(auth.role)) return forbidden("only owner/manager can view the dashboard");

  const shopId = auth?.shopId ?? event.queryStringParameters?.shop_id;
  if (!shopId) return invalidPayload("shop_id is required");

  const lowStockThresholdRaw = event.queryStringParameters?.low_stock_threshold;
  const lowStockThreshold = lowStockThresholdRaw ? Number(lowStockThresholdRaw) : DEFAULT_LOW_STOCK_THRESHOLD;
  if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
    return invalidPayload("low_stock_threshold must be a non-negative number");
  }

  const [items, orders] = await Promise.all([fetchInventoryItems(shopId), fetchOrders(shopId)]);

  const totalRevenue = orders.reduce((sum, order) => sum + order.total_amount, 0);
  const sevenDaysAgo = Date.now() - 7 * MS_PER_DAY;
  const last7DaysRevenue = orders
    .filter((order) => new Date(order.created_at).getTime() >= sevenDaysAgo)
    .reduce((sum, order) => sum + order.total_amount, 0);

  const lowStock = items
    .filter((item) => item.stock <= lowStockThreshold)
    .map((item) => ({ item_id: item.item_id, name: item.name, stock: item.stock }))
    .sort((a, b) => a.stock - b.stock);

  const openConflicts = items.filter((item) => item.conflict_status === "needs_review").length;
  const trustScorePercent = items.length === 0 ? 100 : Math.round(((items.length - openConflicts) / items.length) * 1000) / 10;

  return {
    statusCode: 200,
    body: JSON.stringify({
      revenue: {
        total: totalRevenue,
        order_count: orders.length,
        average_order_value: orders.length === 0 ? 0 : Math.round((totalRevenue / orders.length) * 100) / 100,
        last_7_days: last7DaysRevenue,
      },
      low_stock: lowStock,
      trust_score: {
        percent: trustScorePercent,
        total_items: items.length,
        items_with_open_conflict: openConflicts,
      },
    }),
  };
}
