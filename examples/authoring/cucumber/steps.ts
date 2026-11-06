import {
  After,
  Before,
  Given,
  Then,
  When,
  setDefaultTimeout,
  setWorldConstructor,
} from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { waitForVisible } from "../../../src/readiness/wait-for-visible";
import { buildDraft } from "../support/data";
import { appUrl } from "../support/owned-app";
import { DraftWorld } from "./world";

setWorldConstructor(DraftWorld);
setDefaultTimeout(10000);
Before({ timeout: 20000 }, async function (this: DraftWorld) {
  await this.openSession();
});
After({ timeout: 10000 }, async function (this: DraftWorld) {
  await this.closeSession();
});

Given("a fresh synthetic draft workspace", async function (this: DraftWorld) {
  await this.page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await expect(this.page.getByRole("listitem")).toHaveCount(0);
  expect(
    await this.page.evaluate(() => localStorage.getItem("lastDraft")),
  ).toBeNull();
  expect(this.draft).toEqual(buildDraft());
  this.draft.tags.push("scenario-only");
  expect(buildDraft().tags).toEqual(["synthetic"]);
});

When(
  "I save the draft with inline locators",
  async function (this: DraftWorld) {
    await waitForVisible(
      this.page.getByRole("form", { name: "Draft editor", exact: true }),
    );
    await this.page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill(this.draft.title);
    await this.page
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
  },
);

When(
  "I save the draft with the page and editor component",
  async function (this: DraftWorld) {
    await this.drafts.open();
    await this.drafts.editor.save(this.draft.title);
  },
);

When(
  "I create the draft through the business flow",
  async function (this: DraftWorld) {
    await this.flow.createDraft(this.draft);
  },
);

Then("only that draft is saved", async function (this: DraftWorld) {
  await expect(this.page.getByRole("status")).toHaveText(
    `Saved: ${this.draft.title}`,
    { timeout: 3000 },
  );
  await expect(this.page.getByRole("listitem")).toHaveText([this.draft.title]);
  expect(
    await this.page.evaluate(() => localStorage.getItem("lastDraft")),
  ).toBe(this.draft.title);
});
