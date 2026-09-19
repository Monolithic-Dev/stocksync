import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  completeNewPassword as cognitoCompleteNewPassword,
  confirmSignUp as cognitoConfirmSignUp,
  decodeIdToken,
  refreshSession,
  resendConfirmationCode as cognitoResendConfirmationCode,
  signIn as cognitoSignIn,
  signUp as cognitoSignUp,
  type AuthTokens,
  type IdTokenClaims,
} from "../lib/cognito";
import { getTokens, setTokens } from "../lib/tokenStore";

export type AuthUser = IdTokenClaims;

interface AuthState {
  status: "loading" | "signed_out" | "signed_in";
  user: AuthUser | null;
}

export interface SignInOutcome {
  newPasswordRequired: boolean;
  session?: string;
}

interface AuthContextValue extends AuthState {
  signUp: (input: { email: string; password: string; shopName: string }) => Promise<{ shopId: string }>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmationCode: (email: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<SignInOutcome>;
  completeNewPassword: (email: string, newPassword: string, session: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Refresh this long before actual expiry so an in-flight request never
// races a token that's about to be rejected by the API Gateway authorizer.
const REFRESH_MARGIN_MS = 60_000;

/**
 * Owns the app's entire auth lifecycle: restoring a session from
 * tokenStore.ts on load, refreshing it on a timer before it expires, and
 * every state transition sign-up/sign-in/sign-out cause. api/client.ts
 * reads tokenStore.ts directly (not through this context) since it's
 * plain functions, not components — this context is the only thing that
 * ever *writes* to that store, so the two stay in sync by construction.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  const applyTokens = useCallback((tokens: AuthTokens) => {
    setTokens(tokens);
    setState({ status: "signed_in", user: decodeIdToken(tokens.idToken) });
  }, []);

  const clearTokens = useCallback(() => {
    setTokens(null);
    setState({ status: "signed_out", user: null });
  }, []);

  useEffect(() => {
    const stored = getTokens();
    if (!stored) {
      setState({ status: "signed_out", user: null });
      return;
    }
    if (stored.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      setState({ status: "signed_in", user: decodeIdToken(stored.idToken) });
      return;
    }
    refreshSession(stored.refreshToken)
      .then(applyTokens)
      .catch(() => clearTokens());
  }, [applyTokens, clearTokens]);

  useEffect(() => {
    if (state.status !== "signed_in") return undefined;
    const tokens = getTokens();
    if (!tokens) return undefined;
    const delay = Math.max(tokens.expiresAt - Date.now() - REFRESH_MARGIN_MS, 5_000);
    const timer = setTimeout(() => {
      refreshSession(tokens.refreshToken)
        .then(applyTokens)
        .catch(() => clearTokens());
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arms whenever the signed-in user identity actually changes, not on every render
  }, [state.status, state.user?.sub, applyTokens, clearTokens]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signUp: (input) => cognitoSignUp(input),
      confirmSignUp: cognitoConfirmSignUp,
      resendConfirmationCode: cognitoResendConfirmationCode,
      signIn: async (email, password) => {
        const result = await cognitoSignIn(email, password);
        if (result.kind === "new_password_required") {
          return { newPasswordRequired: true, session: result.session };
        }
        applyTokens(result.tokens);
        return { newPasswordRequired: false };
      },
      completeNewPassword: async (email, newPassword, session) => {
        applyTokens(await cognitoCompleteNewPassword(email, newPassword, session));
      },
      signOut: clearTokens,
    }),
    [state, applyTokens, clearTokens],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
