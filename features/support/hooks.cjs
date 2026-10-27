const {
  After,
  AfterAll,
  Before,
  BeforeAll,
  setDefaultTimeout,
  setWorldConstructor,
} = require("@cucumber/cucumber");
const { chromium } = require("@playwright/test");
const http = require("node:http");
const { getStepTimeoutMs } = require("./step-timeout.cjs");

class SyntheticWorld {
  browser;
  baseUrl;
  page;
}

setDefaultTimeout(getStepTimeoutMs(process.env.CUCUMBER_STEP_TIMEOUT_MS));
setWorldConstructor(SyntheticWorld);

let browser;
let server;
let baseUrl;

BeforeAll(async function () {
  browser = await chromium.launch({ timeout: 10_000 });
  server = http.createServer((request, response) => {
    if (request.url !== "/") {
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
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await browser.close();
    throw error;
  }

  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

Before(function () {
  this.browser = browser;
  this.baseUrl = baseUrl;
});

After(async function () {
  await this.page?.close();
});

AfterAll(async function () {
  try {
    await browser?.close();
  } finally {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
