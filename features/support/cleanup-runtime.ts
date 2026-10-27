import type { Browser } from "@playwright/test";
import type { Server } from "node:http";

type ClosableBrowser = Pick<Browser, "close">;
type ClosableServer = Pick<Server, "listening" | "close">;

export async function closeRuntime(
  browser: ClosableBrowser | undefined,
  server: ClosableServer | undefined,
): Promise<void> {
  const errors: unknown[] = [];

  try {
    await browser?.close();
  } catch (error) {
    errors.push(error);
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
