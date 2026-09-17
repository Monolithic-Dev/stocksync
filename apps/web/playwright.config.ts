import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Runs the core conflict scenario against the local dev backend
 * (apps/api/src/local/server.ts), not real deployed AWS infrastructure —
 * see docs/phases/phase-7-integration-demo-scenario.md's note on this
 * being a stand-in while AWS deployment is blocked. Both servers are
 * started and torn down automatically per run.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // tests share one local backend/DB — no cross-test isolation otherwise
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev:local-server",
      cwd: path.resolve(__dirname, "../api"),
      url: "http://localhost:4000/sync?shop_id=demo-shop&counter_id=counter_a",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000, // covers a cold DynamoDB Local JVM start
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev",
      cwd: __dirname,
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_API_BASE_URL: "http://localhost:4000",
        VITE_WEBSOCKET_URL: "ws://localhost:4001",
        VITE_API_KEY: "local-e2e-key",
      },
    },
  ],
});
