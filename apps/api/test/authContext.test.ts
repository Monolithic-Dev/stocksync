import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { canInviteStaff, canWriteCatalog, getAuthContext } from "../src/lib/authContext";

function eventWithClaims(claims: Record<string, string> | undefined): APIGatewayProxyEventV2 {
  return {
    requestContext: claims ? { authorizer: { jwt: { claims } } } : {},
  } as unknown as APIGatewayProxyEventV2;
}

describe("getAuthContext", () => {
  it("returns undefined when there's no authorizer context (local dev / pre-auth tests)", () => {
    expect(getAuthContext(eventWithClaims(undefined))).toBeUndefined();
  });

  it("returns undefined when custom:shop_id is missing from the claims", () => {
    expect(getAuthContext(eventWithClaims({ sub: "u1" }))).toBeUndefined();
  });

  it("returns undefined when sub is missing from the claims", () => {
    expect(getAuthContext(eventWithClaims({ "custom:shop_id": "shop-1" }))).toBeUndefined();
  });

  it("extracts shopId/sub/email/role from a well-formed claims set", () => {
    const ctx = getAuthContext(
      eventWithClaims({ sub: "u1", "custom:shop_id": "shop-1", email: "owner@shop.com", "cognito:groups": "owner" }),
    );
    expect(ctx).toEqual({ shopId: "shop-1", role: "owner", sub: "u1", email: "owner@shop.com" });
  });

  it("defaults to counter_staff when cognito:groups is absent (never silently grants a higher role)", () => {
    const ctx = getAuthContext(eventWithClaims({ sub: "u1", "custom:shop_id": "shop-1" }));
    expect(ctx?.role).toBe("counter_staff");
  });

  it("picks the highest-privilege group when a user is somehow in more than one", () => {
    const ctx = getAuthContext(
      eventWithClaims({ sub: "u1", "custom:shop_id": "shop-1", "cognito:groups": "counter_staff,owner" }),
    );
    expect(ctx?.role).toBe("owner");
  });

  it("tolerates a bracketed groups claim (defensive — API Gateway's documented format has no brackets, but parsing shouldn't break if one shows up)", () => {
    const ctx = getAuthContext(eventWithClaims({ sub: "u1", "custom:shop_id": "shop-1", "cognito:groups": "[manager]" }));
    expect(ctx?.role).toBe("manager");
  });
});

describe("canWriteCatalog", () => {
  it("allows owner and manager", () => {
    expect(canWriteCatalog("owner")).toBe(true);
    expect(canWriteCatalog("manager")).toBe(true);
  });

  it("denies counter_staff", () => {
    expect(canWriteCatalog("counter_staff")).toBe(false);
  });
});

describe("canInviteStaff", () => {
  it("allows only owner", () => {
    expect(canInviteStaff("owner")).toBe(true);
    expect(canInviteStaff("manager")).toBe(false);
    expect(canInviteStaff("counter_staff")).toBe(false);
  });
});
