import { test, expect } from "./support/fixtures";
import { waitForVisible } from "../../src/readiness/wait-for-visible";
import { BasePage } from "../../src/pages/base-page";
import { buildDraft } from "./support/data";

class DocumentPage extends BasePage {}

test("document compatibility never requests network idle", async ({ page }) => {
  const states: unknown[] = [];
  page.waitForLoadState = async (state) => {
    states.push(state);
  };
  await new DocumentPage(page).waitForPageLoad();
  expect(states).toEqual(["domcontentloaded"]);
});

test("visible state succeeds while traffic continues", async ({
  page,
  ownedApp,
  drafts,
}) => {
  await drafts.open();
  await expect.poll(ownedApp.trafficRequests).toBeGreaterThan(2);
  const before = ownedApp.trafficRequests();
  // Observe longer than Playwright's 500ms idle qualification.
  await expect(
    page.waitForLoadState("networkidle", { timeout: 1200 }),
  ).rejects.toThrow(/Timeout/);
  expect(ownedApp.trafficRequests()).toBeGreaterThan(before);
  await waitForVisible(
    page.getByRole("form", { name: "Draft editor", exact: true }),
    1000,
  );
  await page.evaluate(() => {
    const timer = (window as Window & { telemetryTimer?: number })
      .telemetryTimer;
    if (timer === undefined)
      throw new Error("Synthetic telemetry timer missing");
    clearInterval(timer);
  });
  await page.waitForLoadState("networkidle", { timeout: 2000 });
});

test("document loaded does not mean delayed UI is ready", async ({ page }) => {
  await page.setContent("<button hidden>Ready</button>");
  const ready = page.getByRole("button", { name: "Ready", exact: true });
  await new DocumentPage(page).waitForPageLoad();
  await expect(ready).toBeHidden();
  await page.evaluate(() => {
    setTimeout(() => {
      document.querySelector("button")!.hidden = false;
    }, 150);
  });
  await waitForVisible(ready, 2000);
  await expect(ready).toBeVisible();
});

test("missing and hidden readiness fail within the explicit bound", async ({
  page,
}) => {
  await page.setContent("<button hidden>Hidden</button>");
  const hidden = page.locator("button");
  await expect(hidden).toHaveCount(1);
  for (const locator of [
    page.getByRole("button", { name: "Missing", exact: true }),
    hidden,
  ]) {
    const start = Date.now();
    await expect(waitForVisible(locator, 100)).rejects.toThrow(/Timeout/);
    expect(Date.now() - start).toBeLessThan(2000);
  }
});

test("invalid bounds cannot disable the timeout", async ({ page }) => {
  for (const timeout of [0, -1, Infinity, NaN, 120001]) {
    await expect(
      waitForVisible(page.getByRole("button"), timeout),
    ).rejects.toThrow(RangeError);
  }
});

test("visible status alone cannot falsely pass a save", async ({
  page,
  drafts,
}) => {
  await drafts.open();
  await waitForVisible(page.getByRole("status"));
  await expect(drafts.status).toHaveText("Not saved");
  await expect(
    expect(drafts.status).toHaveText("Saved: Synthetic rehearsal", {
      timeout: 100,
    }),
  ).rejects.toThrow();
  await expect(drafts.drafts).toHaveCount(0);
});

test("each context and builder starts fresh on repeats and parallel workers", async ({
  page,
  drafts,
  draft,
}) => {
  await drafts.open();
  await expect(drafts.drafts).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("lastDraft")),
  ).toBeNull();
  expect(draft).toEqual(buildDraft());
  draft.tags.push("only-this-test");
  expect(buildDraft().tags).toEqual(["synthetic"]);
  const tags = ["override"];
  const custom = buildDraft({ tags });
  tags.push("later-mutation");
  expect(custom.tags).toEqual(["override"]);
  await drafts.editor.save(draft.title);
  await expect(drafts.status).toHaveText(`Saved: ${draft.title}`);
  expect(await page.evaluate(() => localStorage.getItem("lastDraft"))).toBe(
    draft.title,
  );
});
