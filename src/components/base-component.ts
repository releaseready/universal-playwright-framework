/**
 * Base component class for reusable UI components
 * Common components that appear across multiple pages
 */

import { Locator, Page } from "@playwright/test";
import { Logger } from "@utils/logger";

export abstract class BaseComponent {
  protected page: Page;
  protected logger: Logger;
  protected rootLocator: Locator;

  constructor(page: Page, rootSelector: string) {
    this.page = page;
    this.rootLocator = page.locator(rootSelector);
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Check if component is visible
   */
  async isVisible(): Promise<boolean> {
    try {
      await this.rootLocator.waitFor({ state: "visible", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for component to be visible
   */
  async waitForComponent(timeout: number = 30000): Promise<void> {
    await this.rootLocator.waitFor({ state: "visible", timeout });
    this.logger.info(`${this.constructor.name} component is visible`);
  }

  /**
   * Wait for component to be hidden
   */
  async waitForComponentToHide(timeout: number = 30000): Promise<void> {
    await this.rootLocator.waitFor({ state: "hidden", timeout });
    this.logger.info(`${this.constructor.name} component is hidden`);
  }

  /**
   * Get component text content
   */
  async getComponentText(): Promise<string> {
    const text = await this.rootLocator.textContent();
    return text?.trim() || "";
  }

  /**
   * Take screenshot of component
   */
  async takeComponentScreenshot(name?: string): Promise<Buffer> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename =
      name || `${this.constructor.name.toLowerCase()}-${timestamp}`;
    return await this.rootLocator.screenshot({
      path: `screenshots/components/${filename}.png`,
    });
  }
}
