import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { MetricUnit } from "@aws-lambda-powertools/metrics";
import type { TransactionInput, TransactionResultDTO, VectorClock } from "@stocksync/core";
import { ddb } from "../lib/dynamo";
import { sqs } from "../lib/sqs";
import { createLogger } from "../lib/logger";
import { createMetrics } from "../lib/metrics";
import { getAuthContext } from "../lib/authContext";

const logger = createLogger("write-intake");
// Module-level so a single request's metrics (one or more transactions
// per batch) accumulate and flush once at the end of handler().
const metrics = createMetrics("write-intake");
import type { QueuedTransactionMessage } from "../lib/queueMessage";

const MAX_BATCH_SIZE = 100; // edge case E-2
const DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;

// The validated shape is exactly TransactionInput — the shared DTO from
// packages/core (see its definition for why this is shared with the
// client rather than redefined here).
type ValidatedTransaction = TransactionInput;

interface RequestBody {
  shop_id?: unknown;
  counter_id?: unknown;
  transactions?: unknown;
}

class ValidationError extends Error {}

function invalidPayload(message: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: "invalid_payload", message }),
  };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  return value;
}

function validateTransaction(raw: unknown, index: number): ValidatedTransaction {
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError(`transactions[${index}] must be an object`);
  }
  const entry = raw as Record<string, unknown>;

  const idempotencyKey = requireNonEmptyString(entry.idempotency_key, `transactions[${index}].idempotency_key`);
  const itemId = requireNonEmptyString(entry.item_id, `transactions[${index}].item_id`);

  if (entry.type !== "sale" && entry.type !== "restock" && entry.type !== "field_update") {
    throw new ValidationError(`transactions[${index}].type must be sale, restock, or field_update`);
  }
  const type = entry.type;

  let quantity: number | undefined;
  let field: string | undefined;

  if (type === "sale" || type === "restock") {
    // edge case E-3: the client never sends a signed quantity — `type`
    // alone determines whether it increments or decrements.
    if (typeof entry.quantity !== "number" || !(entry.quantity > 0)) {
      throw new ValidationError(`transactions[${index}].quantity must be a positive number`);
    }
    quantity = entry.quantity;
  } else {
    field = requireNonEmptyString(entry.field, `transactions[${index}].field`);
  }

  return {
    idempotency_key: idempotencyKey,
    item_id: itemId,
    type,
    quantity,
    field,
    value: entry.value,
    client_vector_clock: (entry.client_vector_clock as VectorClock | undefined) ?? undefined,
    client_timestamp: typeof entry.client_timestamp === "string" ? entry.client_timestamp : undefined,
    order_id: typeof entry.order_id === "string" ? entry.order_id : undefined,
  };
}

/**
 * Writes the write_dedup row iff one doesn't already exist for this key.
 * Returns false if a concurrent request won the race — the caller must
 * treat that exactly like a pre-existing row (duplicate, don't enqueue),
 * since SQS FIFO's own deduplication window is a second line of defense,
 * not the primary one.
 */
async function tryClaimIdempotencyKey(transaction: ValidatedTransaction, counterId: string): Promise<boolean> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cachedResponse: TransactionResultDTO = { idempotency_key: transaction.idempotency_key, status: "queued" };

  try {
    await ddb.send(
      new PutCommand({
        TableName: process.env.WRITE_DEDUP_TABLE_NAME,
        Item: {
          idempotency_key: transaction.idempotency_key,
          item_id: transaction.item_id,
          counter_id: counterId,
          client_timestamp: transaction.client_timestamp,
          status: "queued",
          cached_response: cachedResponse,
          ttl: nowSeconds + DEDUP_TTL_SECONDS,
        },
        ConditionExpression: "attribute_not_exists(idempotency_key)",
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw error;
  }
}

async function processTransaction(
  shopId: string,
  counterId: string,
  transaction: ValidatedTransaction,
): Promise<TransactionResultDTO> {
  const existing = await ddb.send(
    new GetCommand({
      TableName: process.env.WRITE_DEDUP_TABLE_NAME,
      Key: { idempotency_key: transaction.idempotency_key },
    }),
  );

  if (existing.Item) {
    logger.info("duplicate idempotency key, not re-processing", { idempotency_key: transaction.idempotency_key });
    metrics.addMetric("IdempotencyHitRate", MetricUnit.Count, 1);
    return { idempotency_key: transaction.idempotency_key, status: "duplicate" };
  }

  const claimed = await tryClaimIdempotencyKey(transaction, counterId);
  if (!claimed) {
    logger.info("lost the race on a concurrent duplicate, not re-processing", {
      idempotency_key: transaction.idempotency_key,
    });
    metrics.addMetric("IdempotencyHitRate", MetricUnit.Count, 1);
    return { idempotency_key: transaction.idempotency_key, status: "duplicate" };
  }

  const message: QueuedTransactionMessage = {
    shop_id: shopId,
    counter_id: counterId,
    idempotency_key: transaction.idempotency_key,
    item_id: transaction.item_id,
    type: transaction.type,
    quantity: transaction.quantity,
    field: transaction.field,
    value: transaction.value,
    client_vector_clock: transaction.client_vector_clock,
    client_timestamp: transaction.client_timestamp,
    order_id: transaction.order_id,
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.WRITE_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      // Grouped by the affected item, never the sending counter — this is
      // what makes per-item strict ordering hold regardless of how many
      // counters write to it concurrently (see senior-architect skill's
      // "already caught" list for the bug class this fixes).
      MessageGroupId: transaction.item_id,
      // Deduplication is driven by the client's idempotency key, not SQS's
      // content hash (contentBasedDeduplication is false on this queue) —
      // two structurally-identical but independent transactions must not
      // be deduplicated against each other.
      MessageDeduplicationId: transaction.idempotency_key,
    }),
  );

  return { idempotency_key: transaction.idempotency_key, status: "queued" };
}

/**
 * Preserves each item's relative submission order into SQS while still
 * processing different items in parallel (edge case A-4). A plain
 * `Promise.all(transactions.map(processTransaction))` would let two
 * transactions for the *same* item race their own `SendMessageCommand`
 * calls — SQS FIFO only guarantees delivery in the order messages were
 * actually sent to a MessageGroupId, not the order the client intended,
 * so a client replaying two queued writes to the same item in one batch
 * (`useOfflineQueue.ts`'s replayQueue) could have them arrive at
 * conflictResolver.ts reversed. Grouping by item_id and awaiting each
 * group's transactions sequentially closes that gap without serializing
 * unrelated items behind each other.
 */
async function processBatch(
  shopId: string,
  counterId: string,
  transactions: ValidatedTransaction[],
): Promise<TransactionResultDTO[]> {
  const byItem = new Map<string, ValidatedTransaction[]>();
  for (const transaction of transactions) {
    const group = byItem.get(transaction.item_id) ?? [];
    group.push(transaction);
    byItem.set(transaction.item_id, group);
  }

  const resultsByKey = new Map<string, TransactionResultDTO>();
  await Promise.all(
    Array.from(byItem.values()).map(async (group) => {
      for (const transaction of group) {
        resultsByKey.set(transaction.idempotency_key, await processTransaction(shopId, counterId, transaction));
      }
    }),
  );

  // Response order matches request order regardless of the per-item
  // grouping above — callers correlate by idempotency_key, not position,
  // but preserving it is still the least-surprising contract.
  return transactions.map((transaction) => resultsByKey.get(transaction.idempotency_key)!);
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  let body: RequestBody;
  try {
    body = JSON.parse(event.body ?? "{}") as RequestBody;
  } catch {
    return invalidPayload("request body must be valid JSON");
  }

  let shopId: string;
  let counterId: string;
  try {
    // The verified JWT's shop_id wins over whatever the client sent, same
    // pattern as crudTable.ts — falls back to body.shop_id when there's no
    // authorizer context, which covers both local dev and checkout.ts's
    // in-process call into this same handler (its synthesized event never
    // carries an authorizer context; checkout.ts already resolved its own
    // caller's shop_id via getAuthContext before building that event).
    shopId = getAuthContext(event)?.shopId ?? requireNonEmptyString(body.shop_id, "shop_id");
    counterId = requireNonEmptyString(body.counter_id, "counter_id");
  } catch (error) {
    return invalidPayload((error as ValidationError).message);
  }

  if (!Array.isArray(body.transactions) || body.transactions.length === 0) {
    return invalidPayload("transactions must be a non-empty array");
  }
  if (body.transactions.length > MAX_BATCH_SIZE) {
    return invalidPayload(`transactions batch exceeds the ${MAX_BATCH_SIZE}-transaction limit`);
  }

  let validated: ValidatedTransaction[];
  try {
    validated = body.transactions.map(validateTransaction);
  } catch (error) {
    if (error instanceof ValidationError) {
      return invalidPayload(error.message);
    }
    throw error;
  }

  const results = await processBatch(shopId, counterId, validated);

  if (metrics.hasStoredMetrics()) {
    metrics.publishStoredMetrics();
  }

  return { statusCode: 200, body: JSON.stringify({ results }) };
}
