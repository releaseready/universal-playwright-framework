import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { SyntheticWorld } from "../support/world";
import { SyntheticLoginPage } from "./login-ui-page";

const syntheticPassword = "synthetic-ui-password-8";
const syntheticAccount = "owned-ui-account";
const syntheticOption = "synthetic-option-secret";
const syntheticCookie = "synthetic-cookie-secret";
const syntheticStorageToken = "synthetic-storage-token";
const syntheticUrlToken = "synthetic-url-token";
const syntheticDialogMessage = "synthetic-dialog-private-message";
const syntheticSecrets = [
  syntheticPassword,
  syntheticOption,
  syntheticCookie,
  syntheticStorageToken,
  syntheticUrlToken,
  syntheticDialogMessage,
];

function loginPage(world: SyntheticWorld): SyntheticLoginPage {
  if (!world.page) {
    throw new Error("Owned synthetic login page is unavailable");
  }
  return new SyntheticLoginPage(world.page);
}

async function captureInteractionLogs(
  world: SyntheticWorld,
  run: () => Promise<void>,
): Promise<void> {
  const logs: string[] = [];
  const originalInfo = console.info;
  const originalLogLevel = process.env.LOG_LEVEL;
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  process.env.LOG_LEVEL = "INFO";
  try {
    await run();
  } finally {
    console.info = originalInfo;
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  }
  world.interactionLogs = logs;
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
  "I use shared page helpers with synthetic credentials",
  async function (this: SyntheticWorld) {
    await captureInteractionLogs(this, async () => {
      const target = new URL("login-ui", this.baseUrl);
      target.searchParams.set("access_token", syntheticUrlToken);
      const page = loginPage(this);
      await new SyntheticLoginPage(this.page!, target.href).goto();
      await page.enterPassword(syntheticPassword);
      await page.selectCredential(syntheticOption);
      await page.addSessionCookie(syntheticCookie);
      await page.setAccessToken(syntheticStorageToken);
    });
  },
);

When(
  "I open a synthetic dialog with a private message",
  async function (this: SyntheticWorld) {
    await captureInteractionLogs(this, async () => {
      await this.page!.evaluate((message) => {
        document
          .querySelector("#dialog-trigger")
          ?.setAttribute("data-message", message);
      }, syntheticDialogMessage);
      await loginPage(this).showSyntheticDialog();
    });
  },
);

When(
  "I enter a synthetic password without submitting",
  async function (this: SyntheticWorld) {
    await loginPage(this).enterPassword(syntheticPassword);
  },
);

Then(
  "the emitted interaction logs are redacted",
  function (this: SyntheticWorld) {
    const logs = this.interactionLogs ?? [];
    for (const message of [
      "Navigating to page",
      "Filled input field",
      "Selected dropdown option",
      "Added cookie",
      "Set localStorage item",
    ]) {
      assert.ok(
        logs.some((entry) => entry.includes(message)),
        `expected an interaction log containing "${message}"`,
      );
    }
    assert.equal(
      logs.some((entry) =>
        syntheticSecrets.some((secret) => entry.includes(secret)),
      ),
      false,
    );
  },
);

Then(
  "the dialog interaction log is emitted without its message",
  function (this: SyntheticWorld) {
    const logs = this.interactionLogs ?? [];
    assert.ok(
      logs.some((entry) => entry.includes("Dialog appeared")),
      "expected the dialog interaction to be logged",
    );
    assert.equal(
      logs.some((entry) => entry.includes(syntheticDialogMessage)),
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
