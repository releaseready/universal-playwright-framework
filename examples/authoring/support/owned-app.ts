import type { BrowserContext } from "@playwright/test";
import { appHtml } from "./app";

export const appUrl = "https://authoring.invalid/";

/** Runner-neutral local routing. No request is sent to the synthetic origin. */
export async function installOwnedApp(context: BrowserContext) {
  let traffic = 0;
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url === appUrl) {
      await route.fulfill({ contentType: "text/html", body: appHtml });
    } else if (url === `${appUrl}telemetry`) {
      traffic += 1;
      await route.fulfill({ status: 200, body: "synthetic" });
    } else {
      await route.abort("blockedbyclient");
    }
  });
  return { url: appUrl, trafficRequests: () => traffic };
}
