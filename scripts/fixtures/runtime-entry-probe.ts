import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createServer } from "node:http";
import type { Browser } from "@playwright/test";
import type * as RuntimeEntry from "../../src/runtime-login/v1";

const publicRequire = createRequire(__filename);
const mode = process.argv[2];
let delayed = false;

// Each probe starts a cold Node process. No browser modules are preloaded by tests.
const loader = Module as unknown as {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};
const originalLoad = loader._load;
let browserLoads = 0;
let browserAllowed = false;
loader._load = function (request, parent, isMain) {
  if (
    /(?:^|[/\\])(?:@playwright|playwright|playwright-core)(?:[/\\]|$)/.test(
      request,
    )
  ) {
    browserLoads += 1;
    assert.ok(
      browserAllowed,
      `Browser dependency loaded before consumption: ${request}`,
    );
  }
  if (mode === "load-timeout" && request === "@playwright/test" && !delayed) {
    delayed = true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  return originalLoad.call(this, request, parent, isMain);
};
const api = publicRequire(
  "@universal/playwright-framework/runtime-login/v1",
) as typeof RuntimeEntry;
// Type-only imports above disappear; the fixture has no browser dependency.
const { runtimeEntryFixture } = publicRequire(
  "./runtime-entry-data",
) as typeof import("./runtime-entry-data");
const { descriptor, request } = runtimeEntryFixture();
const values = {
  username: "OWNED_ENTRY_USER",
  password: "OWNED_ENTRY_PASSWORD",
};

function noBrowserGraph(): void {
  assert.equal(browserLoads, 0);
  assert.ok(
    !Object.keys(require.cache).some((file) =>
      /node_modules[/\\](?:@playwright|playwright|playwright-core)[/\\]/.test(
        file,
      ),
    ),
  );
}

async function main(): Promise<void> {
  noBrowserGraph();
  if (mode === "pending") {
    let rejectProvider: ((reason: unknown) => void) | undefined;
    let disposed = 0;
    let launched = 0;
    const controller = new AbortController();
    const provider: RuntimeEntry.RuntimeSecretProvider = {
      resolve: async () =>
        new Promise<string>((_resolve, reject) => {
          rejectProvider = reject;
          process.send?.({ stage: "pending", browserLoads });
        }),
      dispose() {
        disposed += 1;
      },
    };
    process.once("message", (message) => {
      assert.equal(message, "cancel");
      noBrowserGraph();
      controller.abort();
      rejectProvider?.(new api.RuntimeLoginError("runtime-input-unavailable"));
    });
    await assert.rejects(
      api.verifyPartayLogin(descriptor, request, provider, {
        signal: controller.signal,
        launchBrowser: async () => {
          launched += 1;
          throw new Error("must not launch");
        },
      }),
      (error) => {
        assert.ok(error instanceof api.RuntimeLoginFailure);
        assert.equal(error.failureStage, "input-validation");
        assert.equal(error.cleanupStatus, "not-acquired");
        assert.equal(error.failureClassification, "input");
        return true;
      },
    );
    assert.equal(disposed, 1);
    assert.equal(launched, 0);
    noBrowserGraph();
  } else if (mode === "guards") {
    let consumed = false;
    await assert.rejects(
      api.withOperatorLoginInputs(descriptor, request, async () => {
        consumed = true;
      }),
      (error) =>
        error instanceof api.RuntimeLoginError &&
        error.code === "runtime-input-unavailable",
    );
    await assert.rejects(
      api.promptAndVerifyPartayLogin(descriptor, request),
      (error) =>
        error instanceof api.RuntimeLoginFailure &&
        error.cleanupStatus === "not-acquired",
    );
    assert.equal(consumed, false);
    const provider = new api.InMemoryRuntimeSecretProvider(request, values);
    await assert.rejects(
      api.verifyPartayLogin(
        descriptor,
        { ...request, expiresAt: Date.now() - 1 },
        provider,
      ),
      (error) =>
        error instanceof api.RuntimeLoginFailure &&
        error.failureClassification === "input",
    );
    noBrowserGraph();
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      api.verifyPartayLogin(
        descriptor,
        request,
        new api.InMemoryRuntimeSecretProvider(request, values),
        { signal: cancelled.signal },
      ),
      (error) =>
        error instanceof api.RuntimeLoginFailure &&
        error.failureClassification === "interrupted" &&
        error.cleanupStatus === "not-acquired",
    );
    noBrowserGraph();
  } else if (mode === "load-timeout") {
    browserAllowed = true;
    let launches = 0;
    await assert.rejects(
      api.verifyPartayLogin(
        descriptor,
        request,
        new api.InMemoryRuntimeSecretProvider(request, values),
        {
          timeoutMs: 50,
          launchBrowser: async () => {
            launches += 1;
            throw new Error("must not launch after import expiry");
          },
        },
      ),
      (error) =>
        error instanceof api.RuntimeLoginFailure &&
        error.failureStage === "browser-startup" &&
        error.failureClassification === "timed-out" &&
        error.cleanupStatus === "not-acquired",
    );
    assert.equal(delayed, true);
    assert.equal(launches, 0);
  } else if (mode === "root") {
    browserAllowed = true;
    const root = publicRequire("@universal/playwright-framework") as Record<
      string,
      unknown
    >;
    for (const [name, value] of Object.entries(api))
      assert.equal(root[name], value, `${name} identity changed`);
    const error = new api.RuntimeLoginFailure(
      "navigation",
      "confirmed",
      undefined,
      "navigation",
    );
    assert.ok(
      error instanceof
        (root.RuntimeLoginFailure as typeof api.RuntimeLoginFailure),
    );
    const normalized = (
      root.RuntimeLoginFailure as typeof api.RuntimeLoginFailure
    ).fromUnknown(error);
    assert.ok(normalized instanceof api.RuntimeLoginFailure);
    assert.deepEqual(
      api.partayLoginFailureReport(normalized),
      api.partayLoginFailureReport(error),
    );
  } else if (mode === "browser") {
    browserAllowed = true;
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<div id="brandLogo">Partay</div><div id="overlay"><input id="username"><input id="password" type="password"><button id="authGo">Sign in</button></div><script>document.querySelector("button").onclick=()=>{document.querySelector("#overlay").style.display="none";}</script>',
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const fixtureUrl = `http://127.0.0.1:${address.port}/`;
    let browser: Browser | undefined;
    let contextClosed = false;
    let requests = 0;
    let launchGraphLoaded = false;
    try {
      const result = await api.verifyPartayLogin(
        descriptor,
        request,
        new api.InMemoryRuntimeSecretProvider(request, values),
        {
          launchBrowser: async (timeout) => {
            launchGraphLoaded = browserLoads > 0;
            const { chromium } = await import("@playwright/test");
            browser = await chromium.launch({ headless: true, timeout });
            const newContext = browser.newContext.bind(browser);
            browser.newContext = async (options) => {
              const context = await newContext(options);
              context.on("close", () => {
                contextClosed = true;
              });
              const register = context.route.bind(context);
              context.route = async (pattern, handler) =>
                register(pattern, async (route, req) => {
                  route.fetch = async (options) => {
                    assert.equal(req.url(), api.PARTAY_LOGIN_URL);
                    assert.equal(options?.maxRedirects, 0);
                    requests += 1;
                    return context.request.get(fixtureUrl, { maxRedirects: 0 });
                  };
                  await handler(route, req);
                });
              return context;
            };
            return browser;
          },
        },
      );
      assert.equal(result.status, "completed");
      assert.equal(requests, 1);
      assert.equal(launchGraphLoaded, true);
      assert.equal(contextClosed, true);
      assert.equal(browser?.isConnected(), false);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } else {
    throw new Error("Unknown probe mode");
  }
  loader._load = originalLoad;
  process.send?.({ stage: "completed", mode, browserLoads });
  process.stdout.write(JSON.stringify({ mode, browserLoads }) + "\n");
  if (process.connected) process.disconnect();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
