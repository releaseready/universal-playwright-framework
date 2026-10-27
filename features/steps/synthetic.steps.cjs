const { Given, When, Then } = require("@cucumber/cucumber");
const { expect } = require("@playwright/test");

Given("the demo page is open", async function () {
  this.page = await this.browser.newPage();
  await this.page.goto(this.baseUrl);
});

When("I activate the demo action", async function () {
  await this.page.getByRole("button", { name: "Run demo action" }).click();
});

Then("the page title should be {string}", async function (title) {
  await expect(this.page).toHaveTitle(title);
});

Then("I should see {string}", async function (message) {
  await expect(this.page.getByRole("status")).toHaveText(message);
});
