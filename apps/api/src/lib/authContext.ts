import type { APIGatewayProxyEventV2 } from "aws-lambda";

export type Role = "owner" | "manager" | "counter_staff";
const ROLE_PRIORITY: Role[] = ["owner", "manager", "counter_staff"];

export interface AuthContext {
  shopId: string;
  role: Role;
  sub: string;
  email?: string;
}

function parseGroups(raw: string | undefined): Role[] {
  if (!raw) return [];
  // API Gateway's HTTP API JWT authorizer flattens a JSON-array claim like
  // `cognito:groups` into a comma-separated string (no brackets in the
  // documented case, but stripping them anyway costs nothing and guards
  // against a differently-shaped claim reaching here unverified).
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((group) => group.trim())
    .filter((group): group is Role => (ROLE_PRIORITY as string[]).includes(group));
}

/**
 * Reads the identity API Gateway's JWT authorizer has already verified
 * (infra/cdk/lib/constructs/Auth.ts) — this function never itself verifies
 * a token, that's the authorizer's job before the Lambda is even invoked.
 *
 * Returns undefined when no authorizer context is present, which is
 * exactly the case for local dev (src/local/server.ts has no Cognito
 * integration) and every pre-auth test — callers fall back to whatever
 * shop_id the request body/query itself supplies, unchanged from
 * pre-auth behavior. In production every route sits behind the
 * authorizer, so this is never undefined there.
 */
export function getAuthContext(event: APIGatewayProxyEventV2): AuthContext | undefined {
  const claims = (
    event.requestContext as unknown as { authorizer?: { jwt?: { claims?: Record<string, string> } } } | undefined
  )?.authorizer?.jwt?.claims;
  if (!claims) return undefined;

  const shopId = claims["custom:shop_id"];
  const sub = claims.sub;
  if (!shopId || !sub) return undefined;

  const groups = parseGroups(claims["cognito:groups"]);
  // Highest-privilege group wins if a user somehow ends up in more than
  // one — shouldn't happen given how postConfirmation.ts/staffInvite.ts
  // assign groups, but resolving deterministically here is cheap insurance
  // against silently granting the wrong role.
  const role = ROLE_PRIORITY.find((candidate) => groups.includes(candidate)) ?? "counter_staff";

  return { shopId, role, sub, email: claims.email };
}

const CATALOG_WRITE_ROLES: Role[] = ["owner", "manager"];

/** Products/categories/suppliers create/update/delete — counter staff browse but never edit the catalog. */
export function canWriteCatalog(role: Role): boolean {
  return CATALOG_WRITE_ROLES.includes(role);
}

/** Only the shop owner can invite new staff accounts. */
export function canInviteStaff(role: Role): boolean {
  return role === "owner";
}

/** Revenue/low-stock/trust-score numbers are a business-owner concern, not a counter-staff one — same role split as catalog writes, named separately since the two checks protect different things and shouldn't drift together by accident. */
export function canViewDashboard(role: Role): boolean {
  return CATALOG_WRITE_ROLES.includes(role);
}
