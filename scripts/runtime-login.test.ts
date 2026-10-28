import assert from "node:assert/strict";
import { inspect } from "node:util";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  type RuntimeLoginAccount,
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

test("mid-prompt cancellation, expiry, blank and control input restore non-echoing terminal state", async () => {
  for (const outcome of [
    "cancel",
    "expire",
    "blank",
    "interrupt",
    "oversize",
    "paste",
  ] as const) {
    const { request, descriptor } = fixture();
    const input = new TerminalInput();
    input.pause();
    const output = new TerminalOutput(input, []);
    const controller = new AbortController();
    const pending = withOperatorLoginInputs(
      descriptor,
      outcome === "expire"
        ? { ...request, expiresAt: Date.now() + 50 }
        : request,
      async () => {
        assert.fail("Invalid prompt must not reach browser consumer");
      },
      { input, output, signal: controller.signal },
    );
    if (outcome === "cancel") controller.abort();
    if (outcome === "blank") input.write("\r");
    if (outcome === "interrupt") input.write("\u0003");
    if (outcome === "oversize") input.write("a".repeat(1025));
    if (outcome === "paste")
      input.write(`${canary.username}\n${canary.password}\n`);
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof RuntimeLoginError);
      assertNoCanaries(inspect(error));
      return true;
    });
    assert.equal(input.isRaw, false);
    assert.equal(input.isPaused(), true);
    assert.equal(input.listenerCount("data"), 0);
    assert.equal(input.listenerCount("error"), 0);
    assert.equal(output.listenerCount("error"), 0);
    assertNoCanaries(output.transcript);
    input.destroy();
    output.destroy();
  }
});

test("a terminal cannot be shared between concurrent runs and stale review blocks prompting", async () => {
  const { request, descriptor } = fixture();
  const input = new TerminalInput();
  input.pause();
  const output = new TerminalOutput(input, []);
  const controller = new AbortController();
  const first = withOperatorLoginInputs(descriptor, request, async () => {}, {
    input,
    output,
    signal: controller.signal,
  });
  const firstRejection = assert.rejects(first, RuntimeLoginError);
  await assert.rejects(
    withOperatorLoginInputs(descriptor, request, async () => {}, {
      input,
      output,
    }),
    { code: "runtime-input-unavailable" },
  );
  controller.abort();
  await firstRejection;
  const before = output.transcript;
  await assert.rejects(
    withOperatorLoginInputs(
      descriptor,
      { ...request, account: { ...request.account, revision: "stale" } },
      async () => {
        assert.fail("Stale review must not consume account");
      },
      { input, output },
    ),
    { code: "runtime-scope-mismatch" },
  );
  assert.equal(output.transcript, before);
  input.destroy();
  output.destroy();
});

test("hidden operator prompt delivers canaries without putting them in ordinary serialized surfaces", async () => {
  const { request, descriptor } = fixture();
  const input = new TerminalInput();
  input.pause();
  const output = new TerminalOutput(input);
  const beforeArguments = [...process.argv];
  const beforePayload = process.env.WEB_EXECUTION_PAYLOAD;
  let consumed = false;
  let retainedHandle: RuntimeLoginAccount | undefined;
  const result = await withOperatorLoginInputs(
    descriptor,
    request,
    async (account) => {
      assert.equal(account.username, canary.username);
      assert.equal(account.password, canary.password);
      assertNoCanaries(JSON.stringify(account));
      assertNoCanaries(inspect(account));
      retainedHandle = account;
      consumed = true;
    },
    { input, output },
  );
  assert.equal(consumed, true);
  assert.ok(retainedHandle);
  assert.throws(() => retainedHandle?.password, {
    code: "runtime-input-unavailable",
  });
  assert.equal(result.status, "completed");
  assert.equal(input.isRaw, false);
  assert.equal(input.isPaused(), true);
  assert.deepEqual(input.rawTransitions, [true, false]);
  assert.equal(input.listenerCount("data"), 0);
  assertNoCanaries(output.transcript);
  assertNoCanaries(descriptor);
  assertNoCanaries(request);
  assertNoCanaries(result);
  assert.deepEqual(process.argv, beforeArguments);
  assert.equal(process.env.WEB_EXECUTION_PAYLOAD, beforePayload);
  const directory = mkdtempSync(path.join(tmpdir(), "owned-runtime-canary-"));
  try {
    const job = path.join(directory, "reference-job.json");
    const report = path.join(directory, "reference-result.json");
    writeFileSync(job, JSON.stringify({ request, descriptor }), {
      mode: 0o600,
    });
    writeFileSync(report, JSON.stringify(result), { mode: 0o600 });
    assertNoCanaries(readFileSync(job, "utf8"));
    assertNoCanaries(readFileSync(report, "utf8"));
  } finally {
    rmSync(directory, { recursive: true });
    input.destroy();
    output.destroy();
  }
});

test("non-TTY, cancelled prompt and consumer exceptions fail safely and restore the terminal", async () => {
  for (const fault of ["non-tty", "cancel", "consumer"] as const) {
    const { request, descriptor } = fixture();
    const input = new TerminalInput();
    const output = new TerminalOutput(input);
    const controller = new AbortController();
    if (fault === "non-tty") input.isTTY = false;
    if (fault === "cancel") controller.abort();
    let consumed = false;
    await assert.rejects(
      withOperatorLoginInputs(
        descriptor,
        request,
        async () => {
          consumed = true;
          throw new Error(`${canary.username}:${canary.password}`);
        },
        { input, output, signal: controller.signal },
      ),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeLoginError);
        assertNoCanaries(error.message);
        assertNoCanaries(inspect(error));
        return true;
      },
    );
    assert.equal(consumed, fault === "consumer");
    assert.equal(input.isRaw, false);
    assert.equal(input.listenerCount("data"), 0);
    assertNoCanaries(output.transcript);
    input.destroy();
    output.destroy();
  }
});

test("real owned browser consumes runtime credentials with fresh session isolation", async () => {
  const { request, descriptor } = fixture();
  const input = new TerminalInput();
  const output = new TerminalOutput(input);
  let browserStarts = 0;
  try {
    const result = await withOperatorLoginInputs(
      descriptor,
      request,
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
      { input, output },
    );
    assert.equal(browserStarts, 1);
    assertNoCanaries(result);
    assertNoCanaries(output.transcript);
  } finally {
    input.destroy();
    output.destroy();
  }
});
