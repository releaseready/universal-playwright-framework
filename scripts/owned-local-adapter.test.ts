import assert from "node:assert/strict";
import { test } from "node:test";

test("Given the installed public API, an owned-local request has a separate v2 entrypoint", () => {
  const adapter = require("../src/adapter/v2") as {
    executeOwnedLocalAdapter?: unknown;
  };
  assert.equal(typeof adapter.executeOwnedLocalAdapter, "function");
});

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { mock } from "node:test";
import {
  executeOwnedLocalAdapter,
  getOwnedLocalReview,
  validateOwnedLocalEvidence,
  type OwnedLocalRequest,
  type OwnedLocalContext,
  type OwnedLocalResult,
} from "../src/adapter/v2";
import { executeAdapter } from "../src/adapter/v1";
import { examples } from "../features/adapter/examples";

async function requestFor(
  origin = "http://127.0.0.1:34567",
): Promise<OwnedLocalRequest> {
  const review = await getOwnedLocalReview();
  return {
    version: 2,
    run: { id: "synthetic-run", gitRevision: "a".repeat(40) },
    target: { kind: "owned-local", id: "synthetic-target", origin },
    scenarioIds: ["local-demo-navigation"],
    binding: {
      tenantId: "synthetic-tenant",
      projectId: "synthetic-project",
      environmentId: "synthetic-dev",
      caseId: "synthetic-case",
      caseRevision: 1,
      caseSourceHash: "b".repeat(64),
      dataRevision: "c".repeat(64),
      configurationRevision: "d".repeat(64),
      implementationRevision: review.approval.implementationRevision,
      approvalId: "synthetic-approval",
      attempt: 1,
    },
    ...review,
    limits: {
      runTimeoutMs: 20000,
      scenarioTimeoutMs: 15000,
      maxConcurrentScenarios: 1,
      retryCount: 0,
    },
  };
}
function owner(request: OwnedLocalRequest): OwnedLocalContext {
  return {
    version: 2,
    authorization: "owned-local",
    callerId: "synthetic-controller",
    request,
    approval: { active: true, expiresAt: Date.now() + 60000 },
    ...(process.env.RR139_SYSTEM_CHROMIUM === "1"
      ? { browserExecutablePath: "/usr/bin/chromium" as const }
      : {}),
  };
}

test("Given diagnostic browser selection, only an explicit opt-in overrides pinned Playwright", async () => {
  const request = await requestFor();
  const previous = process.env.RR139_SYSTEM_CHROMIUM;
  try {
    for (const flag of [
      undefined,
      "0",
      "true",
      "/tmp/arbitrary-browser",
      "1",
    ]) {
      if (flag === undefined) delete process.env.RR139_SYSTEM_CHROMIUM;
      else process.env.RR139_SYSTEM_CHROMIUM = flag;
      const context = owner(request);
      assert.equal(
        context.browserExecutablePath,
        flag === "1" ? "/usr/bin/chromium" : undefined,
      );
      assert.equal(
        Object.hasOwn(context, "browserExecutablePath"),
        flag === "1",
      );
    }
  } finally {
    if (previous === undefined) delete process.env.RR139_SYSTEM_CHROMIUM;
    else process.env.RR139_SYSTEM_CHROMIUM = previous;
  }
});

test("Given missing, expired, revoked or cross-scope approval, admission rejects before browser acquisition", async () => {
  const request = await requestFor();
  const launch = mock.method(chromium, "launchServer", () => {
    throw new Error("Browser must not launch");
  });
  try {
    const context = owner(request);
    for (const input of [
      null,
      {
        ...context,
        approval: { active: false, expiresAt: Date.now() + 60000 },
      },
      { ...context, approval: { active: true, expiresAt: Date.now() - 1 } },
      {
        ...context,
        request: {
          ...request,
          binding: { ...request.binding, tenantId: "foreign" },
        },
      },
    ]) {
      const result = await executeOwnedLocalAdapter(
        request,
        input,
        undefined,
        async () => {},
      );
      assert.equal(result.accepted, false);
      assert.equal(validateOwnedLocalEvidence(request, result), true);
    }
    for (const origin of [
      "https://example.invalid",
      "http://localhost:3000",
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:3000/path",
      "http://user@127.0.0.1:3000",
    ])
      assert.equal(
        (
          await executeOwnedLocalAdapter(
            { ...request, target: { ...request.target, origin } },
            context,
          )
        ).accepted,
        false,
      );
    assert.equal(launch.mock.callCount(), 0);
  } finally {
    launch.mock.restore();
  }
});

test("Given v1, adding an owned-local scenario still rejects without acquiring a browser", async () => {
  const { request, context } = examples(["local-demo-navigation"]);
  assert.equal((await executeAdapter(request, context)).accepted, false);
});

async function syntheticTarget(broken = false) {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.setHeader("content-type", "text/html");
    response.end(
      `<!doctype html><h1>Sign in to ReleaseReady</h1><button onclick="document.body.innerHTML='<button onclick=showDemo()>Explore demo</button>'">Explore the demo</button><script>function showDemo(){document.body.innerHTML='<h1>${broken ? "Wrong workspace" : "Anonymous demo workspace"}</h1><h2>Synthetic demo project</h2><button onclick=location.reload()>Back to sign in</button>'}</script>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests: () => requests,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("Given an approved owned loopback target, the real browser navigates it once and validates saved evidence without replay", async () => {
  const target = await syntheticTarget();
  try {
    const request = await requestFor(target.origin);
    const result = await executeOwnedLocalAdapter(
      request,
      owner(request),
      undefined,
      async () => {},
    );
    assert.equal(result.accepted, true);
    if (!result.accepted) throw new Error("Expected execution");
    assert.equal(result.report.status, "passed");
    assert.equal(result.lifecycle.resourceCleanup.browserProcessStopped, true);
    assert.equal(result.lifecycle.attempts.length, 1);
    assert.ok(target.requests() > 0);
    for (const mutate of [
      (value: typeof result) => {
        value.report.scenarios[0].steps[1].name =
          value.report.scenarios[0].steps[0].name;
      },
      (value: typeof result) => {
        value.report.attempts = [];
        value.report.totals.attemptCount = 0;
        value.lifecycle.attempts = [];
      },
      (value: typeof result) => {
        value.lifecycle.resourceCleanup.failures.push("browser-close");
      },
      (value: typeof result) => {
        value.lifecycle.attempts[0].scenarios[0].workerStopped = false;
      },
      (value: typeof result) => {
        value.report.totals.scenarioOutcomes.failed = 1;
      },
      (value: typeof result) => {
        value.report.attempts[0].diagnosticReference =
          "00000000-0000-4000-8000-000000000000";
      },
    ]) {
      const corrupt: Extract<OwnedLocalResult, { accepted: true }> =
        structuredClone(result);
      mutate(corrupt);
      assert.equal(validateOwnedLocalEvidence(request, corrupt), false);
    }
    const count = target.requests();
    assert.equal(
      validateOwnedLocalEvidence(request, JSON.parse(JSON.stringify(result))),
      true,
    );
    assert.equal(target.requests(), count);
    assert.equal(
      validateOwnedLocalEvidence(request, {
        ...result,
        binding: { ...result.binding, tenantId: "foreign" },
      }),
      false,
    );
    assert.equal(
      validateOwnedLocalEvidence(request, {
        ...result,
        report: { ...result.report, secret: "not-allowed" },
      }),
      false,
    );
    assert.equal(
      validateOwnedLocalEvidence(request, {
        ...result,
        lifecycle: {
          ...result.lifecycle,
          resourceCleanup: {
            ...result.lifecycle.resourceCleanup,
            secret: "not-allowed",
          },
        },
      }),
      false,
    );
  } finally {
    await target.stop();
  }
});

test("Given a broken owned target, a genuine assertion failure remains failed with confirmed browser cleanup", async () => {
  const target = await syntheticTarget(true);
  try {
    const request = await requestFor(target.origin);
    const result = await executeOwnedLocalAdapter(
      request,
      owner(request),
      undefined,
      async () => {},
    );
    assert.equal(result.accepted, true);
    if (!result.accepted) throw new Error("Expected execution");
    assert.equal(result.report.status, "failed");
    assert.equal(result.lifecycle.resourceCleanup.browserProcessStopped, true);
    assert.equal(validateOwnedLocalEvidence(request, result), true);
  } finally {
    await target.stop();
  }
});

test("Given approval is revoked at the acquisition gate, the adapter rejects before starting a browser", async () => {
  const request = await requestFor();
  const launch = mock.method(chromium, "launchServer", () => {
    throw new Error("Browser must not launch");
  });
  let gates = 0;
  try {
    const result = await executeOwnedLocalAdapter(
      request,
      owner(request),
      undefined,
      async () => {
        gates++;
        throw new Error("revoked");
      },
    );
    assert.equal(result.accepted, false);
    assert.equal(gates, 1);
    assert.equal(launch.mock.callCount(), 0);
    assert.equal(
      (await executeOwnedLocalAdapter(request, owner(request))).accepted,
      false,
    );
  } finally {
    launch.mock.restore();
  }
});

test("Given cancellation before execution, no target request is sent and cancellation remains non-success", async () => {
  const target = await syntheticTarget();
  try {
    const request = await requestFor(target.origin);
    const abort = new AbortController();
    abort.abort();
    const result = await executeOwnedLocalAdapter(
      request,
      owner(request),
      abort.signal,
      async () => {},
    );
    assert.equal(result.accepted, true);
    if (!result.accepted) throw new Error("Expected bounded outcome");
    assert.equal(result.report.status, "cancelled");
    assert.equal(
      validateOwnedLocalEvidence(request, {
        ...result,
        report: {
          ...result.report,
          status: "failed",
          attempts: [],
          scenarios: [],
          totals: {
            ...result.report.totals,
            scenarioCount: 0,
            attemptCount: 0,
            notExecutedScenarioCount: 0,
            scenarioOutcomes: {
              passed: 0,
              passed_after_retry: 0,
              failed: 0,
              incomplete: 0,
              timed_out: 0,
              cancelled: 0,
            },
            attemptOutcomes: {
              passed: 0,
              passed_after_retry: 0,
              failed: 0,
              incomplete: 0,
              timed_out: 0,
              cancelled: 0,
            },
          },
        },
        lifecycle: { ...result.lifecycle, attempts: [] },
      }),
      false,
    );
    assert.equal(result.lifecycle.resourceCleanup.status, "not_required");
    assert.equal(target.requests(), 0);
  } finally {
    await target.stop();
  }
});

test("Given the packaged implementation changes, approval rejects before acquisition rather than approving the changed worker", async () => {
  const request = await requestFor();
  const file = require.resolve("../src/execution/index");
  const original = readFileSync(file);
  const launch = mock.method(chromium, "launchServer", () => {
    throw new Error("Browser must not launch");
  });
  try {
    writeFileSync(file, Buffer.concat([original, Buffer.from("\n")]));
    const result = await executeOwnedLocalAdapter(
      request,
      owner(request),
      undefined,
      async () => {},
    );
    assert.equal(result.accepted, false);
    if (result.accepted) throw new Error("Expected rejection");
    assert.equal(result.error.code, "STALE_REVIEW");
    assert.equal(launch.mock.callCount(), 0);
  } finally {
    writeFileSync(file, original);
    launch.mock.restore();
  }
});

test("Given the run deadline expires, the owned browser stops and no retry begins", async () => {
  const target = await syntheticTarget();
  try {
    const request = await requestFor(target.origin);
    request.limits.runTimeoutMs = 100;
    const result = await executeOwnedLocalAdapter(
      request,
      owner(request),
      undefined,
      async () => {},
    );
    assert.equal(result.accepted, true);
    if (!result.accepted) throw new Error("Expected bounded outcome");
    assert.equal(result.report.status, "timed_out");
    assert.equal(result.lifecycle.attempts.length, 1);
    assert.equal(result.lifecycle.resourceCleanup.browserProcessStopped, true);
  } finally {
    await target.stop();
  }
});

test("Given the owned target stops after authorization, the real browser failure is saved with cleanup rather than success", async () => {
  const target = await syntheticTarget();
  const origin = target.origin;
  await target.stop();
  const request = await requestFor(origin);
  const result = await executeOwnedLocalAdapter(
    request,
    owner(request),
    undefined,
    async () => {},
  );
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error("Expected execution outcome");
  assert.equal(result.report.status, "failed");
  assert.equal(result.lifecycle.resourceCleanup.browserProcessStopped, true);
  assert.equal(result.lifecycle.attempts.length, 1);
  assert.equal(validateOwnedLocalEvidence(request, result), true);
});

test("Given cancellation during a target navigation, only the acquired browser stops and the target remains listening", async () => {
  const abort = new AbortController();
  const server = createServer((_request, response) => {
    abort.abort();
    response.end("<!doctype html><h1>Pending synthetic navigation</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const request = await requestFor(`http://127.0.0.1:${address.port}`);
    const result = await executeOwnedLocalAdapter(
      request,
      owner(request),
      abort.signal,
      async () => {},
    );
    assert.equal(result.accepted, true);
    if (!result.accepted) throw new Error("Expected bounded cancellation");
    assert.equal(result.report.status, "cancelled");
    assert.equal(result.lifecycle.resourceCleanup.browserProcessStopped, true);
    assert.equal(result.lifecycle.attempts.length, 1);
    assert.equal(server.listening, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

for (const hasBusinessEvidence of [false, true]) {
  test(
    hasBusinessEvidence
      ? "Given business steps pass but cleanup fails, the scenario stays incomplete with its actual step evidence"
      : "Given the worker supplies no business-step evidence, an operational failure stays incomplete with its original cleanup",
    async () => {
      const failure = hasBusinessEvidence ? "context-close" : "worker-start";
      const engine: typeof import("../src/execution") = require("../src/execution");
      const diagnosticReference = "00000000-0000-4000-8000-000000000000";
      const resourceCleanup = {
        status: "unknown" as const,
        failures: [failure],
        browserProcessStopped: null,
        blockedTargetRequestCount: 0,
        injectedPendingCleanup: false,
      };
      const dataRestoration = {
        status: "unknown" as const,
        operationPerformed: false as const,
      };
      const scenarios = [
        {
          scenarioId: "local-demo-navigation",
          status: "failed" as const,
          ...(hasBusinessEvidence
            ? {
                cucumber: {
                  featureName: "Execute reviewed synthetic scenarios",
                  scenarioName:
                    "A visitor explores the owned local demo and returns to sign in",
                  steps: [
                    "the synthetic reviewed page is open",
                    "I explore the owned local demo",
                    "the owned local demo shows its synthetic workspace and project",
                    "I return from the owned local demo to sign in",
                    "the owned local sign in page is visible",
                  ].map((name) => ({ name, status: "passed" as const })),
                },
              }
            : {}),
          cleanupStatus: "unknown" as const,
          cleanupFailures: [failure],
          cleanupFaultInjected: false,
          workerStopped: true,
          workerStallInjected: false,
        },
      ];
      const engineFailure = mock.method(
        engine,
        "executeReviewedScenarios",
        async () => ({
          diagnosticReference,
          status: "failed" as const,
          resourceCleanup,
          dataRestoration,
          scenarios,
          attemptCount: 1,
          attempts: [
            {
              attemptNumber: 1,
              diagnosticReference,
              status: "failed" as const,
              resourceCleanup,
              dataRestoration,
              scenarios,
            },
          ],
        }),
      );
      try {
        const request = await requestFor();
        const result = await executeOwnedLocalAdapter(
          request,
          owner(request),
          undefined,
          async () => {},
        );
        assert.equal(result.accepted, true);
        if (!result.accepted) throw new Error("Expected preserved outcome");
        assert.equal(result.report.status, "incomplete");
        assert.equal(result.report.attempts[0].status, "incomplete");
        assert.equal(result.report.scenarios[0].status, "incomplete");
        assert.equal(
          result.report.scenarios[0].evidenceStatus,
          hasBusinessEvidence ? "available" : "unavailable",
        );
        assert.deepEqual(
          result.report.scenarios[0].steps,
          scenarios[0].cucumber?.steps ?? [],
        );
        assert.equal(
          result.report.attempts[0].scenarios[0].status,
          "incomplete",
        );
        assert.equal(result.report.totals.scenarioOutcomes.failed, 0);
        assert.equal(result.report.totals.scenarioOutcomes.incomplete, 1);
        const forged = structuredClone(result);
        forged.report.scenarios[0].status = "failed";
        forged.report.attempts[0].scenarios[0].status = "failed";
        forged.report.totals.scenarioOutcomes.incomplete = 0;
        forged.report.totals.scenarioOutcomes.failed = 1;
        assert.equal(validateOwnedLocalEvidence(request, forged), false);
        assert.deepEqual(result.lifecycle.resourceCleanup.failures, [failure]);
        assert.equal(
          result.lifecycle.resourceCleanup.browserProcessStopped,
          null,
        );
        assert.equal(validateOwnedLocalEvidence(request, result), true);
      } finally {
        engineFailure.mock.restore();
      }
    },
  );
}

test("Given the public v2 export, HTTP schemas retain strict bounded request and outcome shapes", () => {
  const schemas: Record<
    string,
    Record<string, unknown>
  > = require("../src/adapter/v2");
  const requestSchema = schemas.ownedLocalRequestJsonSchema;
  const resultSchema = schemas.ownedLocalResultJsonSchema;
  assert.ok(requestSchema);
  assert.ok(resultSchema);
  assert.equal(requestSchema.additionalProperties, false);
  const properties = requestSchema.properties as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(properties.version.const, 2);
  const target = properties.target.properties as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(target.origin.type, "string");
  assert.equal(typeof target.origin.pattern, "string");
  const variants = resultSchema.anyOf as Record<string, unknown>[];
  assert.equal(variants.length, 2);
  for (const variant of variants)
    assert.equal(variant.additionalProperties, false);
});
