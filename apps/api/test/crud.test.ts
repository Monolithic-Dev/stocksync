import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import dynalite from "dynalite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Same fixed-endpoint-before-any-import pattern as writeIntake.test.ts.
const PORT = 8129;
const PRODUCTS_TABLE = "products_test";
process.env.DYNAMODB_ENDPOINT = `http://localhost:${PORT}`;
process.env.PRODUCTS_TABLE_NAME = PRODUCTS_TABLE;

let dynaliteServer: ReturnType<typeof dynalite>;
let handler: typeof import("../src/handlers/productsCrud").handler;
let ddb: typeof import("../src/lib/dynamo").ddb;

function invoke(
  method: string,
  options: {
    query?: Record<string, string>;
    pathParams?: Record<string, string>;
    body?: unknown;
    claims?: Record<string, string>;
  } = {},
): Promise<{ statusCode: number; body: string }> {
  const event = {
    requestContext: {
      http: { method },
      ...(options.claims ? { authorizer: { jwt: { claims: options.claims } } } : {}),
    },
    queryStringParameters: options.query,
    pathParameters: options.pathParams,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  } as unknown as APIGatewayProxyEventV2;
  return handler(event) as Promise<{ statusCode: number; body: string }>;
}

function parseBody<T>(result: { body: string }): T {
  return JSON.parse(result.body) as T;
}

beforeAll(async () => {
  dynaliteServer = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    dynaliteServer.listen(PORT, (err?: Error) => (err ? reject(err) : resolve()));
  });

  ({ ddb } = await import("../src/lib/dynamo"));
  ({ handler } = await import("../src/handlers/productsCrud"));

  await ddb.send(
    new CreateTableCommand({
      TableName: PRODUCTS_TABLE,
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
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => dynaliteServer.close(() => resolve()));
});

describe("productsCrud — the generic CRUD handler via one representative resource", () => {
  it("creates, lists, updates, and deletes a product", async () => {
    const created = await invoke("POST", { body: { shop_id: "demo-shop", name: "Parle-G 100g", base_price: 10 } });
    expect(created.statusCode).toBe(201);
    const product = parseBody<{ product_id: string; name: string; base_price: number }>(created);
    expect(product.name).toBe("Parle-G 100g");
    expect(product.base_price).toBe(10);

    const listed = await invoke("GET", { query: { shop_id: "demo-shop" } });
    expect(listed.statusCode).toBe(200);
    expect(parseBody<{ items: unknown[] }>(listed).items).toHaveLength(1);

    const updated = await invoke("PUT", {
      pathParams: { product_id: product.product_id },
      body: { shop_id: "demo-shop", base_price: 12 },
    });
    expect(updated.statusCode).toBe(200);
    expect(parseBody<{ base_price: number }>(updated).base_price).toBe(12);

    const deleted = await invoke("DELETE", {
      pathParams: { product_id: product.product_id },
      query: { shop_id: "demo-shop" },
    });
    expect(deleted.statusCode).toBe(204);

    const listedAfterDelete = await invoke("GET", { query: { shop_id: "demo-shop" } });
    expect(parseBody<{ items: unknown[] }>(listedAfterDelete).items).toHaveLength(0);
  });

  it("filters the list by category_id via the CategoryIndex GSI", async () => {
    await invoke("POST", { body: { shop_id: "demo-shop-2", name: "Milk", category_id: "dairy" } });
    await invoke("POST", { body: { shop_id: "demo-shop-2", name: "Rice", category_id: "grains" } });

    const filtered = await invoke("GET", { query: { shop_id: "demo-shop-2", category_id: "dairy" } });
    const items = parseBody<{ items: { name: string }[] }>(filtered).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("Milk");
  });

  it("returns 400 when a required field is missing on create", async () => {
    const result = await invoke("POST", { body: { shop_id: "demo-shop" } });
    expect(result.statusCode).toBe(400);
  });

  it("returns 404 updating or deleting a product that doesn't exist", async () => {
    const updated = await invoke("PUT", { pathParams: { product_id: "nope" }, body: { shop_id: "demo-shop" } });
    expect(updated.statusCode).toBe(404);

    const deleted = await invoke("DELETE", { pathParams: { product_id: "nope" }, query: { shop_id: "demo-shop" } });
    expect(deleted.statusCode).toBe(404);
  });

  it("scopes products by shop_id — a product created under one shop never appears in another's list", async () => {
    await invoke("POST", { body: { shop_id: "shop-a", name: "Only in A" } });
    const listedForB = await invoke("GET", { query: { shop_id: "shop-b" } });
    expect(parseBody<{ items: { name: string }[] }>(listedForB).items).not.toContainEqual(
      expect.objectContaining({ name: "Only in A" }),
    );
  });
});

describe("productsCrud — authenticated (JWT authorizer present)", () => {
  const OWNER_CLAIMS = { sub: "u-owner", "custom:shop_id": "auth-shop", "cognito:groups": "owner" };
  const STAFF_CLAIMS = { sub: "u-staff", "custom:shop_id": "auth-shop", "cognito:groups": "counter_staff" };

  it("the verified JWT shop_id wins over a client-supplied one — closes the cross-tenant gap crudTable.ts used to have", async () => {
    const created = await invoke("POST", {
      claims: OWNER_CLAIMS,
      body: { shop_id: "attacker-supplied-shop", name: "Tenant-safe item" },
    });
    expect(created.statusCode).toBe(201);

    // Listed under the JWT's real shop, not the attacker-supplied one.
    const listedReal = await invoke("GET", { claims: OWNER_CLAIMS, query: { shop_id: "auth-shop" } });
    expect(parseBody<{ items: { name: string }[] }>(listedReal).items).toContainEqual(
      expect.objectContaining({ name: "Tenant-safe item" }),
    );

    const listedAttacker = await invoke("GET", { query: { shop_id: "attacker-supplied-shop" } });
    expect(parseBody<{ items: unknown[] }>(listedAttacker).items).toHaveLength(0);
  });

  it("counter_staff can list products but gets 403 creating one", async () => {
    const listed = await invoke("GET", { claims: STAFF_CLAIMS, query: {} });
    expect(listed.statusCode).toBe(200);

    const created = await invoke("POST", { claims: STAFF_CLAIMS, body: { name: "Should be blocked" } });
    expect(created.statusCode).toBe(403);
  });

  it("counter_staff gets 403 updating or deleting a product owner/manager created", async () => {
    const created = await invoke("POST", { claims: OWNER_CLAIMS, body: { name: "Owner's item" } });
    const { product_id } = parseBody<{ product_id: string }>(created);

    const updated = await invoke("PUT", { claims: STAFF_CLAIMS, pathParams: { product_id }, body: { base_price: 5 } });
    expect(updated.statusCode).toBe(403);

    const deleted = await invoke("DELETE", { claims: STAFF_CLAIMS, pathParams: { product_id } });
    expect(deleted.statusCode).toBe(403);
  });

  it("owner can create, update, and delete", async () => {
    const created = await invoke("POST", { claims: OWNER_CLAIMS, body: { name: "Owner CRUD" } });
    expect(created.statusCode).toBe(201);
    const { product_id } = parseBody<{ product_id: string }>(created);

    const updated = await invoke("PUT", { claims: OWNER_CLAIMS, pathParams: { product_id }, body: { base_price: 9 } });
    expect(updated.statusCode).toBe(200);

    const deleted = await invoke("DELETE", { claims: OWNER_CLAIMS, pathParams: { product_id } });
    expect(deleted.statusCode).toBe(204);
  });
});
