import assert from "node:assert/strict";
import { inspect } from "node:util";
import { mock, test } from "node:test";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
  type WebSocketRoute,
} from "@playwright/test";
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
  RUNTIME_LOGIN_FAILURE_CLASSIFICATIONS,
  RUNTIME_LOGIN_CLEANUP_STATUSES,
  RUNTIME_LOGIN_POLICY_REASONS,
  consumeRuntimeLoginInputs,
  type RuntimeLoginRequest,
} from "../src/input-preparation/runtime-login";
import {
  PARTAY_LOGIN_URL,
  verifyPartayLogin,
  partayLoginFailureReport,
  privateFileAndVerifyPartayLogin,
} from "../src/customer-login/partay";
import {
  guardLoginRequests,
  LOGIN_CLEANUP_TIMEOUT_MS,
  withFreshLoginPage,
} from "../src/execution/runtime-login-browser";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import fsPromises = require("node:fs/promises");
import runtimeLoginModule = require("../src/input-preparation/runtime-login");
import { tmpdir } from "node:os";
import {
  PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE,
  PrivateFileLoginDeferredError,
  withPrivateFileLoginInputs,
} from "../src/input-preparation/private-login-file";

const canary = {
  username: "OWNED_WEB8_USERNAME_CANARY",
  password: "OWNED_WEB8_PASSWORD_CANARY",
};

test("private-file entry points reject before touching or consuming synthetic input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "owned-private-login-"));
  const file = join(directory, "account.json");
  const repositoryRoot = join(directory, "repository");
  const contents = JSON.stringify(canary);
  const { descriptor, request, provider } = fixture();
  provider.dispose();
  let consumed = 0;
  let browserAcquisitions = 0;
  try {
    await mkdir(repositoryRoot, { mode: 0o700 });
    await writeFile(file, contents, { mode: 0o600 });
    const fileSpies = [
      mock.method(fsPromises, "access"),
      mock.method(fsPromises, "lstat"),
      mock.method(fsPromises, "open"),
      mock.method(fsPromises, "readFile"),
      mock.method(fsPromises, "realpath"),
      mock.method(fsPromises, "stat"),
      mock.method(fsPromises, "unlink"),
    ];
    const providerSpy = mock.method(
      runtimeLoginModule,
      "InMemoryRuntimeSecretProvider",
    );
    const consumerSpy = mock.method(
      runtimeLoginModule,
      "consumeRuntimeLoginInputs",
    );
    try {
      await assert.rejects(
        withPrivateFileLoginInputs(
          descriptor,
          request,
          file,
          repositoryRoot,
          async () => {
            consumed += 1;
          },
        ),
        assertPrivateFileDeferred,
      );
      await assert.rejects(
        privateFileAndVerifyPartayLogin(
          descriptor,
          request,
          file,
          repositoryRoot,
          {
            launchBrowser: async () => {
              browserAcquisitions += 1;
              throw new Error("Unexpected browser acquisition");
            },
          },
        ),
        assertPrivateFileDeferred,
      );
      assert.deepEqual(
        fileSpies.map((spy) => spy.mock.calls.length),
        [0, 0, 0, 0, 0, 0, 0],
      );
      assert.equal(providerSpy.mock.calls.length, 0);
      assert.equal(consumerSpy.mock.calls.length, 0);
      assert.equal(consumed, 0);
      assert.equal(browserAcquisitions, 0);
    } finally {
      for (const spy of fileSpies) spy.mock.restore();
      providerSpy.mock.restore();
      consumerSpy.mock.restore();
    }
    assert.equal(await readFile(file, "utf8"), contents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function assertPrivateFileDeferred(error: unknown): boolean {
  assert.ok(error instanceof PrivateFileLoginDeferredError);
  assert.equal(error.message, PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE);
  assert.ok(!inspect(error).includes(canary.username));
  assert.ok(!inspect(error).includes(canary.password));
  return true;
}

test("CLI rejects private-account-file mode before reading references or dispatching login", async () => {
  const directory = await mkdtemp(join(tmpdir(), "owned-private-cli-"));
  const file = join(directory, "account.json");
  const contents = JSON.stringify(canary);
  try {
    await writeFile(file, contents, { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [join(__dirname, "fixtures/private-file-cli.js"), file],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      referenceReads: 0,
      promptCalls: 0,
      fileCalls: 0,
    });
    assert.equal(result.stderr, `${PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE}\n`);
    assert.equal(await readFile(file, "utf8"), contents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI help documents that private-account-file input is deferred from MVP", () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, "verify-partay-login.js"), "--help"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--private-account-file/);
  assert.match(result.stdout, /deferred and excluded from the MVP/);
  assert.equal(result.stderr, "");
});

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
  | "missing-username"
  | "missing-password"
  | "disabled-submit"
  | "blocked-request"
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
                <input id="${mode === "missing-username" ? "other-user" : "username"}"><input id="${mode === "missing-password" ? "other-password" : "password"}" type="password">
                <button id="authGo" ${mode === "disabled-submit" ? "disabled" : ""}>Sign in</button>
              </div>
              <script>
                authGo.onclick = async () => {
                  authGo.disabled = true;
                  await ownedSubmit();
                  if (username.value !== ${JSON.stringify(canary.username)} ||
                      password.value !== ${JSON.stringify(canary.password)}) return;
                  if (${JSON.stringify(mode)} === "waiting" || ${JSON.stringify(mode)} === "rejected") return;
                  if (${JSON.stringify(mode)} === "redirect") { location.href = "/not-permitted"; return; }
                  if (${JSON.stringify(mode)} === "blocked-request") {
                    try { await fetch("https://blocked.invalid/", {method:"POST"}); } catch {}
                  }
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
  policyReason?: RuntimeLoginFailure["policyReason"],
): boolean {
  assertSafe(error);
  const { failureClassification, ...report } = partayLoginFailureReport(error);
  assert.ok(
    RUNTIME_LOGIN_FAILURE_CLASSIFICATIONS.includes(failureClassification),
  );
  assert.deepEqual(report, {
    status: "not-verified",
    failureStage,
    cleanupStatus,
    ...(policyReason ? { policyReason } : {}),
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
        failureClassification: "unknown",
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
      failureClassification: "unknown",
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

test("policy reason accepts only primitive allowlisted values and ignores poisoned accessors", () => {
  let invoked = 0;
  const poison = {
    toString() {
      invoked += 1;
      throw new Error(canary.password);
    },
    toJSON() {
      invoked += 1;
      return canary.password;
    },
  };
  for (const value of [
    canary.password,
    `http-redirect ${canary.username}`,
    "https://owned.invalid/private",
    ["off-origin"],
    poison,
    new String("websocket"),
    null,
    undefined,
  ]) {
    assertFailure(
      new RuntimeLoginFailure("request-policy", "confirmed", value),
      "request-policy",
      "confirmed",
    );
    const poisoned = Object.assign(
      new RuntimeLoginFailure("request-policy", "confirmed"),
      { policyReason: value, cause: new Error(canary.password) },
    );
    assertFailure(
      RuntimeLoginFailure.fromUnknown(poisoned),
      "request-policy",
      "confirmed",
    );
  }
  const accessor = new RuntimeLoginFailure(
    "request-policy",
    "confirmed",
    "off-origin",
  );
  for (const key of [
    "failureStage",
    "cleanupStatus",
    "policyReason",
    "failureClassification",
  ]) {
    Object.defineProperty(accessor, key, {
      get() {
        invoked += 1;
        throw new Error(canary.password);
      },
    });
  }
  assert.deepEqual(
    partayLoginFailureReport(accessor),
    partayLoginFailureReport(undefined),
  );
  const proxy = new Proxy(accessor, {
    getOwnPropertyDescriptor() {
      throw new Error(canary.password);
    },
  });
  assert.deepEqual(
    partayLoginFailureReport(proxy),
    partayLoginFailureReport(undefined),
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.deepEqual(
    partayLoginFailureReport(revoked.proxy),
    partayLoginFailureReport(undefined),
  );
  assert.equal(invoked, 0);
});

for (const reason of RUNTIME_LOGIN_POLICY_REASONS) {
  test(`offline ${reason} propagates through guard, cleanup, input disposal and CLI without raw data`, async () => {
    const { descriptor, request, provider } = fixture();
    let handleRequest!: (route: Route) => Promise<void>;
    let handleSocket!: (socket: WebSocketRoute) => void;
    let fetched = 0;
    let aborted = 0;
    let disposed = 0;
    let socketClosed = 0;
    const context = {
      route: async (_pattern: string, handler: typeof handleRequest) => {
        handleRequest = handler;
      },
      routeWebSocket: async (
        _pattern: string,
        handler: typeof handleSocket,
      ) => {
        handleSocket = handler;
      },
    } as unknown as BrowserContext;
    const login = "http://127.0.0.1:1/";
    const assertAllowed = await guardLoginRequests(
      context,
      new URL(login).origin,
      login,
    );
    const route = {
      request: () => ({
        url: () =>
          reason === "off-origin"
            ? `http://127.0.0.1:2/${canary.password}`
            : reason === "document-destination"
              ? `${login}${canary.password}`
              : login,
        isNavigationRequest: () => true,
      }),
      abort: async () => {
        aborted += 1;
      },
      fetch: async (options: unknown) => {
        fetched += 1;
        assert.deepEqual(options, { maxRedirects: 0 });
        if (reason === "transport-error")
          throw new Error(canary.password, { cause: canary.username });
        return {
          status: () => 302,
          dispose: async () => {
            disposed += 1;
          },
        };
      },
      fulfill: async () =>
        assert.fail("Blocked response must not be fulfilled"),
    } as unknown as Route;
    if (reason === "websocket")
      handleSocket({
        close: () => {
          socketClosed += 1;
        },
      } as unknown as WebSocketRoute);
    else await handleRequest(route);
    assert.equal(
      fetched,
      ["http-redirect", "transport-error"].includes(reason) ? 1 : 0,
    );
    assert.equal(disposed, reason === "http-redirect" ? 1 : 0);
    assert.equal(aborted, reason === "websocket" ? 0 : 1);
    assert.equal(socketClosed, reason === "websocket" ? 1 : 0);
    // A later failure must not replace the first category.
    await handleRequest({
      ...route,
      fetch: async () => {
        throw new Error(canary.password);
      },
      request: () => ({ url: () => login, isNavigationRequest: () => false }),
    } as unknown as Route);
    let closes = 0;
    let launches = 0;
    await assert.rejects(
      consumeRuntimeLoginInputs(
        descriptor,
        request,
        {
          resolve: provider.resolve.bind(provider),
          dispose: () => {
            provider.dispose();
            throw new Error(canary.password);
          },
        },
        async () =>
          withFreshLoginPage(
            async (_page, setStage) => {
              setStage("request-policy");
              assertAllowed();
            },
            {
              launchBrowser: async () => {
                launches += 1;
                return {
                  close: async () => {
                    closes += 1;
                  },
                  newContext: async () => ({
                    close: async () => {
                      closes += 1;
                    },
                    newPage: async () => ({
                      setDefaultTimeout() {},
                      setDefaultNavigationTimeout() {},
                    }),
                  }),
                } as unknown as Browser;
              },
            },
          ),
      ),
      (error) => assertFailure(error, "request-policy", "confirmed", reason),
    );
    assert.equal(launches, 1);
    assert.equal(closes, 2);
    await assertDisposed(provider, request);

    // Exercise the real CLI serializer with an in-process stub; no prompt,
    // customer navigation, files, credentials or runtime request is needed.
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const runtime = require(${JSON.stringify(join(__dirname, "../src/input-preparation/runtime-login.js"))});
      const partay = require(${JSON.stringify(join(__dirname, "../src/customer-login/partay.js"))});
      const fs = require("node:fs");
      const read = fs.readFileSync;
      fs.readFileSync = (path, ...args) =>
        path === "descriptor" || path === "request" ? "{}" : read(path, ...args);
      process.argv = [process.execPath, "owned-cli", "descriptor", "request"];
      partay.promptAndVerifyPartayLogin = async () => {
        const error = new runtime.RuntimeLoginFailure("request-policy", "confirmed", ${JSON.stringify(reason)});
        error.message = ${JSON.stringify(canary.password)};
        error.cause = new Error(${JSON.stringify(canary.username)});
        throw error;
      };
      require(${JSON.stringify(join(__dirname, "verify-partay-login.js"))});
    `,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(
      JSON.parse(result.stderr),
      partayLoginFailureReport(
        new RuntimeLoginFailure("request-policy", "confirmed", reason),
      ),
    );
  });
}

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
      failureClassification: "input",
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
  "missing-username",
  "missing-password",
  "disabled-submit",
  "blocked-request",
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
        const stages = {
          rejected: "overlay-dismissal",
          "wrong-url": "final-url",
          "wrong-logo": "brand-text",
          "hidden-logo": "brand-visible",
          redirect: "request-policy",
          "missing-form": "form-visible",
          "missing-username": "username-fill",
          "missing-password": "password-fill",
          "disabled-submit": "submit-click",
          "blocked-request": "request-policy",
        };
        assert.equal(error.failureStage, stages[mode]);
        // Deadline cancellation closes both resources independently; a close
        // rejection must not be upgraded merely because the process exited.
        if (mode === "wrong-logo")
          assert.equal(error.cleanupStatus, "confirmed");
        else assert.notEqual(error.cleanupStatus, "not-acquired");
        return true;
      },
    );
    assert.equal(
      owned.submissions,
      [
        "missing-form",
        "missing-username",
        "missing-password",
        "disabled-submit",
      ].includes(mode)
        ? 0
        : 1,
    );
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
      assert.ok(
        ["submit-click", "overlay-dismissal"].includes(error.failureStage),
      );
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
              outcome === "success"
                ? "cleanup"
                : outcome === "failure"
                  ? "brand-text"
                  : outcome === "cancel"
                    ? "submit-click"
                    : "overlay-dismissal",
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

test("Given legacy or raw assertion-shaped errors, when reported, then evidence stays unknown", () => {
  for (const error of [
    new Error("AssertionError: expected Partay"),
    new RuntimeLoginFailure("brand-text", "confirmed"),
    { failureStage: "brand-text", failureClassification: "assertion-failed" },
  ]) {
    assert.equal(
      partayLoginFailureReport(error).failureClassification,
      "unknown",
    );
  }
});

test("Given a completed value mismatch, when cleanup finishes, then it is assertion evidence only", async () => {
  const { descriptor, request, provider } = fixture();
  await assert.rejects(
    verifyPartayLogin(
      descriptor,
      request,
      provider,
      ownedBrowser("wrong-logo"),
    ),
    (error) => {
      const report = partayLoginFailureReport(error);
      assert.equal(report.failureClassification, "assertion-failed");
      assert.equal(report.failureStage, "brand-text");
      assert.equal(report.cleanupStatus, "confirmed");
      assert.equal(report.status, "not-verified");
      return true;
    },
  );
});

for (const outcome of [
  "assertion",
  "raw-error",
  "navigation",
  "cancel",
  "timeout",
  "policy-before-error",
  "policy-during-cleanup",
  "cancel-during-cleanup",
  "deadline-during-cleanup",
  "policy-with-cancel-during-cleanup",
  "policy-with-deadline-during-cleanup",
  "pending-transport",
  "cleanup-failure",
] as const) {
  test(`Given ${outcome}, when login evidence is finalized, then only a completed comparison is classified as an assertion`, async () => {
    const controller = new AbortController();
    let requestHandler: (route: Route) => Promise<void> = async () => undefined;
    let closes = 0;
    const blockedRequest = (): Promise<void> =>
      requestHandler({
        request: () => ({
          url: () => "https://blocked.invalid/",
          isNavigationRequest: () => false,
        }),
        abort: async () => undefined,
      } as unknown as Route);
    const context = {
      routeWebSocket: async () => undefined,
      route: async (_pattern: string, handler: typeof requestHandler) => {
        requestHandler = handler;
      },
      close: async () => {
        closes += 1;
        if (outcome.includes("cancel-during-cleanup")) controller.abort();
        if (outcome.includes("deadline-during-cleanup")) await delay(60);
        if (outcome.startsWith("policy") && outcome.endsWith("during-cleanup"))
          await blockedRequest();
        if (outcome === "cleanup-failure") throw new Error(canary.password);
      },
      newPage: async () => ({
        context: () => context,
        setDefaultTimeout() {},
        setDefaultNavigationTimeout() {},
      }),
    } as unknown as BrowserContext;
    await assert.rejects(
      withFreshLoginPage(
        async (_page, setStage) => {
          await guardLoginRequests(
            context,
            new URL(PARTAY_LOGIN_URL).origin,
            PARTAY_LOGIN_URL,
          );
          setStage(outcome === "navigation" ? "navigation" : "brand-text");
          if (outcome === "timeout") await new Promise<void>(() => undefined);
          if (outcome === "cancel") controller.abort();
          if (outcome === "policy-before-error") await blockedRequest();
          if (outcome === "pending-transport") {
            void requestHandler({
              request: () => ({
                url: () => PARTAY_LOGIN_URL,
                isNavigationRequest: () => false,
              }),
              fetch: () => new Promise(() => undefined),
            } as unknown as Route);
          }
          if (outcome === "raw-error" || outcome === "navigation")
            throw new Error(canary.password);
          throw new RuntimeLoginFailure(
            "brand-text",
            "unconfirmed",
            undefined,
            "assertion-failed",
          );
        },
        {
          timeoutMs: 50,
          signal: controller.signal,
          launchBrowser: async () =>
            ({
              newContext: async () => context,
              close: async () => {
                closes += 1;
              },
            }) as unknown as Browser,
        },
      ),
      (error) => {
        assertSafe(error);
        const report = partayLoginFailureReport(error);
        const expected = {
          assertion: "assertion-failed",
          "raw-error": "operational",
          navigation: "navigation",
          cancel: "interrupted",
          timeout: "timed-out",
          "policy-before-error": "request-policy",
          "policy-during-cleanup": "request-policy",
          "cancel-during-cleanup": "interrupted",
          "deadline-during-cleanup": "timed-out",
          "policy-with-cancel-during-cleanup": "request-policy",
          "policy-with-deadline-during-cleanup": "request-policy",
          "pending-transport": "request-policy",
          "cleanup-failure": "assertion-failed",
        };
        assert.equal(report.failureClassification, expected[outcome]);
        assert.equal(
          report.cleanupStatus,
          outcome === "cleanup-failure" ? "unconfirmed" : "confirmed",
        );
        if (outcome.startsWith("policy")) {
          assert.equal(report.failureStage, "request-policy");
          assert.equal(report.policyReason, "off-origin");
        }
        return true;
      },
    );
    assert.equal(closes, 2);
  });
}

test("Given failed input disposal after an assertion, then evidence is operational with browser cleanup separate", async () => {
  const { descriptor, request, provider } = fixture();
  await assert.rejects(
    consumeRuntimeLoginInputs(
      descriptor,
      request,
      {
        resolve: provider.resolve.bind(provider),
        dispose() {
          provider.dispose();
          throw new Error(canary.password);
        },
      },
      async () => {
        throw new RuntimeLoginFailure(
          "brand-text",
          "confirmed",
          undefined,
          "assertion-failed",
        );
      },
    ),
    (error) => {
      assertSafe(error);
      assert.equal(
        partayLoginFailureReport(error).failureClassification,
        "operational",
      );
      assert.equal(partayLoginFailureReport(error).cleanupStatus, "confirmed");
      return true;
    },
  );
});

test("Given invalid or accessor classification, then the report never promotes it to assertion evidence", () => {
  for (const value of [
    canary.password,
    new String("assertion-failed"),
    { toString: () => "assertion-failed" },
  ]) {
    const error = new RuntimeLoginFailure(
      "brand-text",
      "confirmed",
      undefined,
      value,
    );
    assert.equal(
      partayLoginFailureReport(error).failureClassification,
      "unknown",
    );
  }
  const error = new RuntimeLoginFailure(
    "brand-text",
    "confirmed",
    undefined,
    "assertion-failed",
  );
  Object.defineProperty(error, "failureClassification", {
    get() {
      throw new Error(canary.password);
    },
  });
  assert.equal(
    partayLoginFailureReport(error).failureClassification,
    "unknown",
  );
  assert.equal(
    partayLoginFailureReport(
      new RuntimeLoginFailure(
        "navigation",
        "confirmed",
        undefined,
        "assertion-failed",
      ),
    ).failureClassification,
    "unknown",
  );
});

// The real public API, existing provider and lifecycle consume an owned page.
// Only route.fetch is remapped to loopback; no customer destination is contacted.
for (const state of [
  "authenticated",
  "onboarding",
  "unknown-gate",
  "missing-me",
  "visible-onboarding",
  "registration",
] as const) {
  test(`Authentication-only public login with ${state} retains truthful scope and disposes inputs`, async () => {
    const { descriptor, request, provider } = fixture();
    const { PARTAY_AUTHENTICATION_ONLY_POLICY } = await import(
      "../src/customer-login/authentication-only"
    );
    const hits: string[] = [];
    let contextClosed = false;
    let browserClosed = false;
    const server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<div id="brandLogo">Partay</div><div id="overlay"><input id="username"><input id="password" type="password" autocomplete="current-password"><div id="authUp" hidden></div><button id="authGo">Sign in</button></div><div id="onboard" hidden>Onboarding</div><div id="bottomnav" hidden>Navigation</div>',
        );
      } else {
        res.end('{"token":"OWNED_RESPONSE_CANARY"}');
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      const operation = verifyPartayLogin(descriptor, request, provider, {
        authenticationOnlyPolicy: PARTAY_AUTHENTICATION_ONLY_POLICY,
        timeoutMs: 5000,
        launchBrowser: async () => {
          const browser = await chromium.launch();
          browser.on("disconnected", () => {
            browserClosed = true;
          });
          const newContext = browser.newContext.bind(browser);
          browser.newContext = async (options) => {
            assert.equal(options?.serviceWorkers, "block");
            const context = await newContext(options);
            context.on("close", () => {
              contextClosed = true;
            });
            const register = context.route.bind(context);
            context.route = async (matcher, handler) =>
              register(matcher, async (route, req) => {
                route.fetch = async (opts) => {
                  assert.equal(opts?.maxRedirects, 0);
                  assert.equal(opts?.maxRetries, 0);
                  const path = new URL(req.url()).pathname;
                  // Deliberately do not forward or inspect input values/headers.
                  return context.request.fetch(
                    `http://127.0.0.1:${address.port}${path}`,
                    { method: req.method(), maxRedirects: 0 },
                  );
                };
                await handler(route, req);
              });
            const newPage = context.newPage.bind(context);
            context.newPage = async () => {
              const page = await newPage();
              const goto = page.goto.bind(page);
              page.goto = async (url, opts) => {
                const response = await goto(url, opts);
                await page.evaluate((state) => {
                  const button = document.getElementById("authGo")!;
                  if (state === "registration")
                    button.textContent = "Create account";
                  button.onclick = async () => {
                    await fetch("/auth/login", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                      },
                    });
                    if (state !== "missing-me") await fetch("/me");
                    document.getElementById("overlay")!.hidden = true;
                    if (state === "onboarding") {
                      await fetch("/agent/characters").catch(() => undefined);
                      document.getElementById("onboard")!.hidden = false;
                    } else if (
                      [
                        "authenticated",
                        "missing-me",
                        "visible-onboarding",
                      ].includes(state)
                    ) {
                      if (state === "visible-onboarding")
                        document.getElementById("onboard")!.hidden = false;
                      document.getElementById("bottomnav")!.hidden = false;
                      await fetch("/agent/greeting").catch(() => undefined);
                    }
                  };
                }, state);
                return response;
              };
              return page;
            };
            return context;
          };
          return browser;
        },
      });
      if (state === "authenticated") {
        const result = await operation;
        assert.equal(result.authenticationOnly?.scope, "authentication-only");
        assert.equal(result.authenticationOnly?.downstream, "untested-blocked");
        assert.equal(result.authenticationOnly?.productDefectEvidence, false);
        assert.equal(result.authenticationOnly?.excludedBackgroundRequests, 1);
        assert.ok(!JSON.stringify(result).includes("CANARY"));
        assert.deepEqual(hits, ["GET /", "POST /auth/login", "GET /me"]);
      } else {
        await assert.rejects(operation, (error) => {
          assertSafe(error);
          assert.notEqual(
            partayLoginFailureReport(error).failureClassification,
            "assertion-failed",
          );
          return true;
        });
        assert.ok(!hits.includes("GET /agent/characters"));
        if (state === "registration") assert.deepEqual(hits, ["GET /"]);
      }
      assert.equal(contextClosed, true);
      assert.equal(browserClosed, true);
      await assertDisposed(provider, request);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test("Given an unknown explicit policy binding, reject before resolving inputs or acquiring a browser and dispose the provider", async () => {
  const { descriptor, request, provider } = fixture();
  let resolutions = 0;
  let launches = 0;
  await assert.rejects(
    verifyPartayLogin(
      descriptor,
      request,
      {
        resolve: async () => {
          resolutions++;
          return "SYNTHETIC_CANARY";
        },
        dispose: () => provider.dispose(),
      },
      {
        authenticationOnlyPolicy: {
          id: "unknown",
          revision: "v1",
        } as unknown as import("../src/customer-login/authentication-only").AuthenticationOnlyBinding,
        launchBrowser: async () => {
          launches++;
          throw new Error("Unexpected launch");
        },
      },
    ),
    assertSafe,
  );
  assert.equal(resolutions, 0);
  assert.equal(launches, 0);
  await assertDisposed(provider, request);
});
