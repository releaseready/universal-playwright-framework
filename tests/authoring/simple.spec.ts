import { test, expect } from "./support/fixtures";
import { waitForVisible } from "../../src/readiness/wait-for-visible";

test("Simple: save a synthetic draft", async ({ page, ownedApp, draft }) => {
  await page.goto(ownedApp.url, { waitUntil: "domcontentloaded" });
  await waitForVisible(
    page.getByRole("form", { name: "Draft editor", exact: true }),
  );
  await expect(page.getByRole("listitem")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(draft.title);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(`Saved: ${draft.title}`);
  await expect(page.getByRole("listitem")).toHaveText([draft.title]);
});
