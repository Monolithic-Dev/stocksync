import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearPending, listPending } from "../src/offline/db";

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

beforeEach(() => {
  // These tests exercise the counter view directly, the same way a real
  // shareable demo link does (README's ?shop_id=&counter_id= pattern) —
  // App.tsx's landing-page gate is covered separately in HeroPage.test.tsx.
  window.history.pushState({}, "", "/?shop_id=demo-shop&counter_id=counter_a");
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
  const pending = await listPending();
  await Promise.all(pending.map((entry) => clearPending(entry.idempotencyKey)));
});

describe("App", () => {
  it("loads seeded items from GET /sync and renders them", async () => {
    render(<App />);

    expect(await screen.findByText("Parle-G 100g")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("going offline via the toggle and selling an item queues it, without calling fetch again", async () => {
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

describe("App — landing gate", () => {
  it("shows the landing page for a bare visit, and entering a counter loads its data", async () => {
    window.history.pushState({}, "", "/");
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { name: /inventory that never loses a sale/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /counter a/i }));

    expect(await screen.findByText("Parle-G 100g")).toBeInTheDocument();
    expect(window.location.search).toBe("?shop_id=demo-shop&counter_id=counter_a");
  });

  it("a direct link carrying shop_id and counter_id skips the landing page", async () => {
    window.history.pushState({}, "", "/?shop_id=demo-shop&counter_id=counter_b");
    render(<App />);

    expect(await screen.findByText("Parle-G 100g")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /inventory that never loses a sale/i })).not.toBeInTheDocument();
  });
});
