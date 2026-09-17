/**
 * Reproduces the canonical US-3 conflict scenario (counter A sells 5 then
 * 2, counter B sells 3, both offline, converge to 40) via direct API
 * calls — no browser needed. For fast iteration when debugging a
 * resolution issue without waiting on the full UI flow.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:4000 npm run simulate:conflict
 *   API_BASE_URL=http://localhost:4000 npm run simulate:conflict -- --reconnect-order=b-first
 */
import { randomUUID } from "node:crypto";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";
const API_KEY = process.env.API_KEY ?? "local-e2e-key";
const SHOP_ID = process.env.SHOP_ID ?? "demo-shop";
const ITEM_ID = process.env.ITEM_ID ?? "parle-g";

interface SaleTxn {
  idempotency_key: string;
  item_id: string;
  type: "sale";
  quantity: number;
  client_vector_clock: Record<string, number>;
  client_timestamp: string;
}

function buildSale(counterId: string, clock: number, quantity: number): SaleTxn {
  return {
    idempotency_key: randomUUID(),
    item_id: ITEM_ID,
    type: "sale",
    quantity,
    client_vector_clock: { [counterId]: clock },
    client_timestamp: new Date().toISOString(),
  };
}

async function post(counterId: string, transactions: SaleTxn[]): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ shop_id: SHOP_ID, counter_id: counterId, transactions }),
  });
  if (!response.ok) throw new Error(`POST /transactions failed: ${response.status}`);
  return response.json();
}

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { "x-api-key": API_KEY } });
  if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`);
  return response.json();
}

async function main(): Promise<void> {
  const reconnectOrder = process.argv.includes("--reconnect-order=b-first") ? "b-first" : "a-first";
  console.log(`Simulating: A sells 5 then 2 (offline), B sells 3 (offline), reconnecting ${reconnectOrder}`);

  const aTxns = [buildSale("counter_a", 1, 5), buildSale("counter_a", 2, 2)];
  const bTxns = [buildSale("counter_b", 1, 3)];

  if (reconnectOrder === "a-first") {
    await post("counter_a", aTxns);
    await post("counter_b", bTxns);
  } else {
    await post("counter_b", bTxns);
    await post("counter_a", aTxns);
  }

  // The write queue processes asynchronously — give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const sync = (await get(`/sync?shop_id=${SHOP_ID}&counter_id=counter_a`)) as { items: { item_id: string; stock: number }[] };
  const item = sync.items.find((i) => i.item_id === ITEM_ID);
  console.log(`Final stock for ${ITEM_ID}: ${item?.stock} (expected 40 starting from the seeded 50)`);

  const audit = (await get(`/audit/${ITEM_ID}?shop_id=${SHOP_ID}`)) as { history: unknown[] };
  console.log(`Audit trail (${audit.history.length} entries):`);
  console.log(JSON.stringify(audit.history, null, 2));
}

main().catch((error: unknown) => {
  console.error("Simulation failed:", error);
  process.exit(1);
});
