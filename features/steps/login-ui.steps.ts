import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { SyntheticWorld } from "../support/world";
import { SyntheticLoginPage } from "./login-ui-page";

const syntheticPassword = "synthetic-ui-password-8";
const syntheticAccount = "owned-ui-account";

function loginPage(world: SyntheticWorld): SyntheticLoginPage {
  if (!world.page) {
    throw new Error("Owned synthetic login page is unavailable");
  }
  return new SyntheticLoginPage(world.page);
}

Given(
  "the locally served synthetic login form is open",
  async function (this: SyntheticWorld) {
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(5_000);
    this.page.setDefaultNavigationTimeout(10_000);
    await this.page.goto(new URL("login-ui", this.baseUrl).href);
  },
);

When(
  "I enter a synthetic password without submitting",
  async function (this: SyntheticWorld) {
    const logs: string[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await loginPage(this).enterPassword(syntheticPassword);
    } finally {
      console.info = originalInfo;
    }
    this.interactionLogs = logs;
  },
);

Then(
  "the interaction logs do not contain the synthetic password",
  function (this: SyntheticWorld) {
    assert.equal(
      this.interactionLogs?.some((entry) => entry.includes(syntheticPassword)),
      false,
    );
  },
);

Then("the password is masked", async function (this: SyntheticWorld) {
  await expect(
    this.page!.getByRole("textbox", { name: "Password" }),
  ).toHaveAttribute("type", "password");
});

When(
  "I reveal the password with the shared page interaction helper",
  async function (this: SyntheticWorld) {
    await loginPage(this).togglePasswordVisibility();
  },
);

When(
  "I hide the password with the shared page interaction helper",
  async function (this: SyntheticWorld) {
    await loginPage(this).togglePasswordVisibility();
  },
);

Then(
  "the password is visible and its synthetic value is unchanged",
  async function (this: SyntheticWorld) {
    await expect(
      this.page!.getByRole("textbox", { name: "Password" }),
    ).toHaveAttribute("type", "text");
    await expect(
      this.page!.getByRole("textbox", { name: "Password" }),
    ).toHaveValue(syntheticPassword);
  },
);

Then(
  "the password is masked and the form has not been submitted",
  async function (this: SyntheticWorld) {
    await expect(
      this.page!.getByRole("textbox", { name: "Password" }),
    ).toHaveAttribute("type", "password");
    await expect(this.page!.locator("#login-form")).toHaveAttribute(
      "data-submissions",
      "0",
    );
  },
);

When(
  "I focus and activate the visibility control with the keyboard",
  async function (this: SyntheticWorld) {
    const account = this.page!.getByRole("textbox", { name: "Account name" });
    await account.focus();
    await this.page!.keyboard.press("Tab");
    await this.page!.keyboard.press("Tab");
    await this.page!.keyboard.press("Space");
  },
);

Then(
  "the visibility control is accessible and visibly focused",
  async function (this: SyntheticWorld) {
    const toggle = this.page!.locator("#toggle-password");
    await expect(toggle).toHaveAttribute("aria-label", "Hide password");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    assert.equal(
      await toggle.evaluate((element) => element === document.activeElement),
      true,
    );
    assert.equal(
      await toggle.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
      "solid",
    );
  },
);

Then(
  "the password is revealed without submitting the form",
  async function (this: SyntheticWorld) {
    await expect(
      this.page!.getByRole("textbox", { name: "Password" }),
    ).toHaveAttribute("type", "text");
    await expect(
      this.page!.getByRole("textbox", { name: "Password" }),
    ).toHaveValue(syntheticPassword);
    await expect(this.page!.locator("#login-form")).toHaveAttribute(
      "data-submissions",
      "0",
    );
  },
);

When(
  "I submit the empty form with the shared page interaction helper",
  async function (this: SyntheticWorld) {
    await loginPage(this).submit();
  },
);

Then(
  "both required fields report missing values",
  async function (this: SyntheticWorld) {
    const account = this.page!.getByRole("textbox", { name: "Account name" });
    const password = this.page!.getByRole("textbox", { name: "Password" });
    await expect(account).toHaveAttribute("required", "");
    await expect(password).toHaveAttribute("required", "");
    assert.equal(
      await account.evaluate(
        (input) => (input as HTMLInputElement).validity.valueMissing,
      ),
      true,
    );
    assert.equal(
      await password.evaluate(
        (input) => (input as HTMLInputElement).validity.valueMissing,
      ),
      true,
    );
    assert.notEqual(
      await account.evaluate(
        (input) => (input as HTMLInputElement).validationMessage,
      ),
      "",
    );
    assert.notEqual(
      await password.evaluate(
        (input) => (input as HTMLInputElement).validationMessage,
      ),
      "",
    );
  },
);

Then("the form has not been submitted", async function (this: SyntheticWorld) {
  await expect(this.page!.locator("#login-form")).toHaveAttribute(
    "data-submissions",
    "0",
  );
});

When(
  "I enter synthetic account details and press Enter",
  async function (this: SyntheticWorld) {
    const page = loginPage(this);
    await page.enterAccountName(syntheticAccount);
    await page.enterPassword(syntheticPassword);
    await page.submitWithEnter();
  },
);

Then(
  "the local form records exactly one submission",
  async function (this: SyntheticWorld) {
    await expect(this.page!.locator("#login-form")).toHaveAttribute(
      "data-submissions",
      "1",
    );
    await expect(this.page!.getByRole("status")).toHaveText(
      "Local form submitted",
    );
  },
);
