import type { Browser } from "@playwright/test";
import type { Server } from "node:http";

type ClosableBrowser = Pick<Browser, "close">;
type ClosableServer = Pick<Server, "listening" | "close">;

export const BROWSER_CLOSE_TIMEOUT_MS = 5_000;

export async function closeRuntime(
  browser: ClosableBrowser | undefined,
  server: ClosableServer | undefined,
  browserCloseTimeoutMs = BROWSER_CLOSE_TIMEOUT_MS,
): Promise<void> {
  const errors: unknown[] = [];

  if (browser) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        browser.close(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `Browser close did not finish within ${browserCloseTimeoutMs} ms; browser shutdown status is unknown`,
                ),
              ),
            browserCloseTimeoutMs,
          );
        }),
      ]);
    } catch (error) {
      errors.push(error);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } catch (error) {
    errors.push(error);
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Failed to clean up synthetic runtime");
  }
}
