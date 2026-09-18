/**
 * Populates inventory_records with the project's running demo example
 * (Parle-G, rice, milk, bread) so a freshly deployed stack (or a local
 * DynamoDB Local instance) has something real for the client to display
 * from first load. Also seeds the Tier 2 catalog (products/categories/
 * suppliers, 19b) to match, if those tables' env vars are set — optional,
 * since Tier 2 may not be deployed yet.
 *
 * Usage: INVENTORY_RECORDS_TABLE_NAME=<table> npm run seed:demo
 * Local:  INVENTORY_RECORDS_TABLE_NAME=inventory_records_local DYNAMODB_ENDPOINT=http://localhost:8200 npm run seed:demo
 * Plus Tier 2: also set PRODUCTS_TABLE_NAME, CATEGORIES_TABLE_NAME, SUPPLIERS_TABLE_NAME
 */
import { config } from "dotenv";
import { ddbClientFromEnv, requireTableName, seedCatalogData, seedDemoData } from "./lib/demoData";

// Loads .env.local if present (real AWS credentials/table names) — a
// silent no-op if it doesn't exist, so local-only dev (env vars passed
// inline on the command line) is unaffected.
config({ path: ".env.local" });

const SHOP_ID = process.env.SHOP_ID ?? "demo-shop";
const TABLE_NAME = requireTableName("INVENTORY_RECORDS_TABLE_NAME");
const ddb = ddbClientFromEnv();

async function main(): Promise<void> {
  await seedDemoData(ddb, TABLE_NAME, SHOP_ID);

  const { PRODUCTS_TABLE_NAME, CATEGORIES_TABLE_NAME, SUPPLIERS_TABLE_NAME } = process.env;
  if (PRODUCTS_TABLE_NAME && CATEGORIES_TABLE_NAME && SUPPLIERS_TABLE_NAME) {
    await seedCatalogData(
      ddb,
      { products: PRODUCTS_TABLE_NAME, categories: CATEGORIES_TABLE_NAME, suppliers: SUPPLIERS_TABLE_NAME },
      SHOP_ID,
    );
  } else {
    console.log("Skipping Tier 2 catalog seed — PRODUCTS_TABLE_NAME/CATEGORIES_TABLE_NAME/SUPPLIERS_TABLE_NAME not all set.");
  }
}

main().catch((error: unknown) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
