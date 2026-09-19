import { AdminAddUserToGroupCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import type { PostConfirmationTriggerEvent } from "aws-lambda";

const cognito = new CognitoIdentityProviderClient({});

/**
 * Cognito PostConfirmation trigger (Auth.ts) — fires once, right after a
 * self-signed-up user verifies their email via ConfirmSignUp. This is the
 * *only* path into the "owner" group: self-signup always represents someone
 * setting up a brand-new shop (its shop_id was set by the client at SignUp
 * time, in custom:shop_id), so they own it. Staff invited afterwards
 * (staffInvite.ts, via AdminCreateUser) never pass through this trigger —
 * AdminCreateUser bypasses ConfirmSignUp entirely — so this handler only
 * ever needs to handle the owner case.
 */
export async function handler(event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> {
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") return event;

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: event.userPoolId,
      Username: event.userName,
      GroupName: "owner",
    }),
  );

  return event;
}
