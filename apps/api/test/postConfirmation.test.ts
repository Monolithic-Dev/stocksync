import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { PostConfirmationTriggerEvent } from "aws-lambda";
import { handler } from "../src/handlers/postConfirmation";

const cognitoMock = mockClient(CognitoIdentityProviderClient);

function triggerEvent(triggerSource: string): PostConfirmationTriggerEvent {
  return {
    triggerSource,
    userPoolId: "pool-1",
    userName: "owner@shop.com",
    request: { userAttributes: {} },
    response: {},
  } as unknown as PostConfirmationTriggerEvent;
}

beforeEach(() => {
  cognitoMock.reset();
  cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
});

describe("postConfirmation trigger", () => {
  it("adds a self-confirmed user to the owner group — the only path into that group", async () => {
    await handler(triggerEvent("PostConfirmation_ConfirmSignUp"));

    const calls = cognitoMock.commandCalls(AdminAddUserToGroupCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({ UserPoolId: "pool-1", Username: "owner@shop.com", GroupName: "owner" });
  });

  it("does nothing for a trigger source other than ConfirmSignUp (e.g. AdminCreateUser's confirm)", async () => {
    await handler(triggerEvent("PostConfirmation_ConfirmForgotPassword"));
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);
  });
});
