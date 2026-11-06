import { expect } from "@playwright/test";
import type { DraftData } from "./data";
import type { DraftPage } from "./draft-page";

/** A business operation composed from a page, without another inheritance layer. */
export class DraftFlow {
  constructor(private readonly drafts: DraftPage) {}

  async createDraft(data: DraftData): Promise<void> {
    await this.drafts.open();
    await this.drafts.editor.save(data.title);
    await expect(this.drafts.status).toHaveText(`Saved: ${data.title}`);
    await expect(this.drafts.drafts).toHaveText([data.title]);
  }
}
