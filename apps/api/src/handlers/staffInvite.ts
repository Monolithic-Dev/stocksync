import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { canInviteStaff, getAuthContext } from "../lib/authContext";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID ?? "";

const INVITABLE_ROLES = ["manager", "counter_staff"] as const;
type InvitableRole = (typeof INVITABLE_ROLES)[number];

function invalidPayload(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, body: JSON.stringify({ error: "invalid_payload", message }) };
}

function forbidden(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 403, body: JSON.stringify({ error: "forbidden", message }) };
}

/**
 * POST /staff (owner-only, Auth.ts's JWT authorizer sits in front of every
 * route including this one). Creates a new Cognito user already assigned
 * to the *inviting* owner's shop_id and the requested role — never a
 * client-supplied shop_id, which is the one thing that would make this
 * exploitable across shops. AdminCreateUser bypasses ConfirmSignUp, so
 * postConfirmation.ts's trigger never fires for these users — the group
 * is assigned here, synchronously, instead.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth = getAuthContext(event);
  if (!auth) return forbidden("authentication required");
  if (!canInviteStaff(auth.role)) return forbidden("only the shop owner can invite staff");

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
  } catch {
    return invalidPayload("request body must be valid JSON");
  }

  const email = typeof body.email === "string" && body.email.length > 0 ? body.email : undefined;
  if (!email) return invalidPayload("email is required");

  const role = body.role;
  if (typeof role !== "string" || !INVITABLE_ROLES.includes(role as InvitableRole)) {
    return invalidPayload(`role must be one of: ${INVITABLE_ROLES.join(", ")}`);
  }

  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "custom:shop_id", Value: auth.shopId },
      ],
      DesiredDeliveryMediums: ["EMAIL"],
    }),
  );

  await cognito.send(
    new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: email, GroupName: role }),
  );

  return { statusCode: 201, body: JSON.stringify({ email, role, shop_id: auth.shopId }) };
}
