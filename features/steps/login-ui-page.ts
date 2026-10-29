import type { Page } from "@playwright/test";
import { BasePage } from "../../src/pages/base-page";

export class SyntheticLoginPage extends BasePage {
  constructor(page: Page, url = "") {
    super(page, url);
  }

  async enterAccountName(value: string): Promise<void> {
    await this.fillInput(
      this.page.getByRole("textbox", { name: "Account name" }),
      value,
    );
  }

  async enterPassword(value: string): Promise<void> {
    await this.fillInput(
      this.page.getByRole("textbox", { name: "Password" }),
      value,
    );
  }

  async togglePasswordVisibility(): Promise<void> {
    const show = this.page.getByRole("button", { name: "Show password" });
    const hide = this.page.getByRole("button", { name: "Hide password" });
    await this.clickElement((await hide.isVisible()) ? hide : show);
  }

  async submit(): Promise<void> {
    await this.clickElement(this.page.getByRole("button", { name: "Sign in" }));
  }

  async submitWithEnter(): Promise<void> {
    await this.page.getByRole("textbox", { name: "Password" }).press("Enter");
  }

  async selectCredential(value: string): Promise<void> {
    await this.selectOption(this.page.locator("#credential-select"), value);
  }

  async addSessionCookie(value: string): Promise<void> {
    await this.addCookie("session", value);
  }

  async setAccessToken(value: string): Promise<void> {
    await this.setLocalStorageItem("access_token", value);
  }

  async showSyntheticDialog(): Promise<void> {
    await this.handleDialog();
    await this.clickElement(
      this.page.getByRole("button", { name: "Open dialog" }),
    );
  }
}
