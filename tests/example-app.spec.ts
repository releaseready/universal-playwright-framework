/**
 * Generic example test demonstrating framework usage
 *
 * This is a template showing how to use the framework.
 * Copy this pattern to create tests for your specific application.
 *
 * TO CUSTOMIZE FOR YOUR APP:
 * 1. Update the page URLs and selectors
 * 2. Modify test data to match your app's data model
 * 3. Adjust assertions to match your app's behavior
 */

import { test, expect } from "@playwright/test";
import { TestDataFactory } from "@fixtures/test-data-factory";
import { BasePage } from "@/pages/base-page";

// Example page object for your app - customize this
class ExamplePage extends BasePage {
  constructor(page: any) {
    super(page, "/"); // 👈 Update with your app's home page path
  }

  async getPageTitle(): Promise<string> {
    // 👈 Update selector to match your app's title element
    return await this.getElementText(this.page.locator("h1").first());
  }

  async getPageUrl(): Promise<string> {
    return this.getCurrentUrl();
  }
}

test.describe("Example App Tests", () => {
  test.describe("Homepage", () => {
    test("should display homepage correctly", async ({ page }) => {
      const examplePage = new ExamplePage(page);

      await examplePage.goto();

      // 👈 Customize these assertions for your app
      await expect(page).toHaveTitle(/Example Domain/); // Update expected title

      const pageUrl = await examplePage.getPageUrl();
      expect(pageUrl).toContain("example.com");
    });

    test("should load page content", async ({ page }) => {
      const examplePage = new ExamplePage(page);

      await examplePage.goto();

      // Check if page has loaded
      const pageTitle = await examplePage.getPageTitle();
      expect(pageTitle).toBeTruthy();

      console.log("Page title:", pageTitle);
    });
  });

  test.describe("User Data Integration", () => {
    test("should work with generated test data", async ({ page }) => {
      // Generate test data using the framework's factory
      const userData = TestDataFactory.generateUser("fan");

      // Use the data in your test
      console.log("Generated test user:", userData.email);

      const examplePage = new ExamplePage(page);
      await examplePage.goto();

      // Verify page loads with generated data context
      const pageUrl = await examplePage.getPageUrl();
      expect(pageUrl).toBeTruthy();
    });
  });

  test.describe("Responsive Design", () => {
    test("should work on mobile devices", async ({ page }) => {
      // Test mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      const examplePage = new ExamplePage(page);
      await examplePage.goto();

      // 👈 Add mobile-specific assertions for your app
      const title = await examplePage.getPageTitle();
      expect(title).toBeTruthy();

      console.log("Mobile test completed for:", title);
    });
  });
});

/**
 * HOW TO USE THIS TEMPLATE:
 *
 * 1. Copy this file to your app's tests directory
 * 2. Rename it to match your feature (e.g., 'user-authentication.spec.ts')
 * 3. Update all the commented sections (marked with 👈)
 * 4. Replace selectors with your app's actual selectors
 * 5. Update URLs to match your app's routing
 * 6. Customize test data generation for your app's needs
 * 7. Add app-specific assertions and test scenarios
 *
 * REMEMBER:
 * - Use data-testid attributes for reliable element selection
 * - Keep tests independent and isolated
 * - Use the Page Object Model pattern for maintainable tests
 * - Generate test data instead of hardcoding values
 */
