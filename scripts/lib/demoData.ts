import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Shared between seed-demo-data.ts and reset-demo.ts so the two can never
 * drift on what "the seeded demo state" actually is — reset-demo.ts's
 * whole job is restoring exactly this, between rehearsal/test runs.
 */
export interface SeedItem {
  item_id: string;
  name: string;
  stock: number;
  price: number;
  shelf_location: string;
  supplier: string;
}

export const SEED_ITEMS: SeedItem[] = [
  { item_id: "parle-g", name: "Parle-G 100g", stock: 50, price: 10, shelf_location: "Aisle 2", supplier: "Parle Products" },
  { item_id: "rice-5kg", name: "Rice 5kg", stock: 20, price: 350, shelf_location: "Aisle 1", supplier: "Local Wholesaler" },
  { item_id: "milk-500ml", name: "Milk 500ml", stock: 30, price: 25, shelf_location: "Fridge", supplier: "Amul" },
];

export function ddbClientFromEnv(): DynamoDBDocumentClient {
  const client = new DynamoDBClient(
    process.env.DYNAMODB_ENDPOINT
      ? {
          endpoint: process.env.DYNAMODB_ENDPOINT,
          region: "local",
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }
      : {},
  );
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}

export function requireTableName(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    console.error(`${envVar} is required — find it in the deployed stack's CfnOutput, or set it for your local server.`);
    process.exit(1);
  }
  return value;
}

/** Idempotent: writes every seed item back to its starting state, overwriting whatever was there. */
export async function seedDemoData(
  ddb: DynamoDBDocumentClient,
  inventoryRecordsTable: string,
  shopId: string,
): Promise<void> {
  const now = new Date().toISOString();
  for (const item of SEED_ITEMS) {
    await ddb.send(
      new PutCommand({
        TableName: inventoryRecordsTable,
        Item: {
          pk: `SHOP#${shopId}#ITEM#${item.item_id}`,
          sk: "CURRENT",
          shop_id: shopId,
          item_id: item.item_id,
          name: item.name,
          base_stock: item.stock,
          stock: item.stock,
          pn_counter: { increments: {}, decrements: {} },
          price: item.price,
          shelf_location: item.shelf_location,
          supplier: item.supplier,
          vector_clock: {},
          // Deliberately empty — AttributionBadge renders nothing for a
          // falsy counter_id, so a seeded field shows no badge until a
          // real counter actually writes to it.
          field_last_writer: {},
          conflict_status: "none",
          updated_at: now,
        },
      }),
    );
    console.log(`Seeded ${item.item_id} (stock=${item.stock}) into ${inventoryRecordsTable}`);
  }
}
