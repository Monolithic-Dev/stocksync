import {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { createLogger } from "../lib/logger";
import type { InventoryRecordItem } from "../lib/inventoryRecord";

const logger = createLogger("notifyAlerts");

const cognito = new CognitoIdentityProviderClient({});
const ses = new SESv2Client({});

const USER_POOL_ID = process.env.USER_POOL_ID ?? "";
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? "";
const LOW_STOCK_THRESHOLD = process.env.LOW_STOCK_THRESHOLD ? Number(process.env.LOW_STOCK_THRESHOLD) : 5;

function attr(user: UserType, name: string): string | undefined {
  return user.Attributes?.find((a) => a.Name === name)?.Value;
}

/**
 * Owners aren't grouped per-shop in Cognito (the "owner" group holds every
 * shop's owner) — so finding the one for this shop_id means paging through
 * the whole group and filtering client-side by custom:shop_id. Acceptable
 * at hackathon/demo scale; would need a shop->owner index table to stay
 * cheap at real scale.
 */
async function findShopOwnerEmail(shopId: string): Promise<string | undefined> {
  let nextToken: string | undefined;
  do {
    const response = await cognito.send(
      new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: "owner", NextToken: nextToken }),
    );
    const match = (response.Users ?? []).find((user) => attr(user, "custom:shop_id") === shopId);
    if (match) return attr(match, "email");
    nextToken = response.NextToken;
  } while (nextToken);
  return undefined;
}

async function sendAlertEmail(to: string, subject: string, body: string): Promise<void> {
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } },
      }),
    );
  } catch (error) {
    // Notifications are advisory, never correctness-critical — same
    // degrade-gracefully principle as bedrock.ts's explainer. A failed
    // send (e.g. SES sandbox rejecting an unverified recipient) must never
    // fail the stream-triggered invocation.
    logger.error("SES send failed", { error, to, subject });
  }
}

function crossedIntoLowStock(oldItem: InventoryRecordItem | undefined, newItem: InventoryRecordItem): boolean {
  return newItem.stock <= LOW_STOCK_THRESHOLD && (!oldItem || oldItem.stock > LOW_STOCK_THRESHOLD);
}

function enteredNeedsReview(oldItem: InventoryRecordItem | undefined, newItem: InventoryRecordItem): boolean {
  return newItem.conflict_status === "needs_review" && oldItem?.conflict_status !== "needs_review";
}

/**
 * Triggered by inventory_records' DynamoDB Stream (enabled since Phase 1,
 * never actually consumed until now — real-time push to connected clients
 * goes through wsPush.ts's direct in-process call from conflictResolver.ts
 * instead, so this stream was sitting unused). Compares OLD vs NEW images
 * to fire an email only on the edge that matters — crossing *into* low
 * stock, or a conflict newly appearing — never on every write to an
 * already-low or already-flagged item, which would spam the owner on each
 * subsequent sale.
 */
export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      if (record.eventName === "REMOVE" || !record.dynamodb?.NewImage) continue;

      const newItem = unmarshall(record.dynamodb.NewImage as Record<string, never>) as InventoryRecordItem;
      const oldItem = record.dynamodb.OldImage
        ? (unmarshall(record.dynamodb.OldImage as Record<string, never>) as InventoryRecordItem)
        : undefined;

      const lowStock = crossedIntoLowStock(oldItem, newItem);
      const newConflict = enteredNeedsReview(oldItem, newItem);
      if (!lowStock && !newConflict) continue;

      const ownerEmail = await findShopOwnerEmail(newItem.shop_id);
      if (!ownerEmail) {
        logger.warn("no owner found for shop, skipping alert", { shop_id: newItem.shop_id });
        continue;
      }

      if (lowStock) {
        await sendAlertEmail(
          ownerEmail,
          `Low stock: ${newItem.name ?? newItem.item_id}`,
          `${newItem.name ?? newItem.item_id} is down to ${newItem.stock} unit(s), at or below your threshold of ${LOW_STOCK_THRESHOLD}.`,
        );
      }
      if (newConflict) {
        await sendAlertEmail(
          ownerEmail,
          `Conflict needs review: ${newItem.name ?? newItem.item_id}`,
          `${newItem.name ?? newItem.item_id} has a data conflict that needs your review — two counters recorded different values for the same field.`,
        );
      }
    } catch (error) {
      // One malformed/unexpected record must never block the rest of the
      // batch or cause the stream shard to stall retrying it forever.
      logger.error("failed to process stream record", { error });
    }
  }
}
