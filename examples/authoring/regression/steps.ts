import { When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { waitForVisible } from "../../../src/readiness/wait-for-visible";
import type { DraftWorld } from "../cucumber/world";

// Deliberate failure probes: never loaded by the normal starter config.
When("I require a missing ready control", async function (this: DraftWorld) {
  await waitForVisible(
    this.page.getByRole("button", { name: "Missing", exact: true }),
    100,
  );
});

When("I require a hidden ready control", async function (this: DraftWorld) {
  await this.page.setContent("<button hidden>Hidden</button>");
  const hidden = this.page.locator("button");
  await expect(hidden).toHaveCount(1);
  await waitForVisible(hidden, 100);
});

When(
  "the owned browser context is interrupted during readiness",
  async function (this: DraftWorld) {
    const ready = this.page.getByRole("button", {
      name: "Missing",
      exact: true,
    });
    const waiting = waitForVisible(ready, 3000);
    // Attach the rejection handler before closing the context.
    const outcome = waiting.then(
      () => undefined,
      (error: unknown) => error,
    );
    await this.context!.close();
    const error = await outcome;
    if (!error)
      throw new Error(
        "Readiness unexpectedly passed after context interruption",
      );
    throw error;
  },
);
