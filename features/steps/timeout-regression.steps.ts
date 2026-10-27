import { Given } from "@cucumber/cucumber";

Given(
  "I wait {int} milliseconds",
  async function (duration: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, duration));
  },
);
