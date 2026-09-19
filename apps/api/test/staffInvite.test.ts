import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { mockClient } from "aws-sdk-client-mock";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const cognitoMock = mockClient(CognitoIdentityProviderClient);

// staffInvite.ts reads USER_POOL_ID once at module load — static imports
// are always hoisted above any other top-level code regardless of source
// position, so setting the env var must happen before a *dynamic* import,
// same pattern as bedrock.crossAccount.test.ts.
let handler: typeof import("../src/handlers/staffInvite").handler;

beforeAll(async () => {
  process.env.USER_POOL_ID = "pool-1";
  ({ handler } = await import("../src/handlers/staffInvite"));
});

function invoke(claims: Record<string, string> | undefined, body: unknown): Promise<{ statusCode: number; body: string }> {
  const event = {
    requestContext: claims ? { authorizer: { jwt: { claims } } } : {},
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
  return handler(event) as Promise<{ statusCode: number; body: string }>;
}

const OWNER_CLAIMS = { sub: "u-owner", "custom:shop_id": "shop-1", "cognito:groups": "owner" };
const MANAGER_CLAIMS = { sub: "u-mgr", "custom:shop_id": "shop-1", "cognito:groups": "manager" };

beforeEach(() => {
  cognitoMock.reset();
  cognitoMock.on(AdminCreateUserCommand).resolves({});
  cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
});

describe("POST /staff", () => {
  it("403s an unauthenticated request", async () => {
    const result = await invoke(undefined, { email: "x@y.com", role: "manager" });
    expect(result.statusCode).toBe(403);
  });

  it("403s a manager — only the owner can invite", async () => {
    const result = await invoke(MANAGER_CLAIMS, { email: "x@y.com", role: "counter_staff" });
    expect(result.statusCode).toBe(403);
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });

  it("400s an invalid role", async () => {
    const result = await invoke(OWNER_CLAIMS, { email: "x@y.com", role: "owner" });
    expect(result.statusCode).toBe(400);
  });

  it("400s a missing email", async () => {
    const result = await invoke(OWNER_CLAIMS, { role: "manager" });
    expect(result.statusCode).toBe(400);
  });

  it("creates the user under the inviter's own shop_id — never a client-supplied one — and assigns the requested group", async () => {
    const result = await invoke(OWNER_CLAIMS, { email: "staff@shop.com", role: "manager", shop_id: "attacker-shop" });
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual({ email: "staff@shop.com", role: "manager", shop_id: "shop-1" });

    const createCall = cognitoMock.commandCalls(AdminCreateUserCommand)[0];
    const shopAttr = (createCall.args[0].input.UserAttributes ?? []).find((attr) => attr.Name === "custom:shop_id");
    expect(shopAttr?.Value).toBe("shop-1");

    const groupCall = cognitoMock.commandCalls(AdminAddUserToGroupCommand)[0];
    expect(groupCall.args[0].input).toEqual({ UserPoolId: "pool-1", Username: "staff@shop.com", GroupName: "manager" });
  });
});
