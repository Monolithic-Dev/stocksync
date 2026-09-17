/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    // e2e/** is Playwright's suite (run via `npm run e2e`), not Vitest's —
    // both use *.spec.ts, so this exclusion is required, not cosmetic.
    exclude: ["node_modules/**", "e2e/**"],
  },
});
