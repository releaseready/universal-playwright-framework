/**
 * Base Page class that all page objects should extend
 * Provides common functionality and utilities for page interactions
 */

import { Page, Locator, expect } from "@playwright/test";
import { Logger } from "../utils/logger";

export abstract class BasePage {
  protected page: Page;
  protected logger: Logger;
  protected url: string;

  constructor(page: Page, url: string = "") {
    this.page = page;
    this.url = url;
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Navigate to the page
   */
  async goto(): Promise<void> {
    this.logger.info(`Navigating to ${this.url}`);
    await this.page.goto(this.url);
    await this.waitForPageLoad();
  }

  /**
   * Wait for page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
    await this.page.waitForLoadState("domcontentloaded");
  }

  /**
   * Get page title
   */
  async getTitle(): Promise<string> {
    return await this.page.title();
  }

  /**
   * Get current URL
   */
  getCurrentUrl(): string {
    return this.page.url();
  }

  /**
   * Take screenshot
   */
  async takeScreenshot(name?: string): Promise<Buffer> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = name || `screenshot-${timestamp}`;
    this.logger.info(`Taking screenshot: ${filename}`);
    return await this.page.screenshot({
      path: `screenshots/${filename}.png`,
      fullPage: true,
    });
  }

  /**
   * Wait for element to be visible
   */
  async waitForElement(
    locator: Locator,
    timeout: number = 30000,
  ): Promise<void> {
    await locator.waitFor({ state: "visible", timeout });
  }

  /**
   * Wait for element to be hidden
   */
  async waitForElementToHide(
    locator: Locator,
    timeout: number = 30000,
  ): Promise<void> {
    await locator.waitFor({ state: "hidden", timeout });
  }

  /**
   * Click element with retry logic
   */
  async clickElement(
    locator: Locator,
    options?: { timeout?: number; force?: boolean },
  ): Promise<void> {
    await this.waitForElement(locator);
    await locator.click(options);
    this.logger.info(`Clicked element: ${locator}`);
  }

  /**
   * Fill input field
   */
  async fillInput(
    locator: Locator,
    value: string,
    options?: { clear?: boolean },
  ): Promise<void> {
    await this.waitForElement(locator);
    if (options?.clear) {
      await locator.clear();
    }
    await locator.fill(value);
    this.logger.info(`Filled input with value: ${value}`);
  }

  /**
   * Select option from dropdown
   */
  async selectOption(
    locator: Locator,
    value: string | string[],
  ): Promise<void> {
    await this.waitForElement(locator);
    await locator.selectOption(value);
    this.logger.info(`Selected option: ${value}`);
  }

  /**
   * Get text content of element
   */
  async getElementText(locator: Locator): Promise<string> {
    await this.waitForElement(locator);
    const text = await locator.textContent();
    return text?.trim() || "";
  }

  /**
   * Check if element is visible
   */
  async isElementVisible(locator: Locator): Promise<boolean> {
    try {
      await locator.waitFor({ state: "visible", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if element exists in DOM
   */
  async isElementPresent(locator: Locator): Promise<boolean> {
    try {
      await locator.waitFor({ state: "attached", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for URL to change
   */
  async waitForUrlChange(
    expectedUrl?: string,
    timeout: number = 30000,
  ): Promise<void> {
    if (expectedUrl) {
      await this.page.waitForURL(expectedUrl, { timeout });
    } else {
      // Wait for any URL change
      const currentUrl = this.getCurrentUrl();
      await this.page.waitForURL((url) => url.toString() !== currentUrl, {
        timeout,
      });
    }
  }

  /**
   * Scroll element into view
   */
  async scrollToElement(locator: Locator): Promise<void> {
    await locator.scrollIntoViewIfNeeded();
    this.logger.info(`Scrolled to element: ${locator}`);
  }

  /**
   * Hover over element
   */
  async hoverElement(locator: Locator): Promise<void> {
    await this.waitForElement(locator);
    await locator.hover();
    this.logger.info(`Hovered over element: ${locator}`);
  }

  /**
   * Double click element
   */
  async doubleClickElement(locator: Locator): Promise<void> {
    await this.waitForElement(locator);
    await locator.dblclick();
    this.logger.info(`Double clicked element: ${locator}`);
  }

  /**
   * Right click element
   */
  async rightClickElement(locator: Locator): Promise<void> {
    await this.waitForElement(locator);
    await locator.click({ button: "right" });
    this.logger.info(`Right clicked element: ${locator}`);
  }

  /**
   * Upload file
   */
  async uploadFile(locator: Locator, filePath: string): Promise<void> {
    await locator.setInputFiles(filePath);
    this.logger.info(`Uploaded file: ${filePath}`);
  }

  /**
   * Handle dialog (alert, confirm, prompt)
   */
  async handleDialog(
    accept: boolean = true,
    promptText?: string,
  ): Promise<void> {
    this.page.on("dialog", async (dialog) => {
      this.logger.info(`Dialog appeared: ${dialog.message()}`);
      if (dialog.type() === "prompt" && promptText) {
        await dialog.accept(promptText);
      } else if (accept) {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
  }

  /**
   * Wait for and handle new page/tab
   */
  async handleNewPage(): Promise<Page> {
    const [newPage] = await Promise.all([
      this.page.context().waitForEvent("page"),
    ]);
    await newPage.waitForLoadState();
    this.logger.info("New page opened");
    return newPage;
  }

  /**
   * Reload page
   */
  async reloadPage(): Promise<void> {
    await this.page.reload();
    await this.waitForPageLoad();
    this.logger.info("Page reloaded");
  }

  /**
   * Go back in browser history
   */
  async goBack(): Promise<void> {
    await this.page.goBack();
    await this.waitForPageLoad();
    this.logger.info("Navigated back");
  }

  /**
   * Go forward in browser history
   */
  async goForward(): Promise<void> {
    await this.page.goForward();
    await this.waitForPageLoad();
    this.logger.info("Navigated forward");
  }

  /**
   * Get all cookies
   */
  async getCookies() {
    return await this.page.context().cookies();
  }

  /**
   * Add cookie
   */
  async addCookie(name: string, value: string, domain?: string) {
    await this.page.context().addCookies([
      {
        name,
        value,
        domain: domain || new URL(this.page.url()).hostname,
        path: "/",
      },
    ]);
    this.logger.info(`Added cookie: ${name}=${value}`);
  }

  /**
   * Clear all cookies
   */
  async clearCookies(): Promise<void> {
    await this.page.context().clearCookies();
    this.logger.info("Cleared all cookies");
  }

  /**
   * Execute JavaScript
   */
  async executeScript(script: string, ...args: any[]): Promise<any> {
    return await this.page.evaluate(script, ...args);
  }

  /**
   * Get local storage item
   */
  async getLocalStorageItem(key: string): Promise<string | null> {
    return await this.page.evaluate((key) => localStorage.getItem(key), key);
  }

  /**
   * Set local storage item
   */
  async setLocalStorageItem(key: string, value: string): Promise<void> {
    await this.page.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key, value },
    );
    this.logger.info(`Set localStorage: ${key}=${value}`);
  }

  /**
   * Clear local storage
   */
  async clearLocalStorage(): Promise<void> {
    await this.page.evaluate(() => localStorage.clear());
    this.logger.info("Cleared localStorage");
  }
}
