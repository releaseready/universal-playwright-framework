/**
 * Navigation component for common navigation interactions
 */

import { Page, Locator } from "@playwright/test";
import { BaseComponent } from "./base-component";

export class NavigationComponent extends BaseComponent {
  private readonly logoLocator: Locator;
  private readonly menuToggleLocator: Locator;
  private readonly userMenuLocator: Locator;
  private readonly logoutButtonLocator: Locator;

  constructor(page: Page) {
    super(page, '[data-testid="navigation"]');

    this.logoLocator = this.rootLocator.locator('[data-testid="logo"]');
    this.menuToggleLocator = this.rootLocator.locator(
      '[data-testid="menu-toggle"]',
    );
    this.userMenuLocator = this.rootLocator.locator(
      '[data-testid="user-menu"]',
    );
    this.logoutButtonLocator = this.rootLocator.locator(
      '[data-testid="logout-button"]',
    );
  }

  /**
   * Click on logo to go home
   */
  async clickLogo(): Promise<void> {
    await this.logoLocator.click();
    this.logger.info("Clicked on logo");
  }

  /**
   * Toggle mobile menu
   */
  async toggleMobileMenu(): Promise<void> {
    await this.menuToggleLocator.click();
    this.logger.info("Toggled mobile menu");
  }

  /**
   * Navigate to a menu item
   */
  async navigateToMenuItem(itemName: string): Promise<void> {
    const menuItem = this.rootLocator.locator(
      `[data-testid="menu-item-${itemName.toLowerCase()}"]`,
    );
    await menuItem.click();
    this.logger.info(`Navigated to menu item: ${itemName}`);
  }

  /**
   * Open user menu
   */
  async openUserMenu(): Promise<void> {
    await this.userMenuLocator.click();
    this.logger.info("Opened user menu");
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    await this.openUserMenu();
    await this.logoutButtonLocator.click();
    this.logger.info("User logged out");
  }

  /**
   * Check if user is logged in
   */
  async isUserLoggedIn(): Promise<boolean> {
    return await this.userMenuLocator.isVisible();
  }
}
