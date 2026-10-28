import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "node:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import type {
  PreparedInputDescriptor,
  RuntimeSecretProvider,
} from "../src/input-preparation";
import { reviewDataReferences } from "../src/input-preparation/data-references";
import {
  InMemoryRuntimeSecretProvider,
  RuntimeLoginError,
  type RuntimeLoginRequest,
} from "../src/input-preparation/runtime-login";
import {
  PARTAY_LOGIN_URL,
  verifyPartayLogin,
} from "../src/customer-login/partay";

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
        await context.route("**/*", async (route) => {
          requests.push(route.request().url());
          assert.equal(route.request().url(), PARTAY_LOGIN_URL);
          await route.fulfill({
            contentType: "text/html",
            body: `<!doctype html>
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
              </script>`,
          });
        });
        const newPage = context.newPage.bind(context);
        context.newPage = async () => {
          page = await newPage();
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
  return true;
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
      assertSafe,
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
    assertSafe,
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
      assertSafe,
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
    assertSafe,
  );
  await assertDisposed(provider, request);
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
