import assert from "node:assert/strict";
import { inspect } from "node:util";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import type {
  PreparedInputDescriptor,
  RuntimeSecretProvider,
} from "../src/input-preparation";
import { reviewDataReferences } from "../src/input-preparation/data-references";
import {
  consumeRuntimeLoginInputs,
  InMemoryRuntimeSecretProvider,
  RuntimeLoginError,
  validateRuntimeLoginRequest,
  type RuntimeLoginRequest,
} from "../src/input-preparation/runtime-login";
import { withOperatorLoginInputs } from "../src/input-preparation/operator-prompt";

const canary = {
  username: "SYNTHETIC_ACCOUNT_CANARY_2026",
  password: "SYNTHETIC_PASSWORD_CANARY_2026",
};

function fixture() {
  const reviewed = reviewDataReferences(
    {
      version: 1,
      rows: [
        {
          scenarioId: "owned-login",
          dataset: { id: "owned-demo", revision: "v1" },
          rowId: "row-a",
          secret: { id: "owned-account", revision: "account-v1" },
        },
      ],
    },
    {
      datasets: [{ id: "owned-demo", revision: "v1", rows: ["row-a"] }],
      secrets: [{ id: "owned-account", revision: "account-v1" }],
    },
  );
  const environment = {
    id: "owned-environment",
    revision: "env-v1",
    approvedOrigin: "https://owned.example.test",
  };
  const request: RuntimeLoginRequest = {
    scope: {
      projectId: "owned-project",
      runId: "owned-run",
      scenarioId: "owned-login",
      dataBinding: reviewed.binding,
      environment,
    },
    account: { id: "owned-account", revision: "account-v1" },
    expiresAt: Date.now() + 60_000,
  };
  const descriptor: PreparedInputDescriptor = {
    version: 1,
    environment: {
      ...environment,
      initialTargetUrl: `${environment.approvedOrigin}/`,
    },
    review: {
      sourceRevision: "source-v1",
      featureRevision: "feature-v1",
      implementationRevision: "implementation-v1",
    },
    fixturePolicy: { id: "owned-policy", revision: "policy-v1" },
    fixtureRevision: "fixtures-v1",
    dataReferences: reviewed,
    scenarios: [
      {
        id: "owned-login",
        tags: ["@RRDWEB-3-login-S01", "@RRDWEB-3-login-S03"],
        dataReference: reviewed.rows[0],
        values: { displayName: "Owned synthetic visitor" },
        account: {
          reference: "owned-account",
          secretReference: { id: "owned-account" },
        },
        cleanup: {
          requested: true,
          authorizationStatus: "unverified",
          reference: "owned-cleanup",
          requestedRevision: "cleanup-v1",
          outcome: "unknown",
        },
      },
    ],
  };
  return { request, descriptor };
}

class TerminalInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  rawTransitions: boolean[] = [];
  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    this.rawTransitions.push(mode);
    return this;
  }
}

class TerminalOutput extends PassThrough {
  isTTY = true;
  transcript = "";
  constructor(
    input: TerminalInput,
    answers: string[] = [canary.username, canary.password],
  ) {
    super();
    this.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.transcript += text;
      if (text.endsWith("(hidden): ")) {
        const answer = answers.shift();
        if (answer !== undefined)
          setImmediate(() => input.write(`${answer}\r`));
      }
    });
  }
}

function assertNoCanaries(value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.ok(!text.includes(canary.username));
  assert.ok(!text.includes(canary.password));
}

test("per-run provider delivers only the reviewed revision within the permitted scope", async () => {
  const { request } = fixture();
  const provider = new InMemoryRuntimeSecretProvider(request, canary);
  try {
    assert.equal(
      await provider.resolve(
        { ...request.account, field: "username" },
        request.scope,
      ),
      canary.username,
    );
    assert.equal(
      await provider.resolve(
        { ...request.account, field: "password" },
        request.scope,
      ),
      canary.password,
    );
    for (const scope of [
      undefined,
      { ...request.scope, runId: "another-run" },
      { ...request.scope, projectId: "another-project" },
      { ...request.scope, scenarioId: "another-scenario" },
      { ...request.scope, dataBinding: "0".repeat(64) },
      {
        ...request.scope,
        environment: {
          ...request.scope.environment,
          id: "another-environment",
        },
      },
      {
        ...request.scope,
        environment: { ...request.scope.environment, revision: "env-v2" },
      },
      {
        ...request.scope,
        environment: {
          ...request.scope.environment,
          approvedOrigin: "https://other.example.test",
        },
      },
    ]) {
      await assert.rejects(
        provider.resolve({ ...request.account, field: "password" }, scope),
        { code: "runtime-scope-mismatch" },
      );
    }
    for (const reference of [
      { ...request.account, field: "password" as const, id: "other-account" },
      {
        ...request.account,
        field: "password" as const,
        revision: "account-v2",
      },
      { id: request.account.id },
    ]) {
      await assert.rejects(provider.resolve(reference, request.scope), {
        code: "runtime-scope-mismatch",
      });
    }
    assertNoCanaries(provider);
    assertNoCanaries(inspect(provider));
  } finally {
    provider.dispose();
  }
  await assert.rejects(
    provider.resolve({ ...request.account, field: "password" }, request.scope),
    { code: "runtime-input-unavailable" },
  );
});

test("missing, empty, whitespace-only and expired inputs reject before the consumer", async () => {
  const { request, descriptor } = fixture();
  for (const account of [
    { username: "", password: canary.password },
    { username: canary.username, password: "" },
    { username: " ", password: canary.password },
    { username: canary.username, password: " " },
  ]) {
    assert.throws(() => new InMemoryRuntimeSecretProvider(request, account), {
      code: "invalid-runtime-input",
    });
  }
  for (const missing of [undefined, null, {}, { username: canary.username }]) {
    assert.throws(
      () =>
        Reflect.construct(InMemoryRuntimeSecretProvider, [request, missing]),
      { code: "invalid-runtime-input" },
    );
  }
  for (const missing of [
    undefined,
    {},
    { scenarios: [] },
    { ...descriptor, dataReferences: undefined },
    { ...descriptor, environment: undefined },
  ]) {
    assert.throws(
      () =>
        Reflect.apply(validateRuntimeLoginRequest, undefined, [
          missing,
          request,
        ]),
      { code: "invalid-runtime-input" },
    );
  }
  assert.throws(
    () =>
      new InMemoryRuntimeSecretProvider(
        { ...request, expiresAt: Date.now() - 1 },
        canary,
      ),
    { code: "expired-runtime-input" },
  );
  let browserStarts = 0;
  for (const changed of [
    { ...request, expiresAt: Date.now() - 1 },
    { ...request, account: { ...request.account, revision: "account-v2" } },
    { ...request, scope: { ...request.scope, runId: "other-run" } },
  ]) {
    const provider = new InMemoryRuntimeSecretProvider(request, canary);
    try {
      await assert.rejects(
        consumeRuntimeLoginInputs(descriptor, changed, provider, async () => {
          browserStarts += 1;
        }),
        RuntimeLoginError,
      );
    } finally {
      provider.dispose();
    }
  }
  assert.equal(browserStarts, 0);
  const emptyProvider: RuntimeSecretProvider = { resolve: async () => "" };
  await assert.rejects(
    consumeRuntimeLoginInputs(descriptor, request, emptyProvider, async () => {
      browserStarts += 1;
    }),
    { code: "invalid-runtime-input" },
  );
  assert.equal(browserStarts, 0);
});

test("provider expiry releases retained values and cannot authorize a later run", async () => {
  const { request } = fixture();
  const provider = new InMemoryRuntimeSecretProvider(
    { ...request, expiresAt: Date.now() + 50 },
    canary,
  );
  await delay(80);
  await assert.rejects(
    provider.resolve({ ...request.account, field: "password" }, request.scope),
    { code: "expired-runtime-input" },
  );
  provider.dispose();
  assertNoCanaries(inspect(provider));
});

test("provider retains independent copies and rejects payload-shaped reference additions", async () => {
  const { request } = fixture();
  const mutableRequest = {
    ...request,
    scope: {
      ...request.scope,
      environment: { ...request.scope.environment },
    },
    account: { ...request.account },
  };
  const supplied = { ...canary };
  const provider = new InMemoryRuntimeSecretProvider(mutableRequest, supplied);
  mutableRequest.scope.runId = "changed-run";
  mutableRequest.scope.environment.revision = "changed-environment";
  mutableRequest.account.revision = "changed-account";
  supplied.password = "changed-value";
  try {
    assert.equal(
      await provider.resolve(
        { ...request.account, field: "password" },
        request.scope,
      ),
      canary.password,
    );
    const payloadReference = {
      ...request.account,
      field: "password" as const,
      value: canary.password,
    };
    await assert.rejects(provider.resolve(payloadReference, request.scope), {
      code: "runtime-scope-mismatch",
    });
  } finally {
    provider.dispose();
  }
});

test("consumer completion, failure and invalid scope all dispose the injected run provider", async () => {
  for (const outcome of ["complete", "throw", "scope"] as const) {
    const { request, descriptor } = fixture();
    const provider = new InMemoryRuntimeSecretProvider(request, canary);
    const execution = consumeRuntimeLoginInputs(
      descriptor,
      outcome === "scope"
        ? { ...request, scope: { ...request.scope, runId: "another-run" } }
        : request,
      provider,
      async () => {
        if (outcome === "throw") throw new Error(canary.password);
      },
    );
    if (outcome === "complete") {
      assertNoCanaries(await execution);
    } else {
      await assert.rejects(execution, (error: unknown) => {
        assert.ok(error instanceof RuntimeLoginError);
        assertNoCanaries(inspect(error));
        return true;
      });
    }
    await assert.rejects(
      provider.resolve(
        { ...request.account, field: "password" },
        request.scope,
      ),
      { code: "runtime-input-unavailable" },
    );
  }
});

test("provider exceptions and expiry during async resolution cannot leak or start the consumer", async () => {
  const { request, descriptor } = fixture();
  let browserStarts = 0;
  for (const provider of [
    {
      resolve: async () => {
        throw new Error(canary.password);
      },
    },
    {
      resolve: async () => {
        throw { value: canary.username };
      },
    },
  ]) {
    await assert.rejects(
      consumeRuntimeLoginInputs(descriptor, request, provider, async () => {
        browserStarts += 1;
      }),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeLoginError);
        assertNoCanaries(inspect(error));
        return true;
      },
    );
  }
  const expiresSoon = { ...request, expiresAt: Date.now() + 50 };
  await assert.rejects(
    consumeRuntimeLoginInputs(
      descriptor,
      expiresSoon,
      {
        resolve: async () => {
          await delay(80);
          return canary.password;
        },
      },
      async () => {
        browserStarts += 1;
      },
    ),
    { code: "expired-runtime-input" },
  );
  assert.equal(browserStarts, 0);
});

test("runtime login errors never log canaries or mutate the ordinary worker payload", async () => {
  const { request, descriptor } = fixture();
  const ordinaryPayload = JSON.stringify({
    scenario: {
      id: descriptor.scenarios[0]?.id,
      values: descriptor.scenarios[0]?.values,
    },
    environment: descriptor.environment,
    redirectTargetUrl: "http://127.0.0.1:41731/redirect",
  });
  const previousPayload = process.env.WEB_EXECUTION_PAYLOAD;
  const previousArguments = [...process.argv];
  const logged: unknown[][] = [];
  const originals = {
    debug: console.debug,
    info: console.info,
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const capture = (...args: unknown[]) => logged.push(args);
  process.env.WEB_EXECUTION_PAYLOAD = ordinaryPayload;
  console.debug = capture;
  console.info = capture;
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    assertNoCanaries(ordinaryPayload);
    await assert.rejects(
      consumeRuntimeLoginInputs(
        descriptor,
        request,
        new InMemoryRuntimeSecretProvider(request, canary),
        async (account) => {
          assert.equal(account.username, canary.username);
          assert.equal(account.password, canary.password);
          assert.equal(process.env.WEB_EXECUTION_PAYLOAD, ordinaryPayload);
          assert.deepEqual(process.argv, previousArguments);
          throw new Error(`${canary.username}:${canary.password}`);
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeLoginError);
        assertNoCanaries(inspect(error));
        return true;
      },
    );
    assert.equal(process.env.WEB_EXECUTION_PAYLOAD, ordinaryPayload);
    assert.deepEqual(process.argv, previousArguments);
  } finally {
    console.debug = originals.debug;
    console.info = originals.info;
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
    if (previousPayload === undefined) {
      delete process.env.WEB_EXECUTION_PAYLOAD;
    } else {
      process.env.WEB_EXECUTION_PAYLOAD = previousPayload;
    }
  }
  assertNoCanaries(inspect(logged));
});

test("real owned browser consumes runtime credentials with fresh session isolation", async () => {
  const { request, descriptor } = fixture();
  const provider = new InMemoryRuntimeSecretProvider(request, canary);
  let browserStarts = 0;
  try {
    const result = await consumeRuntimeLoginInputs(
      descriptor,
      request,
      provider,
      async (account) => {
        browserStarts += 1;
        const browser = await chromium.launch({ headless: true });
        try {
          const context = await browser.newContext();
          try {
            const page = await context.newPage();
            await page.setContent(
              '<input id="username"><input id="password" type="password"><div id="state"></div>',
            );
            await page.locator("#username").fill(account.username);
            await page.locator("#password").fill(account.password);
            assert.equal(
              await page.locator("#username").inputValue(),
              canary.username,
            );
            assert.equal(
              await page.locator("#password").inputValue(),
              canary.password,
            );
            await context.addCookies([
              {
                name: "owned-session",
                value: "owned-session-marker",
                url: "https://owned.example.test",
              },
            ]);
          } finally {
            await context.close();
          }
          const nextRun = await browser.newContext();
          try {
            assert.deepEqual(await nextRun.cookies(), []);
            const nextPage = await nextRun.newPage();
            await nextPage.setContent(
              '<input id="username"><input id="password" type="password">',
            );
            assert.equal(await nextPage.locator("#username").inputValue(), "");
            assert.equal(await nextPage.locator("#password").inputValue(), "");
          } finally {
            await nextRun.close();
          }
        } finally {
          await browser.close();
        }
      },
    );
    assert.equal(browserStarts, 1);
    assertNoCanaries(result);
  } finally {
    provider.dispose();
  }
});

test("RRDPLAT-39 inherited-terminal entry is disabled before prompting or consuming", async () => {
  const { descriptor, request } = fixture();
  const input = new TerminalInput();
  const output = new TerminalOutput(input);
  let consumed = false;
  try {
    await assert.rejects(
      withOperatorLoginInputs(
        descriptor,
        request,
        async () => {
          consumed = true;
        },
        { input, output },
      ),
      { code: "runtime-input-unavailable" },
    );
    assert.equal(consumed, false);
    assert.equal(output.transcript, "");
    assert.deepEqual(input.rawTransitions, []);
    assert.equal(input.listenerCount("data"), 0);
  } finally {
    input.destroy();
    output.destroy();
  }
});

for (const environment of [
  undefined,
  "development",
  "test",
  "uat",
  "production",
  "custom",
]) {
  test(`RRDPLAT-39 no terminal fallback in ${environment ?? "unset"} environment`, async () => {
    const previous = process.env.NODE_ENV;
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
    const { request, descriptor } = fixture();
    const input = new TerminalInput();
    input.pause();
    const output = new TerminalOutput(input, []);
    input.write(canary.username);
    const queued = input.readableLength;
    try {
      for (const state of [
        "pending",
        "cancelled",
        "expired",
        "interrupt",
        "late",
      ] as const) {
        const controller = new AbortController();
        if (state === "cancelled") controller.abort();
        const pending = withOperatorLoginInputs(
          descriptor,
          state === "expired" ? { ...request, expiresAt: 1 } : request,
          async () => {
            assert.fail(
              "Blocked entry must never acquire a consumer or browser",
            );
          },
          { input, output, signal: controller.signal },
        );
        controller.abort();
        if (state === "interrupt") input.emit("data", Buffer.from("\u0003"));
        if (state === "late") input.emit("data", Buffer.from(canary.password));
        await assert.rejects(pending, { code: "runtime-input-unavailable" });
        assert.equal(input.readableLength, queued);
        assert.equal(input.listenerCount("data"), 0);
        assert.deepEqual(input.rawTransitions, []);
        assert.equal(input.isRaw, false);
        assert.equal(input.isPaused(), true);
        assert.equal(output.transcript, "");
      }
      // Even malicious accessors must not activate another input route.
      const unavailable = new Proxy(
        {},
        {
          get() {
            assert.fail("Entry inspected input options");
          },
        },
      );
      await assert.rejects(
        withOperatorLoginInputs(
          descriptor,
          request,
          async () => {
            assert.fail("Consumer acquired");
          },
          unavailable,
        ),
        { code: "runtime-input-unavailable" },
      );
      await assert.rejects(
        withOperatorLoginInputs(descriptor, request, async () => {
          assert.fail("Default stdin fallback acquired");
        }),
        { code: "runtime-input-unavailable" },
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
      input.destroy();
      output.destroy();
    }
  });
}
