import type { Page } from "@playwright/test";
import { BasePage } from "../../../src/pages/base-page";
import { BaseComponent } from "../../../src/components/base-component";

export class DraftEditor extends BaseComponent {
  constructor(page: Page) {
    super(page, 'form[aria-label="Draft editor"]');
  }

  async save(title: string): Promise<void> {
    await this.rootLocator
      .getByRole("textbox", { name: "Title", exact: true })
      .fill(title);
    await this.rootLocator
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
  }
}

export class DraftPage extends BasePage {
  readonly editor: DraftEditor;
  readonly status;
  readonly drafts;

  constructor(page: Page, url: string) {
    super(page, url);
    this.editor = new DraftEditor(page);
    this.status = page.getByRole("status");
    this.drafts = page
      .getByRole("list", { name: "Drafts", exact: true })
      .getByRole("listitem");
  }

  async open(): Promise<void> {
    await this.goto();
    await this.waitForReady(
      this.page.getByRole("form", { name: "Draft editor", exact: true }),
    );
  }
}
