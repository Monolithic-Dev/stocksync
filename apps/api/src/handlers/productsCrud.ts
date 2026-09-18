import { createCrudHandler } from "../lib/crudTable";

/** GET/POST/PUT/DELETE /products (19b, 04-API-SPEC.md §5.1). */
export const handler = createCrudHandler({
  tableName: () => process.env.PRODUCTS_TABLE_NAME!,
  skPrefix: "PRODUCT",
  idField: "product_id",
  requiredFields: ["name"],
  optionalFields: ["sku", "category_id", "supplier_id", "base_price"],
  listFilterField: "category_id",
});
