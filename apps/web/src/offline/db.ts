import { openDB, type IDBPDatabase } from "idb";
import type { TransactionInput } from "@stocksync/core";

const DB_NAME = "stocksync-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "pending_transactions";
const IDEMPOTENCY_INDEX = "byIdempotencyKey";

export interface PendingTransaction {
  idempotencyKey: string;
  payload: TransactionInput;
  queuedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | undefined;

function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Primary key is an auto-incrementing sequence, not idempotencyKey
      // itself — this makes listPending()'s ordering exact (true insertion
      // order) rather than sorted by a wall-clock ISO string, which can
      // collide under two rapid enqueues within the same millisecond and
      // would then silently fall back to an arbitrary tiebreak, violating
      // replay's "oldest first" requirement. idempotencyKey is a separate
      // unique index, used only for the overwrite/delete lookups below.
      const store = db.createObjectStore(STORE_NAME, { keyPath: "seq", autoIncrement: true });
      store.createIndex(IDEMPOTENCY_INDEX, "idempotencyKey", { unique: true });
    },
  });
  return dbPromise;
}

/**
 * Idempotent by design: enqueuing the same idempotencyKey twice replaces
 * the existing entry rather than duplicating it — this is what makes it
 * safe for edge case C-1 (a request whose response never arrived) to be
 * requeued under the same key without producing two queue entries for one
 * logical action.
 */
export async function enqueue(idempotencyKey: string, payload: TransactionInput): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const existingSeq = await tx.store.index(IDEMPOTENCY_INDEX).getKey(idempotencyKey);
  if (existingSeq !== undefined) {
    await tx.store.delete(existingSeq);
  }
  await tx.store.add({ idempotencyKey, payload, queuedAt: new Date().toISOString() });
  await tx.done;
}

/** Oldest first — replay must preserve the order transactions were created in. */
export async function listPending(): Promise<PendingTransaction[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

export async function clearPending(idempotencyKey: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const existingSeq = await tx.store.index(IDEMPOTENCY_INDEX).getKey(idempotencyKey);
  if (existingSeq !== undefined) {
    await tx.store.delete(existingSeq);
  }
  await tx.done;
}
