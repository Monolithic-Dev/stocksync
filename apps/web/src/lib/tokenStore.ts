import type { AuthTokens } from "./cognito";

const STORAGE_KEY = "stocksync.auth.tokens";

/**
 * Plain module-level store, not React state — apps/web/src/api/client.ts
 * needs to read the current ID token synchronously from plain functions
 * (postTransactions, getSync, etc. aren't hooks), so the source of truth
 * for "what token do I send right now" can't live only inside
 * AuthContext's component state. AuthContext still owns every write to
 * this store (sign-in, refresh, sign-out) and mirrors it into its own
 * React state for rendering.
 */
let current: AuthTokens | null = load();

function load(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthTokens) : null;
  } catch {
    return null;
  }
}

export function getTokens(): AuthTokens | null {
  return current;
}

export function setTokens(tokens: AuthTokens | null): void {
  current = tokens;
  try {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort persistence only (e.g. a private browsing window that
    // blocks storage) — the in-memory value above still makes the
    // current tab's session work correctly, it just won't survive a reload.
  }
}
