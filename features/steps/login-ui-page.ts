import type { Page } from "@playwright/test";
import { BasePage } from "../../src/pages/base-page";

export class SyntheticLoginPage extends BasePage {
  constructor(page: Page) {
    super(page, "");
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
}
