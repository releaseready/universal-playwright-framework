import type { Browser } from "@playwright/test";

export function launchAuthenticationFixtureBrowser(
  browserType: { launch(options: { timeout: number }): Promise<Browser> },
  timeoutMs: number,
): Promise<Browser> {
  return browserType.launch({ timeout: timeoutMs });
}
