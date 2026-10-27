/**
 * Generic authentication setup for tests
 * This runs before other tests to set up authentication state
 *
 * CUSTOMIZE THIS FILE FOR YOUR APP:
 * - Update selectors to match your login form
 * - Update the expected post-login URL
 * - Modify test data generation as needed
 */

import { test as setup, expect } from "@playwright/test";
import { TestDataFactory } from "@fixtures/test-data-factory";
import { Logger } from "@utils/logger";

const authFile = "playwright/.auth/user.json";
const logger = new Logger("AuthSetup");

setup("authenticate", async ({ page }) => {
  logger.info("Starting authentication setup...");

  // Generate test user data - customize for your app
  const userData = TestDataFactory.generateUser("fan");

  try {
    // Navigate to your app's login page
    await page.goto("/login"); // 👈 Update this path for your app

    // Perform login - customize selectors for your app
    await page.fill('[data-testid="email"]', userData.email); // 👈 Update selector
    await page.fill('[data-testid="password"]', userData.password); // 👈 Update selector
    await page.click('[data-testid="login-button"]'); // 👈 Update selector

    // Wait for successful login - update URL for your app
    await page.waitForURL("/dashboard"); // 👈 Update expected URL

    // Verify login was successful - update selector for your app
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible(); // 👈 Update selector

    // Save authentication state
    await page.context().storageState({ path: authFile });

    logger.info("Authentication setup completed successfully");
  } catch (error) {
    logger.error("Authentication setup failed", error as Error);
    throw error;
  }
});
