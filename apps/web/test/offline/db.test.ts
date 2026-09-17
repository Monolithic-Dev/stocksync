import { afterEach, describe, expect, it } from "vitest";
import { clearPending, enqueue, listPending } from "../../src/offline/db";

const basePayload = {
  item_id: "parle-g",
  type: "sale" as const,
  quantity: 5,
  client_vector_clock: { counter_a: 1 },
  client_timestamp: "2026-09-17T10:00:00.000Z",
};

// db.ts caches its IndexedDB connection at module scope (by design — a
// real app opens it once), so tests share one store across this file.
// Draining it after each test keeps them isolated without fighting that
// caching.
afterEach(async () => {
  const pending = await listPending();
  await Promise.all(pending.map((entry) => clearPending(entry.idempotencyKey)));
});

describe("offline/db", () => {
  it("enqueues and lists pending transactions oldest first", async () => {
    await enqueue("key-1", { ...basePayload, idempotency_key: "key-1" });
    await enqueue("key-2", { ...basePayload, idempotency_key: "key-2", item_id: "rice-5kg" });

    const pending = await listPending();
    expect(pending.map((p) => p.idempotencyKey)).toEqual(["key-1", "key-2"]);
  });

  it("enqueuing the same idempotencyKey twice overwrites rather than duplicates (edge case C-1)", async () => {
    await enqueue("key-1", { ...basePayload, idempotency_key: "key-1", quantity: 5 });
    await enqueue("key-1", { ...basePayload, idempotency_key: "key-1", quantity: 7 });

    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.quantity).toBe(7);
  });

  it("clearPending removes exactly the given entry", async () => {
    await enqueue("key-1", { ...basePayload, idempotency_key: "key-1" });
    await enqueue("key-2", { ...basePayload, idempotency_key: "key-2" });

    await clearPending("key-1");

    const pending = await listPending();
    expect(pending.map((p) => p.idempotencyKey)).toEqual(["key-2"]);
  });

  it("listPending returns an empty array when nothing is queued", async () => {
    const pending = await listPending();
    expect(pending).toEqual([]);
  });
});
