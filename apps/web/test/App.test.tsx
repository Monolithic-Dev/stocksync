import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearPending, listPending } from "../src/offline/db";
import { setTokens } from "../src/lib/tokenStore";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const syncBody = {
  items: [
    {
      item_id: "parle-g",
      name: "Parle-G 100g",
      stock: 40,
      price: 10,
      field_last_writer: { price: "counter_a" },
      conflict_status: "none",
      vector_clock: { counter_a: 1 },
    },
  ],
};

/** Not a real signed JWT — decodeIdToken (src/lib/cognito.ts) never verifies, it only reads the payload, so this is enough to drive AuthContext's state in a test. */
function fakeIdToken(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}.sig`;
}

function signInAs(role: "owner" | "manager" | "counter_staff", shopId = "demo-shop"): void {
  setTokens({
    idToken: fakeIdToken({
      sub: "user-1",
      email: `${role}@shop.com`,
      "custom:shop_id": shopId,
      "cognito:groups": role,
    }),
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 3_600_000,
  });
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(syncBody)));
  // App never opens a real socket in this environment — WebSocket isn't
  // polyfilled by jsdom, so useWebSocketSync's calls to `new WebSocket()`
  // would throw. Stub the global constructor to a harmless no-op.
  vi.stubGlobal(
    "WebSocket",
    vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      close: vi.fn(),
    })),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setTokens(null);
  const pending = await listPending();
  await Promise.all(pending.map((entry) => clearPending(entry.idempotencyKey)));
});

describe("App — signed out", () => {
  it("shows the landing page (sign-in/sign-up) for a bare visit, never the counter view", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: /inventory that never loses a sale/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText("Parle-G 100g")).not.toBeInTheDocument();
  });

  it("a bare ?counter_id= link with no session still shows the landing page — shop identity only ever comes from the signed-in account, never the URL", async () => {
    window.history.pushState({}, "", "/?counter_id=counter_a");
    render(<App />);

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });
});

describe("App — signed in", () => {
  it("shows the counter picker first when there's no counter_id in the URL yet", async () => {
    signInAs("owner");
    render(<App />);

    expect(await screen.findByRole("heading", { name: /which counter is this/i })).toBeInTheDocument();
    expect(screen.queryByText("Parle-G 100g")).not.toBeInTheDocument();
  });

  it("picking a counter loads its data and writes counter_id into the URL", async () => {
    signInAs("owner");
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /counter a/i }));

    expect(await screen.findByText("Parle-G 100g")).toBeInTheDocument();
    expect(window.location.search).toBe("?counter_id=counter_a");
  });

  it("a URL that already carries counter_id skips the picker", async () => {
    signInAs("owner");
    window.history.pushState({}, "", "/?counter_id=counter_b");
    render(<App />);

    expect(await screen.findByText("Parle-G 100g")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /which counter is this/i })).not.toBeInTheDocument();
  });

  it("shows the Staff nav link for an owner but not for counter staff", async () => {
    signInAs("owner");
    window.history.pushState({}, "", "/?counter_id=counter_a");
    render(<App />);
    await screen.findByText("Parle-G 100g");
    expect(screen.getByRole("link", { name: /staff/i })).toBeInTheDocument();
  });

  it("hides the Staff nav link for counter staff", async () => {
    signInAs("counter_staff");
    window.history.pushState({}, "", "/?counter_id=counter_a");
    render(<App />);
    await screen.findByText("Parle-G 100g");
    expect(screen.queryByRole("link", { name: /staff/i })).not.toBeInTheDocument();
  });

  it("going offline via the toggle and selling an item queues it, without calling fetch again", async () => {
    signInAs("owner");
    window.history.pushState({}, "", "/?counter_id=counter_a");
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Parle-G 100g");
    const fetchCallsAfterSync = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    await user.click(screen.getByRole("button", { name: /online/i }));
    expect(screen.getByText("Offline")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sell 1/i }));

    expect(await screen.findByText(/sale · parle-g/i)).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    // No new network call — the write went to IndexedDB, not the wire.
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsAfterSync);

    await waitFor(async () => {
      expect(await listPending()).toHaveLength(1);
    });
  });
});
