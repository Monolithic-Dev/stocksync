import { describe, expect, it, vi, beforeEach } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@aws-sdk/client-cognito-identity-provider", () => {
  class FakeCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    CognitoIdentityProviderClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
    SignUpCommand: FakeCommand,
    ConfirmSignUpCommand: FakeCommand,
    ResendConfirmationCodeCommand: FakeCommand,
    InitiateAuthCommand: FakeCommand,
    RespondToAuthChallengeCommand: FakeCommand,
  };
});

import { decodeIdToken, signUp } from "../../src/lib/cognito";

function fakeIdToken(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
});

describe("decodeIdToken", () => {
  it("reads sub/email/custom:shop_id from the payload", () => {
    const token = fakeIdToken({ sub: "abc", email: "a@b.com", "custom:shop_id": "shop-123" });
    expect(decodeIdToken(token)).toEqual({ sub: "abc", email: "a@b.com", shopId: "shop-123", role: undefined });
  });

  it("resolves the role from a comma-flattened cognito:groups claim (API Gateway JWT authorizer shape)", () => {
    const token = fakeIdToken({ sub: "abc", "cognito:groups": "owner" });
    expect(decodeIdToken(token).role).toBe("owner");
  });

  it("resolves the role from a real Cognito ID token's array-shaped cognito:groups claim", () => {
    const token = fakeIdToken({ sub: "abc", "cognito:groups": ["owner"] });
    expect(decodeIdToken(token).role).toBe("owner");
  });

  it("returns undefined role when no known group is present", () => {
    const token = fakeIdToken({ sub: "abc" });
    expect(decodeIdToken(token).role).toBeUndefined();
  });
});

describe("signUp", () => {
  it("generates a slugified, unique shop_id from the shop name and sends it as a custom attribute", async () => {
    const { shopId } = await signUp({ email: "owner@shop.com", password: "Password1", shopName: "Kiran's General Store" });

    expect(shopId).toMatch(/^kiran-s-general-store-[a-z0-9]{6}$/);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentCommand = sendMock.mock.calls[0][0] as { input: { UserAttributes: { Name: string; Value: string }[] } };
    const shopAttr = sentCommand.input.UserAttributes.find((attr) => attr.Name === "custom:shop_id");
    expect(shopAttr?.Value).toBe(shopId);
  });

  it("two signups with the same shop name get different shop_ids", async () => {
    const first = await signUp({ email: "a@shop.com", password: "Password1", shopName: "Same Name" });
    const second = await signUp({ email: "b@shop.com", password: "Password1", shopName: "Same Name" });
    expect(first.shopId).not.toBe(second.shopId);
  });
});
