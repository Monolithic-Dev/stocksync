import { CognitoIdentityProviderClient, ListUsersInGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { InventoryRecordItem } from "../src/lib/inventoryRecord";

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const sesMock = mockClient(SESv2Client);

// notifyAlerts.ts reads USER_POOL_ID/SES_FROM_EMAIL once at module load —
// same static-import-hoisting reason staffInvite.test.ts uses a dynamic
// import behind a beforeAll.
let handler: typeof import("../src/handlers/notifyAlerts").handler;

beforeAll(async () => {
  process.env.USER_POOL_ID = "pool-1";
  process.env.SES_FROM_EMAIL = "alerts@shop.com";
  process.env.LOW_STOCK_THRESHOLD = "5";
  ({ handler } = await import("../src/handlers/notifyAlerts"));
});

function baseItem(overrides: Partial<InventoryRecordItem> = {}): InventoryRecordItem {
  return {
    pk: "SHOP#shop-1#ITEM#parle-g",
    sk: "CURRENT",
    shop_id: "shop-1",
    item_id: "parle-g",
    name: "Parle-G 100g",
    base_stock: 40,
    pn_counter: { increments: {}, decrements: {} },
    stock: 40,
    vector_clock: {},
    field_last_writer: {},
    conflict_status: "none",
    updated_at: "2026-09-19T00:00:00.000Z",
    ...overrides,
  };
}

function streamEvent(params: {
  eventName?: "INSERT" | "MODIFY" | "REMOVE";
  oldItem?: InventoryRecordItem;
  newItem?: InventoryRecordItem;
}): DynamoDBStreamEvent {
  const { eventName = "MODIFY", oldItem, newItem } = params;
  return {
    Records: [
      {
        eventName,
        dynamodb: {
          OldImage: oldItem ? (marshall(oldItem) as never) : undefined,
          NewImage: newItem ? (marshall(newItem) as never) : undefined,
        },
      },
    ],
  } as unknown as DynamoDBStreamEvent;
}

const OWNER_USER = {
  Username: "owner-1",
  Attributes: [
    { Name: "email", Value: "owner@shop-1.com" },
    { Name: "custom:shop_id", Value: "shop-1" },
  ],
};

beforeEach(() => {
  cognitoMock.reset();
  sesMock.reset();
  cognitoMock.on(ListUsersInGroupCommand).resolves({ Users: [OWNER_USER] });
  sesMock.on(SendEmailCommand).resolves({});
});

describe("notifyAlerts (inventory_records stream consumer)", () => {
  it("sends a low-stock alert when stock crosses at/under the threshold", async () => {
    const event = streamEvent({
      oldItem: baseItem({ stock: 10 }),
      newItem: baseItem({ stock: 3 }),
    });
    await handler(event);

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    const call = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(call.Destination?.ToAddresses).toEqual(["owner@shop-1.com"]);
    expect(call.Content?.Simple?.Subject?.Data).toMatch(/low stock/i);
  });

  it("does not re-alert when stock was already at/under the threshold", async () => {
    const event = streamEvent({
      oldItem: baseItem({ stock: 3 }),
      newItem: baseItem({ stock: 2 }),
    });
    await handler(event);

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it("treats a brand-new item (no OldImage) at/under the threshold as crossing in", async () => {
    const event = streamEvent({ eventName: "INSERT", newItem: baseItem({ stock: 1 }) });
    await handler(event);

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
  });

  it("sends a conflict alert when conflict_status newly becomes needs_review", async () => {
    const event = streamEvent({
      oldItem: baseItem({ conflict_status: "none" }),
      newItem: baseItem({ conflict_status: "needs_review" }),
    });
    await handler(event);

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    const call = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(call.Content?.Simple?.Subject?.Data).toMatch(/conflict/i);
  });

  it("does not re-alert when conflict_status was already needs_review", async () => {
    const event = streamEvent({
      oldItem: baseItem({ conflict_status: "needs_review" }),
      newItem: baseItem({ conflict_status: "needs_review" }),
    });
    await handler(event);

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it("sends both alerts when a single write both drops stock low and flags a conflict", async () => {
    const event = streamEvent({
      oldItem: baseItem({ stock: 10, conflict_status: "none" }),
      newItem: baseItem({ stock: 1, conflict_status: "needs_review" }),
    });
    await handler(event);

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);
  });

  it("ignores REMOVE events entirely", async () => {
    const event = streamEvent({ eventName: "REMOVE", oldItem: baseItem({ stock: 1 }) });
    await handler(event);

    expect(cognitoMock.commandCalls(ListUsersInGroupCommand)).toHaveLength(0);
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it("skips gracefully when no owner is found for the shop, never throwing", async () => {
    cognitoMock.on(ListUsersInGroupCommand).resolves({ Users: [] });
    const event = streamEvent({ oldItem: baseItem({ stock: 10 }), newItem: baseItem({ stock: 1 }) });

    await expect(handler(event)).resolves.toBeUndefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it("pages through ListUsersInGroup to find the matching shop's owner", async () => {
    cognitoMock
      .on(ListUsersInGroupCommand)
      .resolvesOnce({
        Users: [{ Username: "other", Attributes: [{ Name: "email", Value: "x@other.com" }, { Name: "custom:shop_id", Value: "shop-2" }] }],
        NextToken: "page-2",
      })
      .resolvesOnce({ Users: [OWNER_USER] });

    const event = streamEvent({ oldItem: baseItem({ stock: 10 }), newItem: baseItem({ stock: 1 }) });
    await handler(event);

    expect(cognitoMock.commandCalls(ListUsersInGroupCommand)).toHaveLength(2);
    expect(sesMock.commandCalls(SendEmailCommand)[0].args[0].input.Destination?.ToAddresses).toEqual(["owner@shop-1.com"]);
  });

  it("never throws when SES rejects the send (e.g. sandbox-unverified recipient)", async () => {
    sesMock.on(SendEmailCommand).rejects(new Error("MessageRejected: Email address is not verified"));
    const event = streamEvent({ oldItem: baseItem({ stock: 10 }), newItem: baseItem({ stock: 1 }) });

    await expect(handler(event)).resolves.toBeUndefined();
  });

  it("processes remaining records even if one record is malformed", async () => {
    const good = streamEvent({ oldItem: baseItem({ stock: 10 }), newItem: baseItem({ stock: 1 }) }).Records[0];
    const malformed = { eventName: "MODIFY", dynamodb: { NewImage: { bogus: "not-a-valid-attribute-value" } } };
    const event = { Records: [malformed, good] } as unknown as DynamoDBStreamEvent;

    await expect(handler(event)).resolves.toBeUndefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
  });
});
