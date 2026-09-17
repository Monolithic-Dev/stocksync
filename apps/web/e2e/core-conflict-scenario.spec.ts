/**
 * The core canonical conflict scenario (US-3, US-4, US-5), driven through
 * the real UI in two independent browser contexts — proving the offline
 * queue, vector-clock/PN-counter merge, and WebSocket push all work
 * together end to end.
 *
 * Runs against the LOCAL dev backend (apps/api/src/local/server.ts,
 * started automatically by playwright.config.ts's webServer), not real
 * deployed AWS infrastructure — see docs/phases/phase-7-integration-
 * demo-scenario.md's note on this being a stand-in while AWS deployment
 * is blocked. The DoD's "run 10x against real infra" and "5x manual
 * rehearsal with a live stack" steps remain pending until that's
 * unblocked; this suite is the closest available substitute.
 *
 * Adaptation from the doc's illustrative numbers: ItemCard's buttons only
 * support unit sales (Sell 1 / Restock 1) — there's no quantity input, by
 * design, per Phase 6's thin-client scope. So "counter A sells 5 then 2,
 * counter B sells 3" becomes "A clicks Sell 1 twice, B clicks Sell 1
 * once" — 3 transactions total (matching the doc's "exactly 3 audit
 * entries" assertion), converging to 47 (50 seeded − 3) instead of the
 * doc's 40. Same mechanism under test, smaller numbers.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const LOCAL_DB_ENV = {
  INVENTORY_RECORDS_TABLE_NAME: "inventory_records_local",
  AUDIT_LOG_TABLE_NAME: "audit_log_local",
  DYNAMODB_ENDPOINT: "http://localhost:8200",
};

/** Restores inventory_records/audit_log to freshly-seeded state before each scenario. */
function resetDemoData(): void {
  execSync("npm run reset:demo", {
    cwd: repoRoot,
    env: { ...process.env, ...LOCAL_DB_ENV },
    stdio: "pipe",
  });
}

async function openCounter(context: BrowserContext, counterId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/?shop_id=demo-shop&counter_id=${counterId}`);
  await expect(page.getByTestId("item-card-parle-g")).toBeVisible();
  return page;
}

/** Network-level offline/online, per the phase-7 doc's task 1 — not the manual UI toggle (that's exercised in apps/web/test/App.test.tsx and in human rehearsal). */
async function setNetworkOffline(page: Page, context: BrowserContext, offline: boolean): Promise<void> {
  await context.setOffline(offline);
  await expect(page.getByRole("button", { name: offline ? /offline/i : /online/i })).toBeVisible({ timeout: 10_000 });
}

async function sell(page: Page, itemId: string, times: number): Promise<void> {
  const button = page.getByTestId(`item-card-${itemId}`).getByRole("button", { name: "Sell 1" });
  for (let i = 0; i < times; i += 1) {
    await button.click();
  }
}

async function editField(page: Page, itemId: string, testId: string, value: string): Promise<void> {
  const field = page.getByTestId(`item-card-${itemId}`).getByTestId(testId);
  await field.click();
  await page.getByTestId(`item-card-${itemId}`).getByTestId(testId).fill(value);
  await page.keyboard.press("Enter");
}

test.describe("US-3: concurrent stock sales converge regardless of arrival order", () => {
  for (const reconnectFirst of ["a", "b"] as const) {
    test(`reconnecting ${reconnectFirst} first still converges to 47`, async ({ browser }) => {
      resetDemoData();

      const contextA = await browser.newContext();
      const contextB = await browser.newContext();
      const pageA = await openCounter(contextA, "counter_a");
      const pageB = await openCounter(contextB, "counter_b");

      await setNetworkOffline(pageA, contextA, true);
      await setNetworkOffline(pageB, contextB, true);

      await sell(pageA, "parle-g", 2);
      await sell(pageB, "parle-g", 1);

      const [firstPage, firstContext, secondPage, secondContext] =
        reconnectFirst === "a" ? [pageA, contextA, pageB, contextB] : [pageB, contextB, pageA, contextA];
      await setNetworkOffline(firstPage, firstContext, false);
      await setNetworkOffline(secondPage, secondContext, false);

      await expect(pageA.getByTestId("item-card-parle-g").getByTestId("stock-value")).toHaveText("47", { timeout: 10_000 });
      await expect(pageB.getByTestId("item-card-parle-g").getByTestId("stock-value")).toHaveText("47", { timeout: 10_000 });

      const auditResponse = await pageA.request.get("http://localhost:4000/audit/parle-g?shop_id=demo-shop");
      const audit = (await auditResponse.json()) as { history: { counter_id: string; action: string }[] };
      expect(audit.history).toHaveLength(3);
      expect(audit.history.every((entry) => entry.action === "sale")).toBe(true);
      expect(audit.history.filter((entry) => entry.counter_id === "counter_a")).toHaveLength(2);
      expect(audit.history.filter((entry) => entry.counter_id === "counter_b")).toHaveLength(1);

      await contextA.close();
      await contextB.close();
    });
  }
});

test("US-4: disjoint field edits from both counters both apply cleanly, no conflict", async ({ browser }) => {
  resetDemoData();

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await openCounter(contextA, "counter_a");
  const pageB = await openCounter(contextB, "counter_b");

  await setNetworkOffline(pageA, contextA, true);
  await setNetworkOffline(pageB, contextB, true);

  await editField(pageA, "parle-g", "shelf-location-value", "Aisle 5");
  await editField(pageB, "parle-g", "price-value", "15");

  await setNetworkOffline(pageA, contextA, false);
  await setNetworkOffline(pageB, contextB, false);

  await expect(pageA.getByTestId("item-card-parle-g").getByTestId("shelf-location-value")).toHaveText("Aisle 5", {
    timeout: 10_000,
  });
  await expect(pageA.getByTestId("item-card-parle-g").getByTestId("price-value")).toHaveText("15", { timeout: 10_000 });
  await expect(pageB.getByTestId("item-card-parle-g").getByTestId("shelf-location-value")).toHaveText("Aisle 5", {
    timeout: 10_000,
  });
  await expect(pageB.getByTestId("item-card-parle-g").getByTestId("price-value")).toHaveText("15", { timeout: 10_000 });

  await expect(pageA.getByTestId("item-card-parle-g")).not.toContainText("Needs review");
  await expect(pageB.getByTestId("item-card-parle-g")).not.toContainText("Needs review");

  await contextA.close();
  await contextB.close();
});

test("US-5: same-field conflicting edits flag for manual review in both contexts", async ({ browser }) => {
  resetDemoData();

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await openCounter(contextA, "counter_a");
  const pageB = await openCounter(contextB, "counter_b");

  await setNetworkOffline(pageA, contextA, true);
  await setNetworkOffline(pageB, contextB, true);

  await editField(pageA, "parle-g", "price-value", "11");
  await editField(pageB, "parle-g", "price-value", "13");

  await setNetworkOffline(pageA, contextA, false);
  await setNetworkOffline(pageB, contextB, false);

  await expect(pageA.getByText('Conflicting "price" value')).toBeVisible({ timeout: 10_000 });
  await expect(pageB.getByText('Conflicting "price" value')).toBeVisible({ timeout: 10_000 });

  await expect(pageA.getByText("counter_a: 11")).toBeVisible();
  await expect(pageA.getByText("counter_b: 13")).toBeVisible();
  await expect(pageB.getByText("counter_a: 11")).toBeVisible();
  await expect(pageB.getByText("counter_b: 13")).toBeVisible();

  await contextA.close();
  await contextB.close();
});
