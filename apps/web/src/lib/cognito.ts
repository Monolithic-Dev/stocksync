import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// Same pattern as apps/web/src/api/client.ts: read-only Vite env, empty
// string fallback keeps local dev from crashing at build time before a
// real User Pool exists — calls simply fail with a clear network/config
// error instead.
const REGION: string = import.meta.env.VITE_COGNITO_REGION ?? "us-east-1";
const CLIENT_ID: string = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";

const client = new CognitoIdentityProviderClient({ region: REGION });

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms — derived from the ID token's own `exp` claim, not guessed from `ExpiresIn`, so a clock-skewed client still refreshes at the right moment relative to what the token itself claims. */
  expiresAt: number;
}

export interface IdTokenClaims {
  sub: string;
  email?: string;
  shopId?: string;
  role?: "owner" | "manager" | "counter_staff";
}

/**
 * Decodes (never verifies — that's the server's job via the API Gateway
 * JWT authorizer) the ID token's payload, purely to drive what the UI
 * shows. Never trust this for an authorization decision; every protected
 * request is re-checked server-side against the token itself.
 */
export function decodeIdToken(idToken: string): IdTokenClaims {
  const [, payloadB64] = idToken.split(".");
  const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  const groups = typeof payload["cognito:groups"] === "string" ? (payload["cognito:groups"] as string) : "";
  const role = (["owner", "manager", "counter_staff"] as const).find((candidate) => groups.includes(candidate));
  return {
    sub: payload.sub as string,
    email: payload.email as string | undefined,
    shopId: payload["custom:shop_id"] as string | undefined,
    role,
  };
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "shop"
  );
}

/** A short, low-collision suffix — good enough at this scale; a true collision just means two shops share a display name, not a security issue (each still gets its own random shop_id). */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export interface SignUpInput {
  email: string;
  password: string;
  shopName: string;
}

/**
 * Self-signup always creates a brand-new shop — the caller becomes its
 * "owner" once postConfirmation.ts's trigger fires on ConfirmSignUp (see
 * infra/cdk/lib/constructs/Auth.ts's doc comment for the full flow).
 * shop_id is generated client-side since SignUp is unauthenticated; a
 * human-readable slug plus a random suffix keeps it unique without
 * needing a server round-trip first.
 */
export async function signUp(input: SignUpInput): Promise<{ shopId: string }> {
  const shopId = `${slugify(input.shopName)}-${randomSuffix()}`;
  await client.send(
    new SignUpCommand({
      ClientId: CLIENT_ID,
      Username: input.email,
      Password: input.password,
      UserAttributes: [
        { Name: "email", Value: input.email },
        { Name: "custom:shop_id", Value: shopId },
      ],
    }),
  );
  return { shopId };
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  await client.send(new ConfirmSignUpCommand({ ClientId: CLIENT_ID, Username: email, ConfirmationCode: code }));
}

export async function resendConfirmationCode(email: string): Promise<void> {
  await client.send(new ResendConfirmationCodeCommand({ ClientId: CLIENT_ID, Username: email }));
}

export type SignInResult =
  | { kind: "success"; tokens: AuthTokens }
  | { kind: "new_password_required"; session: string };

function tokensFromAuthResult(result: {
  IdToken?: string;
  AccessToken?: string;
  RefreshToken?: string;
}): AuthTokens {
  if (!result.IdToken || !result.AccessToken || !result.RefreshToken) {
    throw new Error("Cognito did not return a complete set of tokens");
  }
  const { exp } = decodeExp(result.IdToken);
  return { idToken: result.IdToken, accessToken: result.AccessToken, refreshToken: result.RefreshToken, expiresAt: exp * 1000 };
}

function decodeExp(idToken: string): { exp: number } {
  const [, payloadB64] = idToken.split(".");
  const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))) as { exp: number };
  return { exp: payload.exp };
}

/**
 * USER_PASSWORD_AUTH — sends the password directly over TLS via
 * InitiateAuth. Simpler than implementing SRP client-side without Amplify
 * (see Auth.ts's doc comment for the same tradeoff on the pool's
 * auth-flow config). A staff account's first sign-in (after AdminCreateUser)
 * comes back as a NEW_PASSWORD_REQUIRED challenge instead of tokens —
 * completeNewPassword finishes that flow.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const result = await client.send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );

  if (result.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    if (!result.Session) throw new Error("Cognito did not return a challenge session");
    return { kind: "new_password_required", session: result.Session };
  }

  if (!result.AuthenticationResult) throw new Error("sign-in did not return tokens or a challenge");
  return { kind: "success", tokens: tokensFromAuthResult(result.AuthenticationResult) };
}

export async function completeNewPassword(email: string, newPassword: string, session: string): Promise<AuthTokens> {
  const result = await client.send(
    new RespondToAuthChallengeCommand({
      ClientId: CLIENT_ID,
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: session,
      ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
    }),
  );
  if (!result.AuthenticationResult) throw new Error("challenge response did not return tokens");
  return tokensFromAuthResult(result.AuthenticationResult);
}

export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const result = await client.send(
    new InitiateAuthCommand({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  );
  if (!result.AuthenticationResult?.IdToken || !result.AuthenticationResult.AccessToken) {
    throw new Error("refresh did not return tokens");
  }
  const { exp } = decodeExp(result.AuthenticationResult.IdToken);
  // Cognito's REFRESH_TOKEN_AUTH doesn't reissue a refresh token — reuse the one the caller already has.
  return {
    idToken: result.AuthenticationResult.IdToken,
    accessToken: result.AuthenticationResult.AccessToken,
    refreshToken,
    expiresAt: exp * 1000,
  };
}
