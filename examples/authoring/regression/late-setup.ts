import { After, Before, Given, setWorldConstructor } from "@cucumber/cucumber";
import type { Browser } from "@playwright/test";
import { DraftWorld } from "../cucumber/world";

class LateSetupWorld extends DraftWorld {
  protected async launchBrowser(): Promise<Browser> {
    const browser = await super.launchBrowser();
    // Deliberately deliver an acquired resource after Before's deadline.
    await new Promise((resolve) => setTimeout(resolve, 250));
    return browser;
  }
}

setWorldConstructor(LateSetupWorld);
Before({ timeout: 50 }, async function (this: DraftWorld) {
  await this.openSession();
});
After({ timeout: 10000 }, async function (this: DraftWorld) {
  await this.closeSession();
});
Given("the interrupted setup probe", function () {
  throw new Error("The failed Before must skip this step");
});
