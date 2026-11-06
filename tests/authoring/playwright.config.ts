import { defineConfig } from "@playwright/test";

// Explicitly isolated from customer config, auth setup and runtime admission.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 4,
  timeout: 15000,
  expect: { timeout: 3000 },
  use: {
    browserName: "chromium",
    serviceWorkers: "block",
    actionTimeout: 3000,
    navigationTimeout: 3000,
  },
  reporter: "list",
  outputDir: "../../test-results/authoring",
});
