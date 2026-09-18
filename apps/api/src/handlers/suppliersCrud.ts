import { createCrudHandler } from "../lib/crudTable";

/** GET/POST/PUT/DELETE /suppliers (19b, 04-API-SPEC.md §5.1). `lead_time_days` feeds the Tier 2 reorder-suggestion feature (roadmap, not built). */
export const handler = createCrudHandler({
  tableName: () => process.env.SUPPLIERS_TABLE_NAME!,
  skPrefix: "SUPPLIER",
  idField: "supplier_id",
  requiredFields: ["name"],
  optionalFields: ["lead_time_days"],
});
