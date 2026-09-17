/**
 * Resets inventory_records and audit_log for the demo shop back to
 * freshly-seeded state, so rehearsal/test runs don't require manually
 * clearing DynamoDB between attempts (docs/phases/phase-7-integration-
 * demo-scenario.md, step 5). write_dedup is deliberately left alone —
 * each run generates fresh idempotency keys client-side, so stale rows
 * from a previous run can never collide with a new one, the same
 * reasoning Phase 4 used for not simulating TTL expiry in tests.
 *
 * Usage:
 *   INVENTORY_RECORDS_TABLE_NAME=<table> AUDIT_LOG_TABLE_NAME=<table> npm run reset:demo
 * Local:
 *   INVENTORY_RECORDS_TABLE_NAME=inventory_records_local AUDIT_LOG_TABLE_NAME=audit_log_local DYNAMODB_ENDPOINT=http://localhost:8200 npm run reset:demo
 */
import { DeleteCommand, QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ddbClientFromEnv, requireTableName, seedDemoData } from "./lib/demoData";

const SHOP_ID = process.env.SHOP_ID ?? "demo-shop";
const INVENTORY_TABLE = requireTableName("INVENTORY_RECORDS_TABLE_NAME");
const AUDIT_TABLE = requireTableName("AUDIT_LOG_TABLE_NAME");

async function deleteAuditHistory(ddb: DynamoDBDocumentClient, itemId: string): Promise<void> {
  const pk = `SHOP#${SHOP_ID}#ITEM#${itemId}`;
  const result = await ddb.send(new QueryCommand({ TableName: AUDIT_TABLE, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": pk } }));
  for (const entry of result.Items ?? []) {
    await ddb.send(new DeleteCommand({ TableName: AUDIT_TABLE, Key: { pk: entry.pk, sk: entry.sk } }));
  }
}

async function reset(): Promise<void> {
  const ddb = ddbClientFromEnv();

  const existing = await ddb.send(
    new QueryCommand({
      TableName: INVENTORY_TABLE,
      IndexName: "ShopConflictIndex",
      KeyConditionExpression: "shop_id = :shopId",
      ExpressionAttributeValues: { ":shopId": SHOP_ID },
    }),
  );

  for (const item of existing.Items ?? []) {
    await ddb.send(new DeleteCommand({ TableName: INVENTORY_TABLE, Key: { pk: item.pk, sk: item.sk } }));
    await deleteAuditHistory(ddb, item.item_id as string);
    console.log(`Cleared ${item.item_id} (record + audit history)`);
  }

  await seedDemoData(ddb, INVENTORY_TABLE, SHOP_ID);
  console.log("Demo data reset complete.");
}

reset().catch((error: unknown) => {
  console.error("Reset failed:", error);
  process.exit(1);
});
