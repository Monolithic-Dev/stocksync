/**
 * Populates inventory_records with the project's running demo example
 * (Parle-G, rice, milk) so a freshly deployed stack (or a local DynamoDB
 * Local instance) has something real for the client to display from
 * first load.
 *
 * Usage: INVENTORY_RECORDS_TABLE_NAME=<table> npm run seed:demo
 * Local:  INVENTORY_RECORDS_TABLE_NAME=inventory_records_local DYNAMODB_ENDPOINT=http://localhost:8200 npm run seed:demo
 */
import { ddbClientFromEnv, requireTableName, seedDemoData } from "./lib/demoData";

const SHOP_ID = process.env.SHOP_ID ?? "demo-shop";
const TABLE_NAME = requireTableName("INVENTORY_RECORDS_TABLE_NAME");

seedDemoData(ddbClientFromEnv(), TABLE_NAME, SHOP_ID).catch((error: unknown) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
