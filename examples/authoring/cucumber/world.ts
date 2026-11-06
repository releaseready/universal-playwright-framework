import { World } from "@cucumber/cucumber";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { buildDraft } from "../support/data";
import { DraftPage } from "../support/draft-page";
import { DraftFlow } from "../support/draft-flow";
import { installOwnedApp } from "../support/owned-app";

/** Scenario-owned lifecycle adapter. Business operations know nothing of Cucumber. */
export class DraftWorld extends World {
  browser?: Browser;
  context?: BrowserContext;
  page!: Page;
  drafts!: DraftPage;
  flow!: DraftFlow;
  draft = buildDraft();

  private setup?: Promise<void>;
  private closing = false;

  protected launchBrowser(): Promise<Browser> {
    return chromium.launch({ timeout: 5000 });
  }

  openSession(): Promise<void> {
    if (this.setup || this.closing)
      throw new Error("Draft session already started or closing");
    this.setup = this.initialize();
    return this.setup;
  }

  private ensureOpen(): void {
    if (this.closing) throw new Error("Draft setup interrupted by cleanup");
  }

  private async initialize(): Promise<void> {
    this.browser = await this.launchBrowser();
    this.ensureOpen();
    this.context = await this.browser.newContext({ serviceWorkers: "block" });
    this.ensureOpen();
    this.context.setDefaultTimeout(3000);
    this.context.setDefaultNavigationTimeout(3000);
    const app = await installOwnedApp(this.context);
    this.ensureOpen();
    this.page = await this.context.newPage();
    this.ensureOpen();
    this.drafts = new DraftPage(this.page, app.url);
    this.flow = new DraftFlow(this.drafts);
  }

  async closeSession(): Promise<void> {
    this.closing = true;
    // Cucumber cannot cancel a timed-out Before promise. Wait for acquisition to
    // settle, then close even late resources. A stuck setup makes After time out;
    // it must never emit a false cleanup confirmation.
    await this.setup?.catch(() => undefined);
    const errors: unknown[] = [];
    try {
      await this.context?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.browser?.close();
    } catch (error) {
      errors.push(error);
    }
    const closed =
      !this.browser?.isConnected() && (this.context?.pages().length ?? 0) === 0;
    await this.attach(
      JSON.stringify({ ownedAuthoringCleanup: closed && errors.length === 0 }),
      "application/json",
    );
    if (!closed)
      errors.push(new Error("Owned authoring browser/context remains open"));
    if (errors.length)
      throw new AggregateError(errors, "Owned authoring cleanup failed");
  }
}
