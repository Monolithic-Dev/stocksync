import { createCrudHandler } from "../lib/crudTable";

/** GET/POST/PUT/DELETE /categories (19b, 04-API-SPEC.md §5.1). */
export const handler = createCrudHandler({
  tableName: () => process.env.CATEGORIES_TABLE_NAME!,
  skPrefix: "CATEGORY",
  idField: "category_id",
  requiredFields: ["name"],
  optionalFields: [],
});
