import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { ExecutionWorld } from "./support/world";

Given(
  "the synthetic reviewed page is open",
  async function (this: ExecutionWorld) {
    if (!this.page || !this.payload) {
      throw new Error("Synthetic browser context is unavailable");
    }
    const target = new URL(this.payload.environment.initialTargetUrl);
    if (target.origin !== this.payload.environment.approvedOrigin) {
      throw new Error("Synthetic navigation is outside the approved origin");
    }
    await this.page.goto(target.href);
  },
);

When(
  "I enter the prepared display name",
  async function (this: ExecutionWorld) {
    const name = this.payload?.scenario.values.displayName;
    if (!this.page || typeof name !== "string") {
      throw new Error("Prepared display name is unavailable");
    }
    await this.page.getByLabel("Display name").fill(name);
    await this.page.getByRole("button", { name: "Continue" }).click();
  },
);

Then(
  "the synthetic page confirms the prepared display name",
  async function (this: ExecutionWorld) {
    const name = this.payload?.scenario.values.displayName;
    if (!this.page || typeof name !== "string") {
      throw new Error("Prepared display name is unavailable");
    }
    await expect(this.page.getByRole("status")).toHaveText(`Welcome, ${name}`);
  },
);

Then(
  "the synthetic status says {string}",
  async function (this: ExecutionWorld, expected: string) {
    if (!this.page) {
      throw new Error("Synthetic browser page is unavailable");
    }
    await expect(this.page.getByRole("status")).toHaveText(expected);
  },
);

Then(
  "the synthetic status matches its retry attempt",
  async function (this: ExecutionWorld) {
    const name = this.payload?.scenario.values.displayName;
    if (!this.page || typeof name !== "string") {
      throw new Error("Prepared display name is unavailable");
    }
    const expected =
      process.env.WEB_EXECUTION_TEST_ASSERTION_MISMATCH === "1"
        ? "Welcome, a different visitor"
        : `Welcome, ${name}`;
    await expect(this.page.getByRole("status")).toHaveText(expected);
  },
);

Given("the scenario is explicitly pending", function () {
  return "pending";
});

When(
  "I wait for {int} milliseconds",
  async function (this: ExecutionWorld, milliseconds: number) {
    if (!this.page || milliseconds < 0 || milliseconds > 10_000) {
      throw new Error("Synthetic wait exceeds its reviewed bound");
    }
    await this.page.waitForTimeout(milliseconds);
  },
);

When(
  "I follow a redirect to an unapproved target",
  async function (this: ExecutionWorld) {
    if (!this.page || !this.payload) {
      throw new Error("Synthetic browser page is unavailable");
    }
    let navigationFailed = false;
    try {
      await this.page.goto(
        new URL("/redirect", this.payload.environment.approvedOrigin).href,
      );
    } catch {
      navigationFailed = true;
    }
    this.redirectNavigationBlocked = navigationFailed;
  },
);

Then("the unapproved navigation was blocked", function (this: ExecutionWorld) {
  assert.equal(this.redirectNavigationBlocked, true);
  assert.deepEqual(this.blockedDestinations, [this.payload?.redirectTargetUrl]);
  assert.equal(this.page?.url(), this.payload?.environment.initialTargetUrl);
});
