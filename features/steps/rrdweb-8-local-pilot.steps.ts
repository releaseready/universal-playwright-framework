import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { SyntheticWorld } from "../support/world";

type LoginResponse = "accepted" | "additional-interaction";

interface PilotObservation {
  url: string;
  brandVisible: boolean;
  overlayVisible: boolean;
  signedInMarkerVisible: boolean;
  submissions: number;
  requestCount: number;
}

interface PilotEvidence {
  provenance: "owned-synthetic-offline";
  liveCustomerExecution: false;
  scope: "authentication-only";
  observation: PilotObservation;
  exclusions: string[];
  cleanupStatus: "confirmed" | "unknown";
}

interface LocalPilotWorld extends SyntheticWorld {
  approvedLocalUrl?: string;
  productIdentity?: string;
  targetRecipe?: { account: string; password: string };
  loginResponse?: LoginResponse;
  requestUrls: string[];
  evidence?: PilotEvidence;
}

const productIdentity = "synthetic-release-ready-identity";
const targetRecipe = {
  account: "synthetic-approved-target-account",
  password: "synthetic-approved-target-password",
};

const pilotLoginFixture = `<!doctype html>
  <html lang="en">
    <head><title>Owned synthetic pilot login</title></head>
    <body>
      <main>
        <p>ReleaseReady identity: <output id="product-identity"></output></p>
        <div id="brandLogo">Partay</div>
        <form id="overlay" data-submissions="0" data-response="accepted">
          <label>
            Target account
            <input id="target-account" name="account" autocomplete="username">
          </label>
          <label>
            Target password
            <input id="target-password" name="password" type="password" autocomplete="current-password">
          </label>
          <button type="submit">Sign in to target</button>
        </form>
        <p id="signed-in-marker" hidden>Signed in to synthetic target</p>
        <p id="login-status" role="status">Login not attempted</p>
      </main>
      <script>
        document.querySelector("#overlay").addEventListener("submit", (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          form.dataset.submissions = String(Number(form.dataset.submissions) + 1);
          form.dataset.submittedAccount = String(values.get("account") || "");
          if (form.dataset.response === "accepted") {
            form.hidden = true;
            document.querySelector("#signed-in-marker").hidden = false;
            document.querySelector("#login-status").textContent = "Synthetic authentication accepted";
          } else {
            document.querySelector("#login-status").textContent = "Additional interaction required";
          }
        });
      </script>
    </body>
  </html>`;

function pilotPage(world: LocalPilotWorld) {
  if (!world.page) {
    throw new Error("Owned synthetic pilot page is unavailable");
  }
  return world.page;
}

async function fillTargetRecipe(world: LocalPilotWorld): Promise<void> {
  const page = pilotPage(world);
  const recipe = world.targetRecipe;
  if (!recipe) {
    throw new Error("Owned synthetic target recipe is unavailable");
  }
  await page
    .getByRole("textbox", { name: "Target account" })
    .fill(recipe.account);
  await page
    .getByRole("textbox", { name: "Target password" })
    .fill(recipe.password);
}

async function openPilotPage(world: LocalPilotWorld): Promise<void> {
  const page = await world.browser.newPage();
  world.page = page;
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(10_000);
  await page.goto(world.baseUrl);
  world.requestUrls = [];
  page.on("request", (request) => world.requestUrls.push(request.url()));
  await page.setContent(pilotLoginFixture);
  world.approvedLocalUrl = page.url();
  world.productIdentity = productIdentity;
  world.targetRecipe = { ...targetRecipe };
  world.loginResponse = "accepted";
  await page.locator("#product-identity").evaluate((element, value) => {
    element.textContent = value;
  }, productIdentity);
}

Given(
  "the owned synthetic pilot login page is open",
  async function (this: LocalPilotWorld) {
    await openPilotPage(this);
  },
);

Given(
  "the target login uses an exact approved synthetic recipe",
  async function (this: LocalPilotWorld) {
    await fillTargetRecipe(this);
  },
);

Given(
  "the synthetic response matches the approved success fixture",
  async function (this: LocalPilotWorld) {
    this.loginResponse = "accepted";
    await pilotPage(this)
      .locator("#overlay")
      .evaluate((form) => {
        form.setAttribute("data-response", "accepted");
      });
  },
);

Given(
  "the synthetic response requires additional interaction",
  async function (this: LocalPilotWorld) {
    this.loginResponse = "additional-interaction";
    await pilotPage(this)
      .locator("#overlay")
      .evaluate((form) => {
        form.setAttribute("data-response", "additional-interaction");
      });
  },
);

When(
  "I submit the synthetic target login once",
  async function (this: LocalPilotWorld) {
    await fillTargetRecipe(this);
    await pilotPage(this)
      .getByRole("button", { name: "Sign in to target" })
      .click();
  },
);

Then(
  "only the target recipe account reaches the local login form",
  async function (this: LocalPilotWorld) {
    const page = pilotPage(this);
    const recipe = this.targetRecipe;
    if (!recipe) {
      throw new Error("Owned synthetic target recipe is unavailable");
    }
    const targetAccount = await page
      .locator("#overlay")
      .getAttribute("data-submitted-account");
    const productAccount = await page
      .locator("#product-identity")
      .textContent();
    assert.equal(targetAccount, recipe.account);
    assert.equal(productAccount, this.productIdentity);
    await expect(page.locator("#overlay")).toHaveAttribute(
      "data-submitted-account",
      recipe.account,
    );
    assert.notEqual(targetAccount, productAccount);
  },
);

Then(
  "no customer target request or extra submission occurs",
  async function (this: LocalPilotWorld) {
    const page = pilotPage(this);
    await expect(page.locator("#overlay")).toHaveAttribute(
      "data-submissions",
      "1",
    );
    assert.deepEqual(this.requestUrls, []);
  },
);

Then(
  "the exact local URL, visible Partay brand, signed-in marker, and dismissed overlay are observed together",
  async function (this: LocalPilotWorld) {
    const page = pilotPage(this);
    assert.equal(page.url(), this.approvedLocalUrl);
    await expect(page.locator("#brandLogo")).toHaveText("Partay");
    await expect(page.locator("#brandLogo")).toBeVisible();
    await expect(page.locator("#signed-in-marker")).toBeVisible();
    await expect(page.locator("#overlay")).toBeHidden();
    await expect(page.locator("#login-status")).toHaveText(
      "Synthetic authentication accepted",
    );
    await expect(page.locator("#overlay")).toHaveAttribute(
      "data-submissions",
      "1",
    );
  },
);

Then(
  "the result is limited to authentication",
  async function (this: LocalPilotWorld) {
    assert.equal(this.loginResponse, "accepted");
    assert.deepEqual(this.requestUrls, []);
  },
);

Then(
  "the visible logo and exact URL do not make the result a success",
  async function (this: LocalPilotWorld) {
    const page = pilotPage(this);
    assert.equal(page.url(), this.approvedLocalUrl);
    await expect(page.locator("#brandLogo")).toBeVisible();
    await expect(page.locator("#overlay")).toBeVisible();
    await expect(page.locator("#signed-in-marker")).toBeHidden();
    await expect(page.locator("#login-status")).toHaveText(
      "Additional interaction required",
    );
    assert.equal(this.loginResponse, "additional-interaction");
    await expect(page.locator("#overlay")).toHaveAttribute(
      "data-submissions",
      "1",
    );
  },
);

Then(
  "no retry or follow-up request occurs",
  async function (this: LocalPilotWorld) {
    const page = pilotPage(this);
    await expect(page.locator("#overlay")).toHaveAttribute(
      "data-submissions",
      "1",
    );
    assert.deepEqual(this.requestUrls, []);
  },
);

When(
  "I record the observed offline coverage and close the page",
  async function (this: LocalPilotWorld) {
    const page = pilotPage(this);
    const observation = await page.evaluate((requestCount) => {
      const visible = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        return Boolean(element && !element.hidden);
      };
      return {
        url: location.href,
        brandVisible: visible("#brandLogo"),
        overlayVisible: visible("#overlay"),
        signedInMarkerVisible: visible("#signed-in-marker"),
        submissions: Number(
          document.querySelector("#overlay")?.getAttribute("data-submissions"),
        ),
        requestCount,
      };
    }, this.requestUrls.length);

    const context = page.context();
    let closeEventObserved = false;
    page.once("close", () => {
      closeEventObserved = true;
    });
    await page.close();
    const pageRemainsAttached = context.pages().includes(page);
    this.page = undefined;
    this.evidence = {
      provenance: "owned-synthetic-offline",
      liveCustomerExecution: false,
      scope: "authentication-only",
      observation,
      exclusions: ["customer login", "post-login application behavior"],
      cleanupStatus:
        closeEventObserved && page.isClosed() && !pageRemainsAttached
          ? "confirmed"
          : "unknown",
    };
  },
);

Then(
  "the evidence distinguishes offline from live coverage and names exclusions",
  function (this: LocalPilotWorld) {
    assert.deepEqual(this.evidence, {
      provenance: "owned-synthetic-offline",
      liveCustomerExecution: false,
      scope: "authentication-only",
      observation: {
        url: this.approvedLocalUrl,
        brandVisible: true,
        overlayVisible: true,
        signedInMarkerVisible: false,
        submissions: 0,
        requestCount: 0,
      },
      exclusions: ["customer login", "post-login application behavior"],
      cleanupStatus: "confirmed",
    });
  },
);

Then(
  "cleanup is reported separately from the login outcome",
  function (this: LocalPilotWorld) {
    assert.equal(this.evidence?.cleanupStatus, "confirmed");
    assert.equal(this.evidence?.observation.signedInMarkerVisible, false);
  },
);

Then(
  "no customer attempt or post-login action is recorded",
  function (this: LocalPilotWorld) {
    assert.equal(this.evidence?.liveCustomerExecution, false);
    assert.equal(this.evidence?.observation.requestCount, 0);
    assert.equal(this.evidence?.observation.submissions, 0);
  },
);
