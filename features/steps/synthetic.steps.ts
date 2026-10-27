import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { SyntheticWorld } from "../support/world";

Given("the demo page is open", async function (this: SyntheticWorld) {
  this.page = await this.browser.newPage();
  this.page.setDefaultTimeout(5_000);
  this.page.setDefaultNavigationTimeout(10_000);
  await this.page.goto(this.baseUrl);
});

When("I activate the demo action", async function (this: SyntheticWorld) {
  await this.page!.getByRole("button", { name: "Run demo action" }).click();
});

Then(
  "the page title should be {string}",
  async function (this: SyntheticWorld, title: string) {
    await expect(this.page!).toHaveTitle(title);
  },
);

Then(
  "I should see {string}",
  async function (this: SyntheticWorld, message: string) {
    await expect(this.page!.getByRole("status")).toHaveText(message);
  },
);
