/**
 * Test utilities and helper functions
 */

import { Page } from "@playwright/test";
import { Logger } from "./logger";

const logger = new Logger("TestUtils");

export class TestUtils {
  /**
   * Wait for a specific amount of time
   */
  static async wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  /**
   * Generate random string
   */
  static generateRandomString(length: number = 10): string {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  }

  /**
   * Generate random email
   */
  static generateRandomEmail(domain: string = "example.amazonses.com"): string {
    const randomString = this.generateRandomString(8).toLowerCase();
    return `test-${randomString}@${domain}`;
  }

  /**
   * Generate random phone number
   */
  static generateRandomPhoneNumber(): string {
    const areaCode = Math.floor(Math.random() * 900) + 100;
    const exchange = Math.floor(Math.random() * 900) + 100;
    const number = Math.floor(Math.random() * 9000) + 1000;
    return `${areaCode}-${exchange}-${number}`;
  }

  /**
   * Get current timestamp
   */
  static getCurrentTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  /**
   * Convert string to slug format
   */
  static toSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "") // Remove special characters
      .replace(/[\s_-]+/g, "-") // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
  }

  /**
   * Validate email format
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate phone number format
   */
  static isValidPhoneNumber(phone: string): boolean {
    const phoneRegex = /^\+?[\d\s\-\(\)]+$/;
    return phoneRegex.test(phone) && phone.replace(/\D/g, "").length >= 10;
  }

  /**
   * Format currency
   */
  static formatCurrency(amount: number, currency: string = "USD"): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(amount);
  }

  /**
   * Parse currency string to number
   */
  static parseCurrency(currencyString: string): number {
    return parseFloat(currencyString.replace(/[^0-9.-]+/g, ""));
  }

  /**
   * Get random element from array
   */
  static getRandomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Shuffle array
   */
  static shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Deep clone object
   */
  static deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Retry function with exponential backoff
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          `Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`,
        );

        if (attempt === maxAttempts) {
          break;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.info(`Retrying in ${delay}ms...`);
        await this.wait(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Check if running in CI environment
   */
  static isCI(): boolean {
    return !!process.env.CI;
  }

  /**
   * Get environment variable with default value
   */
  static getEnvVar(name: string, defaultValue: string = ""): string {
    return process.env[name] || defaultValue;
  }

  /**
   * Create test data directory if it doesn't exist
   */
  static async ensureDirectoryExists(dirPath: string): Promise<void> {
    const fs = await import("fs").then((module) => module.promises);
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
      logger.info(`Created directory: ${dirPath}`);
    }
  }

  /**
   * Save data to file
   */
  static async saveToFile(filePath: string, data: any): Promise<void> {
    const fs = await import("fs").then((module) => module.promises);
    const path = await import("path");

    // Ensure directory exists
    await this.ensureDirectoryExists(path.dirname(filePath));

    const content =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, content, "utf8");
    logger.info(`Saved data to file: ${filePath}`);
  }

  /**
   * Load data from file
   */
  static async loadFromFile(filePath: string): Promise<any> {
    const fs = await import("fs").then((module) => module.promises);
    try {
      const content = await fs.readFile(filePath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      logger.error(`Failed to load file: ${filePath}`, error as Error);
      return null;
    }
  }

  /**
   * Take screenshot with custom name
   */
  static async takeScreenshot(page: Page, name: string): Promise<string> {
    const timestamp = this.getCurrentTimestamp();
    const filename = `${name}-${timestamp}.png`;
    const filePath = `screenshots/${filename}`;

    await this.ensureDirectoryExists("screenshots");
    await page.screenshot({ path: filePath, fullPage: true });

    logger.info(`Screenshot saved: ${filePath}`);
    return filePath;
  }

  /**
   * Get viewport size
   */
  static async getViewportSize(
    page: Page,
  ): Promise<{ width: number; height: number }> {
    return await page.evaluate(() => {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    });
  }

  /**
   * Scroll to bottom of page
   */
  static async scrollToBottom(page: Page): Promise<void> {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  }

  /**
   * Scroll to top of page
   */
  static async scrollToTop(page: Page): Promise<void> {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
  }

  /**
   * Get page performance metrics
   */
  static async getPerformanceMetrics(page: Page): Promise<any> {
    return await page.evaluate(() => {
      const perfData = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded:
          perfData.domContentLoadedEventEnd -
          perfData.domContentLoadedEventStart,
        loadComplete: perfData.loadEventEnd - perfData.loadEventStart,
        firstPaint: performance.getEntriesByType("paint")[0]?.startTime || 0,
        firstContentfulPaint:
          performance.getEntriesByType("paint")[1]?.startTime || 0,
      };
    });
  }
}
