import { CreateTableCommand } from "@aws-sdk/client-dynamodb";

/**
 * The four Tier-1 table schemas (03-DATABASE-SCHEMA.md), expressed as raw
 * CreateTableCommand inputs for DynamoDB Local — used by both the
 * conflictResolver integration test and the local dev server (src/local/
 * server.ts) so there's one source of truth for "what the tables look
 * like locally," matching infra/cdk/lib/constructs/DataLayer.ts's real
 * CDK definitions. Never imported by any deployed Lambda handler.
 */
export function localTableDefinitions(names: {
  inventoryRecords: string;
  auditLog: string;
  writeDedup: string;
  wsConnections: string;
}): CreateTableCommand[] {
  return [
    new CreateTableCommand({
      TableName: names.inventoryRecords,
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "shop_id", AttributeType: "S" },
        { AttributeName: "conflict_status", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "ShopConflictIndex",
          KeySchema: [
            { AttributeName: "shop_id", KeyType: "HASH" },
            { AttributeName: "conflict_status", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
    new CreateTableCommand({
      TableName: names.auditLog,
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
    new CreateTableCommand({
      TableName: names.writeDedup,
      AttributeDefinitions: [{ AttributeName: "idempotency_key", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "idempotency_key", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
    new CreateTableCommand({
      TableName: names.wsConnections,
      AttributeDefinitions: [
        { AttributeName: "connection_id", AttributeType: "S" },
        { AttributeName: "shop_id", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "connection_id", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "ShopConnectionsIndex",
          KeySchema: [{ AttributeName: "shop_id", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  ];
}

/**
 * The Tier 2 catalog tables (19b, 03-DATABASE-SCHEMA.md §8.1-8.4) —
 * a second function rather than extending localTableDefinitions' params,
 * so every existing caller (the Tier-1-only conflictResolver test suite,
 * in particular) is unaffected by this addition.
 */
export function platformTableDefinitions(names: {
  products: string;
  categories: string;
  suppliers: string;
  orders: string;
}): CreateTableCommand[] {
  return [
    new CreateTableCommand({
      TableName: names.products,
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "category_id", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "CategoryIndex",
          KeySchema: [{ AttributeName: "category_id", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
    new CreateTableCommand({
      TableName: names.categories,
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
    new CreateTableCommand({
      TableName: names.suppliers,
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
    new CreateTableCommand({
      TableName: names.orders,
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  ];
}
