import type { Locator } from "@playwright/test";

/** Wait for one meaningful visible state. This does not assert business success.
 * Use Playwright assertions for text, enabled state, counts and other outcomes.
 * Zero (Playwright's unlimited wait) and non-finite timeouts are rejected.
 */
export async function waitForVisible(
  locator: Locator,
  timeout: number = 10000,
): Promise<void> {
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 120000) {
    throw new RangeError(
      "Readiness timeout must be between 0 (exclusive) and 120000 ms",
    );
  }
  await locator.waitFor({ state: "visible", timeout });
}
