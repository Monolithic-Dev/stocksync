import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamo";

/**
 * A uniform, last-write-wins REST CRUD handler for the Tier 2 catalog
 * tables (products/categories/suppliers — 19b, 03-DATABASE-SCHEMA.md
 * §8.1-8.2). Deliberately not routed through packages/core's
 * vector-clock/PN-Counter machinery: this is static catalog metadata,
 * never subject to the concurrent-offline-edit conflicts live inventory
 * state is — see senior-architect's guidance on when CRDT-level rigor
 * is and isn't warranted. One handler per resource type (not one route
 * per verb) — GET/POST/PUT/DELETE on the same Lambda, same pattern
 * every resource in this file follows.
 *
 * Auth note: scoped by whatever `shop_id` the caller supplies, exactly
 * like every Tier-1 endpoint — there is no Cognito/JWT layer yet (that's
 * a separate, still-roadmap item; see docs/general/14-build-order-while-waiting.md).
 * Not a regression: nothing in Tier 1 enforces per-shop authorization
 * either (edge case E-1, a stated, known limitation).
 */
export interface CrudResourceConfig {
  tableName: () => string;
  /** DynamoDB sk prefix, e.g. "PRODUCT" -> sk = "PRODUCT#<id>". */
  skPrefix: string;
  /** Response/request field naming the resource's id, e.g. "product_id". */
  idField: string;
  /** Body fields required on create. */
  requiredFields: string[];
  /** Body fields accepted on create/update, beyond requiredFields. */
  optionalFields: string[];
  /** Query-string param usable to filter the list, e.g. "category_id" (products only). */
  listFilterField?: string;
}

function invalidPayload(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, body: JSON.stringify({ error: "invalid_payload", message }) };
}

function notFound(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 404, body: JSON.stringify({ error: "not_found", message }) };
}

function requireNonEmptyString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toItem(config: CrudResourceConfig, shopId: string, id: string, row: Record<string, unknown>) {
  return {
    pk: `SHOP#${shopId}`,
    sk: `${config.skPrefix}#${id}`,
    shop_id: shopId,
    [config.idField]: id,
    ...row,
  };
}

function fromItem(config: CrudResourceConfig, item: Record<string, unknown>): Record<string, unknown> {
  // Strip the internal pk/sk keys — callers only ever see the logical shape.
  const rest = { ...item };
  delete rest.pk;
  delete rest.sk;
  return rest;
}

async function list(config: CrudResourceConfig, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const shopId = requireNonEmptyString(event.queryStringParameters?.shop_id);
  if (!shopId) return invalidPayload("shop_id is required");

  const filterValue = config.listFilterField
    ? requireNonEmptyString(event.queryStringParameters?.[config.listFilterField])
    : undefined;

  const result = await ddb.send(
    new QueryCommand({
      TableName: config.tableName(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": `SHOP#${shopId}`,
        ":skPrefix": `${config.skPrefix}#`,
        ...(filterValue !== undefined ? { ":filterValue": filterValue } : {}),
      },
      ...(filterValue !== undefined && config.listFilterField
        ? { FilterExpression: `${config.listFilterField} = :filterValue` }
        : {}),
    }),
  );

  const items = ((result.Items ?? []) as Record<string, unknown>[]).map((item) => fromItem(config, item));
  return { statusCode: 200, body: JSON.stringify({ items }) };
}

async function create(config: CrudResourceConfig, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
  } catch {
    return invalidPayload("request body must be valid JSON");
  }

  const shopId = requireNonEmptyString(body.shop_id);
  if (!shopId) return invalidPayload("shop_id is required");

  const row: Record<string, unknown> = {};
  for (const field of config.requiredFields) {
    const value = requireNonEmptyString(body[field]);
    if (value === undefined) return invalidPayload(`${field} is required`);
    row[field] = value;
  }
  for (const field of config.optionalFields) {
    if (body[field] !== undefined) row[field] = body[field];
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const item = toItem(config, shopId, id, { ...row, created_at: now, updated_at: now });

  await ddb.send(new PutCommand({ TableName: config.tableName(), Item: item }));
  return { statusCode: 201, body: JSON.stringify(fromItem(config, item)) };
}

async function update(
  config: CrudResourceConfig,
  event: APIGatewayProxyEventV2,
  id: string,
): Promise<APIGatewayProxyResultV2> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
  } catch {
    return invalidPayload("request body must be valid JSON");
  }

  const shopId = requireNonEmptyString(body.shop_id);
  if (!shopId) return invalidPayload("shop_id is required");

  const allowedFields = [...config.requiredFields, ...config.optionalFields];
  const setClauses: string[] = ["#updatedAt = :now"];
  const names: Record<string, string> = { "#updatedAt": "updated_at" };
  const values: Record<string, unknown> = { ":now": new Date().toISOString() };

  for (const field of allowedFields) {
    if (body[field] === undefined) continue;
    setClauses.push(`#${field} = :${field}`);
    names[`#${field}`] = field;
    values[`:${field}`] = body[field];
  }

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: config.tableName(),
        Key: { pk: `SHOP#${shopId}`, sk: `${config.skPrefix}#${id}` },
        UpdateExpression: `SET ${setClauses.join(", ")}`,
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return { statusCode: 200, body: JSON.stringify(fromItem(config, result.Attributes ?? {})) };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return notFound(`no ${config.idField} ${id} for the given shop`);
    }
    throw error;
  }
}

async function remove(
  config: CrudResourceConfig,
  event: APIGatewayProxyEventV2,
  id: string,
): Promise<APIGatewayProxyResultV2> {
  const shopId = requireNonEmptyString(event.queryStringParameters?.shop_id);
  if (!shopId) return invalidPayload("shop_id is required");

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: config.tableName(),
        Key: { pk: `SHOP#${shopId}`, sk: `${config.skPrefix}#${id}` },
        ConditionExpression: "attribute_exists(pk)",
      }),
    );
    return { statusCode: 204, body: "" };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return notFound(`no ${config.idField} ${id} for the given shop`);
    }
    throw error;
  }
}

/** Builds a single Lambda handler covering all four REST verbs for one resource. */
export function createCrudHandler(config: CrudResourceConfig) {
  return async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
    const method = event.requestContext?.http?.method;
    const id = event.pathParameters?.[config.idField];

    if (method === "GET") return list(config, event);
    if (method === "POST") return create(config, event);
    if (method === "PUT") {
      if (!id) return invalidPayload(`${config.idField} is required`);
      return update(config, event, id);
    }
    if (method === "DELETE") {
      if (!id) return invalidPayload(`${config.idField} is required`);
      return remove(config, event, id);
    }
    return invalidPayload(`unsupported method: ${String(method)}`);
  };
}
