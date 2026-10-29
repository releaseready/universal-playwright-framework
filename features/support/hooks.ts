import {
  After,
  AfterAll,
  Before,
  BeforeAll,
  setDefaultTimeout,
  setWorldConstructor,
  World,
  type IWorldOptions,
} from "@cucumber/cucumber";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeRuntime } from "./cleanup-runtime";
import { getStepTimeoutMs } from "./step-timeout";

class SyntheticWorld extends World {
  browser!: Browser;
  baseUrl!: string;
  page?: Page;
  interactionLogs?: string[];

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setDefaultTimeout(getStepTimeoutMs(process.env.CUCUMBER_STEP_TIMEOUT_MS));
setWorldConstructor(SyntheticWorld);

let browser: Browser | undefined;
let server: Server | undefined;
let baseUrl: string | undefined;
let loginFixture: string | undefined;

BeforeAll(async function () {
  loginFixture = await readFile(
    path.resolve("scripts/fixtures/login-ui.html"),
    "utf8",
  );
  browser = await chromium.launch({ timeout: 10_000 });
  server = createServer((request, response) => {
    const requestPath = new URL(request.url ?? "/", "http://127.0.0.1")
      .pathname;
    if (requestPath === "/login-ui" && request.method === "GET") {
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(loginFixture);
      return;
    }
    if (requestPath !== "/" || request.method !== "GET") {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html lang="en">
        <head><title>Synthetic demo</title></head>
        <body>
          <button type="button">Run demo action</button>
          <p role="status">Waiting</p>
          <script>
            document.querySelector('button').addEventListener('click', () => {
              document.querySelector('[role="status"]').textContent = 'Action completed';
            });
          </script>
        </body>
      </html>`);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Synthetic server did not bind to a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}/`;
  } catch (error) {
    try {
      await closeRuntime(browser, server);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Synthetic server setup and cleanup both failed",
      );
    }
    throw error;
  }
});

Before(function (this: SyntheticWorld) {
  if (!browser || !baseUrl) {
    throw new Error("Synthetic browser and server were not initialized");
  }
  this.browser = browser;
  this.baseUrl = baseUrl;
});

After(async function (this: SyntheticWorld) {
  await this.page?.close();
});

AfterAll(async function () {
  await closeRuntime(browser, server);
});
