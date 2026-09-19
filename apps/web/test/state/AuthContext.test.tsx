import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../../src/state/AuthContext";
import { getTokens, setTokens } from "../../src/lib/tokenStore";

const signInMock = vi.fn();
const signUpMock = vi.fn();
const decodeIdTokenMock = vi.fn();
const refreshSessionMock = vi.fn();

vi.mock("../../src/lib/cognito", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  signUp: (...args: unknown[]) => signUpMock(...args),
  confirmSignUp: vi.fn(),
  resendConfirmationCode: vi.fn(),
  completeNewPassword: vi.fn(),
  refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
  decodeIdToken: (...args: unknown[]) => decodeIdTokenMock(...args),
}));

function Probe() {
  const { status, user, signIn, signOut } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="email">{user?.email ?? ""}</span>
      <button onClick={() => void signIn("owner@shop.com", "pw")}>do-sign-in</button>
      <button onClick={signOut}>do-sign-out</button>
    </div>
  );
}

beforeEach(() => {
  signInMock.mockReset();
  signUpMock.mockReset();
  decodeIdTokenMock.mockReset();
  refreshSessionMock.mockReset();
  decodeIdTokenMock.mockImplementation((idToken: string) => JSON.parse(idToken) as unknown);
});

afterEach(() => {
  setTokens(null);
});

describe("AuthProvider", () => {
  it("starts signed_out with no stored session", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed_out"));
  });

  it("restores a still-valid stored session on mount without calling refresh", async () => {
    setTokens({
      idToken: JSON.stringify({ sub: "u1", email: "owner@shop.com" }),
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 3_600_000,
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed_in"));
    expect(screen.getByTestId("email").textContent).toBe("owner@shop.com");
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });

  it("refreshes a stored session that's about to expire", async () => {
    setTokens({
      idToken: JSON.stringify({ sub: "stale" }),
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 1_000, // inside the refresh margin
    });
    refreshSessionMock.mockResolvedValue({
      idToken: JSON.stringify({ sub: "u1", email: "refreshed@shop.com" }),
      accessToken: "a2",
      refreshToken: "r",
      expiresAt: Date.now() + 3_600_000,
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("email").textContent).toBe("refreshed@shop.com"));
    expect(refreshSessionMock).toHaveBeenCalledWith("r");
  });

  it("sign-in success writes tokens to the store and flips status to signed_in", async () => {
    signInMock.mockResolvedValue({
      kind: "success",
      tokens: {
        idToken: JSON.stringify({ sub: "u1", email: "owner@shop.com" }),
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 3_600_000,
      },
    });

    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed_out"));

    await user.click(screen.getByText("do-sign-in"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed_in"));
    expect(getTokens()?.accessToken).toBe("a");
  });

  it("sign-out clears the token store and flips status back to signed_out", async () => {
    setTokens({
      idToken: JSON.stringify({ sub: "u1", email: "owner@shop.com" }),
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 3_600_000,
    });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed_in"));

    await user.click(screen.getByText("do-sign-out"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed_out"));
    expect(getTokens()).toBeNull();
  });
});
