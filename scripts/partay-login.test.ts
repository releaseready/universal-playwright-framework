import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "node:test";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import type {
  PreparedInputDescriptor,
  RuntimeSecretProvider,
} from "../src/input-preparation";
import { reviewDataReferences } from "../src/input-preparation/data-references";
import {
  InMemoryRuntimeSecretProvider,
  RuntimeLoginError,
  RuntimeLoginFailure,
  RUNTIME_LOGIN_FAILURE_STAGES,
  RUNTIME_LOGIN_CLEANUP_STATUSES,
  consumeRuntimeLoginInputs,
  type RuntimeLoginRequest,
} from "../src/input-preparation/runtime-login";
import {
  PARTAY_LOGIN_URL,
  verifyPartayLogin,
  partayLoginFailureReport,
} from "../src/customer-login/partay";
import {
  guardLoginRequests,
  LOGIN_CLEANUP_TIMEOUT_MS,
  withFreshLoginPage,
} from "../src/execution/runtime-login-browser";

const canary = {
  username: "OWNED_WEB8_USERNAME_CANARY",
  password: "OWNED_WEB8_PASSWORD_CANARY",
};

function fixture() {
  const references = reviewDataReferences(
    {
      version: 1,
      rows: [
        {
          scenarioId: "owned-login",
          dataset: { id: "owned-data", revision: "v1" },
          rowId: "owned-row",
          secret: { id: "owned-account", revision: "v1" },
        },
      ],
    },
    {
      datasets: [{ id: "owned-data", revision: "v1", rows: ["owned-row"] }],
      secrets: [{ id: "owned-account", revision: "v1" }],
    },
  );
  const environment = {
    id: "owned-environment",
    revision: "v1",
    approvedOrigin: new URL(PARTAY_LOGIN_URL).origin,
  };
  const request: RuntimeLoginRequest = {
    scope: {
      projectId: "owned-project",
      runId: "owned-run",
      scenarioId: "owned-login",
      dataBinding: references.binding,
      environment,
    },
    account: { id: "owned-account", revision: "v1" },
    expiresAt: Date.now() + 60_000,
  };
  const descriptor: PreparedInputDescriptor = {
    version: 1,
    environment: { ...environment, initialTargetUrl: PARTAY_LOGIN_URL },
    review: {
      sourceRevision: "owned-v1",
      featureRevision: "owned-v1",
      implementationRevision: "owned-v1",
    },
    fixturePolicy: { id: "owned-policy", revision: "v1" },
    fixtureRevision: "owned-v1",
    dataReferences: references,
    scenarios: [
      {
        id: "owned-login",
        tags: ["@RRDWEB-8-login-S01"],
        values: { displayName: "Owned fixture" },
        dataReference: references.rows[0],
        account: {
          reference: "owned-account",
          secretReference: { id: "owned-account" },
        },
        cleanup: {
          requested: true,
          authorizationStatus: "unverified",
          reference: "owned-cleanup",
          requestedRevision: "v1",
          outcome: "unknown",
        },
      },
    ],
  };
  const provider = new InMemoryRuntimeSecretProvider(request, canary);
  return { descriptor, request, provider };
}

type Mode =
  | "success"
  | "navigation-failure"
  | "rejected"
  | "wrong-url"
  | "wrong-logo"
  | "hidden-logo"
  | "redirect"
  | "missing-form"
  | "waiting";

function ownedBrowser(mode: Mode, afterSubmit?: () => void) {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let submissions = 0;
  let contexts = 0;
  let contextClosed = false;
  let browserClosed = false;
  let contextWasEmpty = false;
  const requests: string[] = [];
  return {
    get page() {
      return page;
    },
    get submissions() {
      return submissions;
    },
    get contexts() {
      return contexts;
    },
    get contextWasEmpty() {
      return contextWasEmpty;
    },
    get contextClosed() {
      return contextClosed;
    },
    get browserClosed() {
      return browserClosed;
    },
    requests,
    async launchBrowser(timeoutMs: number): Promise<Browser> {
      browser = await chromium.launch({ headless: true, timeout: timeoutMs });
      browser.on("disconnected", () => {
        browserClosed = true;
      });
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        contexts += 1;
        assert.deepEqual(options, {
          acceptDownloads: false,
          serviceWorkers: "block",
        });
        const context = await newContext(options);
        context.on("close", () => {
          contextClosed = true;
        });
        contextWasEmpty = (await context.cookies()).length === 0;
        await context.exposeBinding("ownedSubmit", () => {
          submissions += 1;
          afterSubmit?.();
        });
        const server = createServer((_request, response) => {
          response.setHeader("Content-Type", "text/html");
          response.end(`<!doctype html>
              <div id="brandLogo" ${mode === "hidden-logo" ? 'style="display:none"' : ""}>${mode === "wrong-logo" ? "Not Partay" : "Par<b>tay</b>"}</div>
              <div id="overlay" ${mode === "missing-form" ? 'style="display:none"' : ""}>
                <input id="username"><input id="password" type="password">
                <button id="authGo">Sign in</button>
              </div>
              <script>
                authGo.onclick = async () => {
                  authGo.disabled = true;
                  await ownedSubmit();
                  if (username.value !== ${JSON.stringify(canary.username)} ||
                      password.value !== ${JSON.stringify(canary.password)}) return;
                  if (${JSON.stringify(mode)} === "waiting" || ${JSON.stringify(mode)} === "rejected") return;
                  if (${JSON.stringify(mode)} === "redirect") { location.href = "/not-permitted"; return; }
                  overlay.style.display = "none";
                  if (${JSON.stringify(mode)} === "wrong-url") history.pushState({}, "", "/other");
                };
              </script>`);
        });
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const fixtureUrl = `http://127.0.0.1:${address.port}/`;
        browser!.on("disconnected", () => {
          server.closeAllConnections();
          server.close();
        });
        const registerRoute = context.route.bind(context);
        context.route = async (url, handler) => {
          await registerRoute(url, async (route, request) => {
            // Only the transport is remapped. The production guard still checks
            // the customer URL and fetch options; no customer request is sent.
            route.fetch = async (fetchOptions) => {
              assert.equal(fetchOptions?.maxRedirects, 0);
              requests.push(route.request().url());
              assert.equal(route.request().url(), PARTAY_LOGIN_URL);
              return context.request.get(fixtureUrl, { maxRedirects: 0 });
            };
            await handler(route, request);
          });
        };
        const newPage = context.newPage.bind(context);
        context.newPage = async () => {
          page = await newPage();
          if (mode === "navigation-failure")
            page.goto = async () => {
              throw new Error(canary.password);
            };
          return page;
        };
        return context;
      };
      return browser;
    },
  };
}

async function assertDisposed(
  provider: RuntimeSecretProvider,
  request: RuntimeLoginRequest,
): Promise<void> {
  await assert.rejects(
    provider.resolve({ ...request.account, field: "password" }, request.scope),
    {
      code: "runtime-input-unavailable",
    },
  );
}

function assertSafe(error: unknown): boolean {
  assert.ok(error instanceof RuntimeLoginError);
  const serialized = `${JSON.stringify(error)} ${inspect(error)}`;
  assert.ok(!serialized.includes(canary.username));
  assert.ok(!serialized.includes(canary.password));
  assert.equal(error.cause, undefined);
  assert.ok(error instanceof RuntimeLoginFailure);
  assert.ok(RUNTIME_LOGIN_FAILURE_STAGES.includes(error.failureStage));
  assert.ok(RUNTIME_LOGIN_CLEANUP_STATUSES.includes(error.cleanupStatus));
  return true;
}

function assertFailure(
  error: unknown,
  failureStage: RuntimeLoginFailure["failureStage"],
  cleanupStatus: RuntimeLoginFailure["cleanupStatus"],
): boolean {
  assertSafe(error);
  assert.deepEqual(partayLoginFailureReport(error), {
    status: "not-verified",
    failureStage,
    cleanupStatus,
    automaticRetryAttempted: false,
  });
  return true;
}

test("failure reports allowlist both dimensions and never serialize arbitrary errors or causes", () => {
  for (const stage of RUNTIME_LOGIN_FAILURE_STAGES) {
    for (const status of RUNTIME_LOGIN_CLEANUP_STATUSES) {
      const error = new RuntimeLoginFailure(stage, status);
      Object.assign(error, {
        message: canary.password,
        cause: new Error(canary.username),
        request: canary,
      });
      assert.deepEqual(partayLoginFailureReport(error), {
        status: "not-verified",
        failureStage: stage,
        cleanupStatus: status,
        automaticRetryAttempted: false,
      });
    }
  }
  for (const value of [
    canary.password,
    new Error(canary.password, { cause: canary.username }),
    { failureStage: canary.username, cleanupStatus: canary.password },
    undefined,
  ]) {
    assert.deepEqual(partayLoginFailureReport(value), {
      status: "not-verified",
      failureStage: "unclassified",
      cleanupStatus: "unconfirmed",
      automaticRetryAttempted: false,
    });
    const error = new RuntimeLoginFailure(value, value);
    assertFailure(error, "unclassified", "unconfirmed");
    const poisoned = Object.assign(
      new RuntimeLoginFailure("navigation", "confirmed"),
      { failureStage: value, cleanupStatus: value },
    );
    assert.deepEqual(
      partayLoginFailureReport(poisoned),
      partayLoginFailureReport(undefined),
    );
  }
});

test("shared boundary reconstructs only safe metadata and disposes even when disposal throws", async () => {
  const { descriptor, request, provider } = fixture();
  let disposals = 0;
  const poisoned = Object.assign(
    new RuntimeLoginFailure("navigation", "confirmed"),
    {
      message: canary.password,
      cause: new Error(canary.username),
      request: canary,
    },
  );
  const wrapped: RuntimeSecretProvider = {
    resolve: provider.resolve.bind(provider),
    dispose: () => {
      disposals += 1;
      provider.dispose();
      throw new Error(canary.password);
    },
  };
  await assert.rejects(
    consumeRuntimeLoginInputs(descriptor, request, wrapped, async () => {
      throw poisoned;
    }),
    (error) => assertFailure(error, "navigation", "confirmed"),
  );
  assert.equal(disposals, 1);
  await assertDisposed(provider, request);
});

test("provider disposal failure after consumer completion cannot produce a receipt", async () => {
  const { descriptor, request, provider } = fixture();
  let disposals = 0;
  await assert.rejects(
    consumeRuntimeLoginInputs(
      descriptor,
      request,
      {
        resolve: provider.resolve.bind(provider),
        dispose: () => {
          disposals += 1;
          provider.dispose();
          throw new Error(canary.password);
        },
      },
      async () => undefined,
    ),
    (error) => assertFailure(error, "input-disposal", "unconfirmed"),
  );
  assert.equal(disposals, 1);
  await assertDisposed(provider, request);
});

test("interrupted pending launcher cannot report not-acquired or confirmed cleanup", async () => {
  const { descriptor, request, provider } = fixture();
  const controller = new AbortController();
  let launches = 0;
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      signal: controller.signal,
      launchBrowser: async () => {
        launches += 1;
        controller.abort();
        return new Promise<Browser>(() => undefined);
      },
    }),
    (error) => assertFailure(error, "browser-startup", "unconfirmed"),
  );
  assert.equal(launches, 1);
  await assertDisposed(provider, request);
});

test("CLI input failures emit only safe structured metadata and no success receipt", () => {
  for (const args of [[], [canary.username, canary.password]]) {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, "verify-partay-login.js"), ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      status: "not-verified",
      failureStage: "input-validation",
      cleanupStatus: "not-acquired",
      automaticRetryAttempted: false,
    });
    assert.ok(!result.stderr.includes(canary.username));
    assert.ok(!result.stderr.includes(canary.password));
  }
});

for (const fault of ["launch", "context", "page"] as const) {
  test(`offline ${fault} startup failure reports independent cleanup status and makes one attempt`, async () => {
    const { descriptor, request, provider } = fixture();
    let launches = 0;
    let browserCloses = 0;
    let contextCloses = 0;
    await assert.rejects(
      verifyPartayLogin(descriptor, request, provider, {
        launchBrowser: async () => {
          launches += 1;
          if (fault === "launch") throw new Error(canary.password);
          return {
            close: async () => {
              browserCloses += 1;
            },
            newContext: async () => {
              if (fault === "context") throw new Error(canary.password);
              return {
                close: async () => {
                  contextCloses += 1;
                },
                newPage: async () => {
                  throw new Error(canary.password);
                },
              };
            },
          } as unknown as Browser;
        },
      }),
      (error) =>
        assertFailure(
          error,
          "browser-startup",
          fault === "launch" ? "not-acquired" : "confirmed",
        ),
    );
    assert.equal(launches, 1);
    assert.equal(browserCloses, fault === "launch" ? 0 : 1);
    assert.equal(contextCloses, fault === "page" ? 1 : 0);
    await assertDisposed(provider, request);
  });
}

test("exact target, rendered Partay and hidden overlay succeed with one submit and fresh cleanup", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("success");
  const receipt = await verifyPartayLogin(descriptor, request, provider, owned);
  assert.equal(receipt.status, "completed");
  assert.equal(owned.submissions, 1);
  assert.equal(owned.contexts, 1);
  assert.equal(owned.contextWasEmpty, true);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  assert.deepEqual(owned.requests, [PARTAY_LOGIN_URL]);
  assert.ok(!JSON.stringify(receipt).includes(canary.username));
  assert.ok(!JSON.stringify(receipt).includes(canary.password));
  await assertDisposed(provider, request);
});

test("offline navigation failure is distinct from startup and submission; cleanup is confirmed", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("navigation-failure");
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, owned),
    (error) => assertFailure(error, "navigation", "confirmed"),
  );
  assert.equal(owned.submissions, 0);
  assert.equal(owned.contexts, 1);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  assert.deepEqual(owned.requests, []);
  await assertDisposed(provider, request);
});

for (const mode of [
  "rejected",
  "wrong-url",
  "wrong-logo",
  "hidden-logo",
  "redirect",
  "missing-form",
] as const) {
  test(`owned ${mode} cannot pass; no retry, secret-bearing error or retained context`, async () => {
    const { descriptor, request, provider } = fixture();
    const owned = ownedBrowser(mode);
    await assert.rejects(
      verifyPartayLogin(descriptor, request, provider, {
        ...owned,
        timeoutMs: 2000,
      }),
      (error) => {
        assertSafe(error);
        assert.ok(error instanceof RuntimeLoginFailure);
        assert.equal(error.failureStage, "submission-assertion");
        // Deadline cancellation closes both resources independently; a close
        // rejection must not be upgraded merely because the process exited.
        if (mode === "wrong-logo")
          assert.equal(error.cleanupStatus, "confirmed");
        else assert.notEqual(error.cleanupStatus, "not-acquired");
        return true;
      },
    );
    assert.equal(owned.submissions, mode === "missing-form" ? 0 : 1);
    assert.equal(owned.contextClosed, true);
    assert.equal(owned.browserClosed, true);
    assert.deepEqual(owned.requests, [PARTAY_LOGIN_URL]);
    await assertDisposed(provider, request);
  });
}

test("cancellation during login closes browser and disposes provider", async () => {
  const { descriptor, request, provider } = fixture();
  const controller = new AbortController();
  const owned = ownedBrowser("waiting", () => controller.abort());
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      ...owned,
      signal: controller.signal,
    }),
    (error) => {
      assertSafe(error);
      assert.ok(error instanceof RuntimeLoginFailure);
      assert.equal(error.failureStage, "submission-assertion");
      assert.notEqual(error.cleanupStatus, "not-acquired");
      return true;
    },
  );
  assert.equal(owned.submissions, 1);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  await assertDisposed(provider, request);
});

test("timeout during login closes browser and disposes provider", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("waiting");
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      ...owned,
      timeoutMs: 2000,
    }),
    assertSafe,
  );
  assert.equal(owned.submissions, 1);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  await assertDisposed(provider, request);
});

for (const fault of [
  "cancelled",
  "target",
  "scope",
  "empty",
  "expired",
] as const) {
  test(`${fault} preflight rejects before browser acquisition and disposes input`, async () => {
    const prepared = fixture();
    let { descriptor, request } = prepared;
    const { provider } = prepared;
    const controller = new AbortController();
    let launches = 0;
    let disposed = false;
    let injected: RuntimeSecretProvider = provider;
    if (fault === "cancelled") controller.abort();
    if (fault === "target")
      descriptor = {
        ...descriptor,
        environment: {
          ...descriptor.environment,
          initialTargetUrl: `${PARTAY_LOGIN_URL}?unapproved=1`,
        },
      };
    if (fault === "scope")
      request = {
        ...request,
        scope: {
          ...request.scope,
          environment: {
            ...request.scope.environment,
            approvedOrigin: "https://other.invalid",
          },
        },
      };
    if (fault === "expired")
      request = { ...request, expiresAt: Date.now() - 1 };
    if (fault === "empty") {
      injected = {
        resolve: async () => "",
        dispose: () => {
          disposed = true;
        },
      };
      provider.dispose();
    }
    await assert.rejects(
      verifyPartayLogin(descriptor, request, injected, {
        signal: controller.signal,
        launchBrowser: async () => {
          launches += 1;
          throw new Error(canary.password);
        },
      }),
      (error) =>
        assertFailure(
          error,
          fault === "cancelled" ? "browser-startup" : "input-validation",
          "not-acquired",
        ),
    );
    assert.equal(launches, 0);
    if (fault === "empty") assert.equal(disposed, true);
    else await assertDisposed(provider, request);
  });
}

test("late browser acquisition after cancellation is still closed", async () => {
  const { descriptor, request, provider } = fixture();
  const controller = new AbortController();
  let browser: Browser | undefined;
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      signal: controller.signal,
      launchBrowser: async (timeout) => {
        controller.abort();
        browser = await chromium.launch({ headless: true, timeout });
        return browser;
      },
    }),
    assertSafe,
  );
  for (let i = 0; i < 100 && !browser; i += 1) await delay(20);
  for (let i = 0; i < 100 && browser?.isConnected(); i += 1) await delay(20);
  assert.equal(browser?.isConnected(), false);
  await assertDisposed(provider, request);
});

test("launcher failure is sanitized and disposes input", async () => {
  const { descriptor, request, provider } = fixture();
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      launchBrowser: async () => {
        throw new Error(canary.password);
      },
    }),
    (error) => assertFailure(error, "browser-startup", "not-acquired"),
  );
  await assertDisposed(provider, request);
});

async function localTransport(
  run: (
    source: string,
    destination: string,
    counts: Map<string, number>,
  ) => Promise<void>,
): Promise<void> {
  const counts = new Map<string, number>();
  const destination = createServer((request, response) => {
    counts.set("destination", (counts.get("destination") ?? 0) + 1);
    request.resume();
    response.end("unintended");
  });
  destination.on("upgrade", (_request, socket) => {
    counts.set("destination", (counts.get("destination") ?? 0) + 1);
    socket.destroy();
  });
  let destinationUrl = "";
  const source = createServer((request, response) => {
    const path = request.url ?? "/";
    counts.set(path, (counts.get(path) ?? 0) + 1);
    request.resume();
    if (path === "/" || path === "/api") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Owned login</title>");
    } else {
      response.statusCode = Number(path.match(/^\/(\d+)/)?.[1] ?? 302);
      response.setHeader(
        "Location",
        path.includes("chain")
          ? "/hop"
          : path.includes("same-origin")
            ? "/unapproved"
            : destinationUrl,
      );
      response.end();
    }
  });
  const listen = async (
    server: ReturnType<typeof createServer>,
  ): Promise<string> => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}/`;
  };
  try {
    destinationUrl = await listen(destination);
    await run(await listen(source), destinationUrl, counts);
  } finally {
    await Promise.all(
      [source, destination].map(async (server) => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }),
    );
  }
}

for (const status of [301, 302, 303, 307, 308]) {
  for (const kind of ["external", "same-origin", "chain"]) {
    test(`real HTTP ${status} ${kind} document redirect sends zero destination requests`, async () => {
      await localTransport(async (source, _destination, counts) => {
        const login = `${source}${status}-${kind}`;
        await assert.rejects(
          withFreshLoginPage(async (page) => {
            await guardLoginRequests(
              page.context(),
              new URL(source).origin,
              login,
            );
            await page.goto(login);
          }),
        );
        assert.equal(counts.get(`/${status}-${kind}`), 1);
        assert.equal(counts.get("/hop") ?? 0, 0);
        assert.equal(counts.get("/unapproved") ?? 0, 0);
        assert.equal(counts.get("destination") ?? 0, 0);
      });
    });
  }
}

test("approved same-origin document and non-navigation POST remain usable", async () => {
  await localTransport(async (source, _destination, counts) => {
    await withFreshLoginPage(async (page) => {
      const assertAllowed = await guardLoginRequests(
        page.context(),
        new URL(source).origin,
        source,
      );
      await page.goto(source);
      assert.equal(
        await page.evaluate(
          async () =>
            (await fetch("/api", { method: "POST", body: "owned-value" }))
              .status,
        ),
        200,
      );
      assertAllowed();
    });
    assert.equal(counts.get("/"), 1);
    assert.equal(counts.get("/api"), 1);
    assert.equal(counts.get("destination") ?? 0, 0);
  });
});

for (const action of [
  "fetch",
  "form",
  "iframe-form",
  "fetch-redirect-chain",
  "fetch-redirect-external",
  "websocket",
]) {
  test(`real ${action} submission sends zero unintended requests`, async () => {
    await localTransport(async (source, destination, counts) => {
      await assert.rejects(
        withFreshLoginPage(async (page) => {
          const assertAllowed = await guardLoginRequests(
            page.context(),
            new URL(source).origin,
            source,
          );
          await page.goto(source);
          const url = action.startsWith("fetch-redirect")
            ? `${source}307-${action.endsWith("chain") ? "chain" : "external"}`
            : destination;
          if (action === "websocket") {
            await page.evaluate(
              (destination) =>
                new Promise<void>((resolve) => {
                  const socket = new WebSocket(
                    destination.replace("http:", "ws:"),
                  );
                  socket.onerror = () => resolve();
                  socket.onclose = () => resolve();
                }),
              destination,
            );
            assertAllowed();
            return;
          }
          const failed = page.waitForEvent("requestfailed", {
            predicate: (request) => request.url() === url,
          });
          await page.evaluate(
            ({ url, action, canary }) => {
              if (action.startsWith("fetch")) {
                void fetch(url, {
                  method: "POST",
                  body: canary.password,
                }).catch(() => undefined);
              } else {
                const form = document.createElement("form");
                form.method = "POST";
                form.action = url;
                if (action === "iframe-form") {
                  const iframe = document.createElement("iframe");
                  iframe.name = "submission";
                  document.body.append(iframe);
                  form.target = iframe.name;
                }
                const input = document.createElement("input");
                input.name = "password";
                input.value = canary.password;
                form.append(input);
                document.body.append(form);
                form.submit();
              }
            },
            { url, action, canary },
          );
          await failed;
          assertAllowed();
        }),
      );
      assert.equal(counts.get("destination") ?? 0, 0);
      assert.equal(counts.get("/hop") ?? 0, 0);
      assert.equal(counts.get("/unapproved") ?? 0, 0);
      if (action.startsWith("fetch-redirect"))
        assert.equal(
          counts.get(`/307-${action.endsWith("chain") ? "chain" : "external"}`),
          1,
        );
    });
  });
}

for (const fault of ["context", "browser", "both"]) {
  for (const outcome of ["success", "failure", "cancel", "timeout"] as const) {
    test(`never-settling ${fault} close after ${outcome} is bounded, safe and disposes provider`, async () => {
      const { descriptor, request, provider } = fixture();
      const controller = new AbortController();
      const owned = ownedBrowser(
        outcome === "failure"
          ? "wrong-logo"
          : outcome === "success"
            ? "success"
            : "waiting",
        outcome === "cancel" ? () => controller.abort() : undefined,
      );
      let contextAttempts = 0;
      let browserAttempts = 0;
      let cleanupStarted = 0;
      let rescue: (() => Promise<void>) | undefined;
      const started = Date.now();
      try {
        await assert.rejects(
          verifyPartayLogin(descriptor, request, provider, {
            signal: controller.signal,
            timeoutMs: 2000,
            launchBrowser: async (timeout) => {
              const browser = await owned.launchBrowser(timeout);
              const browserClose = browser.close.bind(browser);
              rescue = browserClose;
              browser.close = async () => {
                browserAttempts += 1;
                if (fault !== "context")
                  await new Promise<void>(() => undefined);
                else await browserClose();
              };
              const newContext = browser.newContext.bind(browser);
              browser.newContext = async (options) => {
                const context = await newContext(options);
                const contextClose = context.close.bind(context);
                context.close = async () => {
                  contextAttempts += 1;
                  cleanupStarted = Date.now();
                  if (fault !== "browser")
                    await new Promise<void>(() => undefined);
                  else await contextClose();
                };
                return context;
              };
              return browser;
            },
          }),
          (error) =>
            assertFailure(
              error,
              outcome === "success" ? "cleanup" : "submission-assertion",
              "unconfirmed",
            ),
        );
        assert.ok(
          Date.now() - started < 2000 + LOGIN_CLEANUP_TIMEOUT_MS + 1500,
        );
        assert.equal(contextAttempts, 1);
        assert.equal(browserAttempts, 1);
        assert.equal(owned.submissions, 1);
        assert.ok(Date.now() - cleanupStarted < LOGIN_CLEANUP_TIMEOUT_MS + 300);
        await assertDisposed(provider, request);
      } finally {
        await rescue?.();
      }
    });
  }
}

test("close rejections arriving after the cleanup bound stay handled and cannot produce success", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("success");
  let rescue: (() => Promise<void>) | undefined;
  const lateCloses: Promise<void>[] = [];
  const lateReject = (): Promise<void> => {
    const rejection = delay(LOGIN_CLEANUP_TIMEOUT_MS + 200).then(() => {
      throw new Error(canary.password);
    });
    lateCloses.push(rejection);
    return rejection;
  };
  try {
    await assert.rejects(
      verifyPartayLogin(descriptor, request, provider, {
        launchBrowser: async (timeout) => {
          const browser = await owned.launchBrowser(timeout);
          rescue = browser.close.bind(browser);
          browser.close = lateReject;
          const newContext = browser.newContext.bind(browser);
          browser.newContext = async (options) => {
            const context = await newContext(options);
            context.close = lateReject;
            return context;
          };
          return browser;
        },
      }),
      assertSafe,
    );
    assert.equal(owned.submissions, 1);
    assert.equal(lateCloses.length, 2);
    await assertDisposed(provider, request);
    // Let both delayed failures arrive after the consumer has already returned.
    await delay(LOGIN_CLEANUP_TIMEOUT_MS);
  } finally {
    await rescue?.();
  }
});

test("cancellation during context acquisition closes late context and browser", async () => {
  const { descriptor, request, provider } = fixture();
  const controller = new AbortController();
  const owned = ownedBrowser("success");
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      signal: controller.signal,
      launchBrowser: async (timeout) => {
        const browser = await owned.launchBrowser(timeout);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (options) => {
          const context = await newContext(options);
          controller.abort();
          return context;
        };
        return browser;
      },
    }),
    assertSafe,
  );
  for (let i = 0; i < 100 && !owned.contextClosed; i += 1) await delay(20);
  assert.equal(owned.submissions, 0);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  await assertDisposed(provider, request);
});

test("cleanup errors cannot turn a completed login into success or expose secrets", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("success");
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      launchBrowser: async (timeout) => {
        const browser = await owned.launchBrowser(timeout);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (options) => {
          const context = await newContext(options);
          const close = context.close.bind(context);
          context.close = async () => {
            await close();
            throw new Error(canary.password);
          };
          return context;
        };
        return browser;
      },
    }),
    assertSafe,
  );
  assert.equal(owned.submissions, 1);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  await assertDisposed(provider, request);
});
