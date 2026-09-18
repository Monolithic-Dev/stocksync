import { randomUUID } from "node:crypto";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { MetricUnit } from "@aws-lambda-powertools/metrics";
import { resolve, type IncomingWrite, type ResolutionResult } from "@stocksync/core";
import { ddb } from "../lib/dynamo";
import { createLogger } from "../lib/logger";
import { createMetrics } from "../lib/metrics";
import { explainPriceConflict } from "../lib/bedrock";

const logger = createLogger("conflict-resolver");
// Module-level so a single batch invocation's metrics accumulate across
// every record and flush once at the end, rather than one EMF blob per
// record — see handler()'s publishStoredMetrics() call.
const metrics = createMetrics("conflict-resolver");
import type { QueuedTransactionMessage } from "../lib/queueMessage";
import {
  buildNextItem,
  inventoryRecordKey,
  toRecordState,
  type ConflictCandidateItem,
  type InventoryRecordItem,
} from "../lib/inventoryRecord";
import { pushToShop, type WsPushPayload } from "./wsPush";

const RESOLVED_DEDUP_STATUSES = new Set(["applied", "needs_review", "conflict_resolved"]);

function parseMessage(body: string): QueuedTransactionMessage {
  let parsed: Partial<QueuedTransactionMessage>;
  try {
    parsed = JSON.parse(body) as Partial<QueuedTransactionMessage>;
  } catch {
    throw new Error("malformed queue message: not valid JSON");
  }

  if (
    typeof parsed.shop_id !== "string" ||
    typeof parsed.counter_id !== "string" ||
    typeof parsed.idempotency_key !== "string" ||
    typeof parsed.item_id !== "string" ||
    (parsed.type !== "sale" && parsed.type !== "restock" && parsed.type !== "field_update")
  ) {
    throw new Error("malformed queue message: missing a required field");
  }

  return parsed as QueuedTransactionMessage;
}

function toIncomingWrite(message: QueuedTransactionMessage): IncomingWrite {
  return {
    clientId: message.counter_id,
    vectorClock: message.client_vector_clock ?? {},
    fields: message.type === "field_update" && message.field ? { [message.field]: message.value } : undefined,
    counterDelta:
      message.type === "sale" || message.type === "restock"
        ? { type: message.type === "sale" ? "decrement" : "increment", amount: message.quantity ?? 0 }
        : undefined,
  };
}

/**
 * Best-effort proxy for "how concurrent was this really": the gap between
 * the incoming write's own client_timestamp and the prior stored value's
 * updated_at. The true "how long was each device offline" isn't tracked by
 * any current data source (only the current record's last-touch time), so
 * this is a documented approximation, not the literal formula implied by
 * the docs' example numbers.
 */
function computeOverlapSeconds(priorUpdatedAt: string | undefined, incomingClientTimestamp: string | undefined): number {
  if (!priorUpdatedAt || !incomingClientTimestamp) return 0;
  const diffMs = Math.abs(new Date(incomingClientTimestamp).getTime() - new Date(priorUpdatedAt).getTime());
  if (Number.isNaN(diffMs)) return 0;
  return Math.round(diffMs / 1000);
}

async function fetchDedupStatus(idempotencyKey: string): Promise<string | undefined> {
  const row = await ddb.send(
    new GetCommand({
      TableName: process.env.WRITE_DEDUP_TABLE_NAME,
      Key: { idempotency_key: idempotencyKey },
    }),
  );
  return row.Item?.status as string | undefined;
}

async function processRecord(record: SQSRecord): Promise<void> {
  const message = parseMessage(record.body);

  // The actual idempotency guard for SQS redelivery. resolve() is a pure
  // function, not a safe-to-replay one: once a write's delta is already
  // folded into the stored vector clock, re-running resolve() against
  // that updated state would apply the same counter delta a second time
  // (dominates() would be false — the incoming clock no longer has
  // anything new — but the "not dominates" branch still applies counter
  // deltas unconditionally). This check, not resolve() internally, is
  // what makes reprocessing a redelivered message safe.
  const existingDedupStatus = await fetchDedupStatus(message.idempotency_key);
  if (existingDedupStatus && RESOLVED_DEDUP_STATUSES.has(existingDedupStatus)) {
    logger.info("idempotency key already resolved, skipping reprocessing", {
      idempotency_key: message.idempotency_key,
      status: existingDedupStatus,
    });
    return;
  }

  const { pk, sk } = inventoryRecordKey(message.shop_id, message.item_id);
  const existing = await ddb.send(
    new GetCommand({ TableName: process.env.INVENTORY_RECORDS_TABLE_NAME, Key: { pk, sk } }),
  );
  const priorItem = existing.Item as InventoryRecordItem | undefined;

  const result = resolve(toRecordState(priorItem), toIncomingWrite(message));
  const now = new Date().toISOString();
  const nextItem = buildNextItem({ shopId: message.shop_id, itemId: message.item_id, priorItem, nextState: result.state, now });

  const { dedupStatus, auditEntry, wsPayload } = finalizeResult({ pk, now, message, priorItem, nextItem, result });

  if (dedupStatus === "needs_review") {
    metrics.addMetric("ConflictRate", MetricUnit.Count, 1);
  }

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: process.env.INVENTORY_RECORDS_TABLE_NAME, Item: nextItem } },
        { Put: { TableName: process.env.AUDIT_LOG_TABLE_NAME, Item: auditEntry } },
        {
          Update: {
            TableName: process.env.WRITE_DEDUP_TABLE_NAME,
            Key: { idempotency_key: message.idempotency_key },
            UpdateExpression: "SET #status = :status, cached_response = :cachedResponse",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": dedupStatus,
              ":cachedResponse": { idempotency_key: message.idempotency_key, status: dedupStatus },
            },
          },
        },
      ],
    }),
  );

  // Push is additive, never a dependency of correctness — the commit
  // above has already succeeded regardless of whether this fails.
  await pushToShop(message.shop_id, wsPayload).catch((error) => {
    logger.error("wsPush failed after a successful commit", { error, item_id: message.item_id });
  });

  // Fires only after the conflict is already flagged, committed, and
  // pushed — a Bedrock failure or timeout can therefore never be the
  // reason a conflict fails to display (FR-7, G-1/G-3). Awaited here
  // rather than truly detached: an un-awaited promise has no reliable
  // completion guarantee once a Lambda invocation returns, so this stays
  // within the invocation, bounded by explainPriceConflict's own short
  // internal timeout so it can't hang the next queued message for this
  // item's FIFO group.
  await maybeExplainPriceConflict({ shopId: message.shop_id, itemId: message.item_id, pk, sk, wsPayload });
}

async function maybeExplainPriceConflict(params: {
  shopId: string;
  itemId: string;
  pk: string;
  sk: string;
  wsPayload: WsPushPayload;
}): Promise<void> {
  const { shopId, itemId, pk, sk, wsPayload } = params;
  // Scoped to price per FR-7 — not every same-field conflict, only the
  // one this feature is named and scored for.
  if (wsPayload.type !== "needs_review" || wsPayload.field !== "price") return;

  const [candidateA, candidateB] = wsPayload.values;
  if (!candidateA || !candidateB) return; // defensive: resolve() always produces exactly two

  const explanation = await explainPriceConflict(
    wsPayload.field,
    { counterId: candidateA.counter_id, value: candidateA.value },
    { counterId: candidateB.counter_id, value: candidateB.value },
    wsPayload.overlap_seconds,
  );
  if (explanation === null) return; // edge case G-1: the raw values alone are already sufficient

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.INVENTORY_RECORDS_TABLE_NAME,
        Key: { pk, sk },
        // Additive context, not part of the original transaction — a
        // second, smaller write, guarded so a slow Bedrock response can
        // never resurrect or overwrite a conflict that's since been
        // resolved or replaced by a newer one on the same field (edge
        // case F-3).
        UpdateExpression: "SET #cc.#explanation = :explanation",
        ConditionExpression: "#status = :needsReview AND #cc.#field = :field",
        ExpressionAttributeNames: {
          "#cc": "conflict_candidates",
          "#explanation": "bedrock_explanation",
          "#status": "conflict_status",
          "#field": "field",
        },
        ExpressionAttributeValues: {
          ":explanation": explanation,
          ":needsReview": "needs_review",
          ":field": wsPayload.field,
        },
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      logger.info("conflict changed before Bedrock's explanation arrived, discarding it", { item_id: itemId });
      return;
    }
    throw error;
  }

  // A second, follow-up push — the client already has both raw values
  // from the original push and renders "Generating explanation…" until
  // this one arrives (04-API-SPEC.md §2, edge case F-3).
  await pushToShop(shopId, { ...wsPayload, ai_summary: explanation }).catch((error) => {
    logger.error("wsPush failed for the follow-up Bedrock explanation", { error, item_id: itemId });
  });
}

function finalizeResult(params: {
  pk: string;
  now: string;
  message: QueuedTransactionMessage;
  priorItem: InventoryRecordItem | undefined;
  nextItem: InventoryRecordItem;
  result: ResolutionResult;
}): {
  dedupStatus: "applied" | "needs_review";
  auditEntry: Record<string, unknown>;
  wsPayload: WsPushPayload;
} {
  const { pk, now, message, priorItem, nextItem, result } = params;
  const sk = `${now}#${randomUUID()}`;

  if (result.kind === "needs_review") {
    const overlapSeconds = computeOverlapSeconds(priorItem?.updated_at, message.client_timestamp);
    // Each new needs_review compares the incoming value against whatever
    // is currently stored (which stays untouched while a conflict is
    // pending — see conflictResolution.ts). A second concurrent write on
    // an *already*-conflicted field re-flags against the same original
    // pair rather than accumulating a third candidate (edge case B-5's
    // "recommended" full behavior) — a deliberate, documented scope cut,
    // not an oversight.
    const candidates: ConflictCandidateItem[] = result.candidates.map((candidate, index) =>
      index === 0
        ? { counter_id: candidate.clientId, value: candidate.value, server_timestamp: priorItem?.updated_at ?? now }
        : {
            counter_id: candidate.clientId,
            value: candidate.value,
            client_timestamp: message.client_timestamp,
            server_timestamp: now,
          },
    );

    nextItem.conflict_status = "needs_review";
    nextItem.conflict_candidates = { field: result.field, overlap_seconds: overlapSeconds, values: candidates };

    return {
      dedupStatus: "needs_review",
      auditEntry: {
        pk,
        sk,
        counter_id: message.counter_id,
        action: "conflict_detected",
        resolution_strategy: "needs_review",
        // current_vector_clock/incoming_vector_clock: additive, for
        // apps/web's VectorClockExplainer (13b) — the actual clocks
        // compared to reach this decision, not used by resolve() itself.
        details: {
          field: result.field,
          values: candidates.map((c) => c.value),
          current_vector_clock: priorItem?.vector_clock ?? {},
          incoming_vector_clock: message.client_vector_clock ?? {},
        },
      },
      wsPayload: {
        type: "needs_review",
        item_id: message.item_id,
        field: result.field,
        overlap_seconds: overlapSeconds,
        values: candidates.map((c) => ({ counter_id: c.counter_id, value: c.value, client_timestamp: c.client_timestamp })),
        // Bedrock's explanation is Phase 8's job — always null here, per
        // 04-API-SPEC.md §2's note that the UI must handle both states.
        ai_summary: null,
        vector_clock: nextItem.vector_clock,
      },
    };
  }

  const details = {
    ...(message.type === "field_update"
      ? { field: message.field, value: message.value }
      : { quantity: message.quantity, resulting_stock: nextItem.stock }),
    // See the needs_review branch above for why these are here.
    current_vector_clock: priorItem?.vector_clock ?? {},
    incoming_vector_clock: message.client_vector_clock ?? {},
  };

  return {
    dedupStatus: "applied",
    auditEntry: {
      pk,
      sk,
      counter_id: message.counter_id,
      action: message.type,
      resolution_strategy: result.strategy === "clean_apply" ? undefined : result.strategy,
      details,
    },
    wsPayload: {
      type: "record_updated",
      item_id: message.item_id,
      stock: nextItem.stock,
      price: nextItem.price,
      shelf_location: nextItem.shelf_location,
      expiry_date: nextItem.expiry_date,
      stock_anomaly: nextItem.stock_anomaly,
      field_last_writer: nextItem.field_last_writer,
      vector_clock: nextItem.vector_clock,
    },
  };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      // Reported as a per-message failure (not thrown) so SQS retries only
      // this record, not the whole batch — a malformed message must never
      // block other items' processing (edge case B-1/US-6). After
      // maxReceiveCount retries it lands in the DLQ.
      logger.error("failed to process write-queue message", { messageId: record.messageId, error });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  // Flushed once per batch invocation, not per record — see the
  // module-level `metrics` instance's comment.
  if (metrics.hasStoredMetrics()) {
    metrics.publishStoredMetrics();
  }

  return { batchItemFailures };
}
