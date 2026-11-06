import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildDraft, type DraftData } from "./data";
import { DraftPage } from "./draft-page";
import { DraftFlow } from "./draft-flow";

export const appUrl = "http://authoring.invalid/";
type Fixtures = {
  ownedApp: { url: string; trafficRequests: () => number };
  draft: DraftData;
  drafts: DraftPage;
  flow: DraftFlow;
};

// Playwright owns a fresh page/context for every test, including retries.
export const test = base.extend<Fixtures>({
  ownedApp: async ({ page }, use) => {
    const html = await readFile(path.join(__dirname, "app.html"), "utf8");
    let traffic = 0;
    await page.context().route("**/*", async (route) => {
      const url = route.request().url();
      if (url === appUrl) {
        await route.fulfill({ contentType: "text/html", body: html });
      } else if (url === `${appUrl}telemetry`) {
        traffic += 1;
        await route.fulfill({ status: 200, body: "synthetic" });
      } else {
        await route.abort("blockedbyclient");
      }
    });
    await use({ url: appUrl, trafficRequests: () => traffic });
  },
  // Playwright requires destructuring even for a fixture with no dependencies.
  // eslint-disable-next-line no-empty-pattern
  draft: async ({}, use) => {
    await use(buildDraft());
  },
  drafts: async ({ page, ownedApp }, use) => {
    await use(new DraftPage(page, ownedApp.url));
  },
  flow: async ({ drafts }, use) => {
    await use(new DraftFlow(drafts));
  },
});

export { expect };
