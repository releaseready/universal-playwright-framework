import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Server } from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { test, mock } from "node:test";
import { chromium } from "@playwright/test";
import * as engine from "../src/execution";
import { executeAdapter, type AdapterResult } from "../src/adapter/v1";
import { examples } from "../features/adapter/examples";
import rejectedExample from "../fixtures/adapter/v1-rejected.json";

test("validation and execution use the same approved step matcher", () => {
  const runnerRequire = createRequire(require.resolve("@cucumber/cucumber"));
  assert.equal(
    runnerRequire.resolve("@cucumber/cucumber-expressions"),
    require.resolve("@cucumber/cucumber-expressions"),
  );
});

function accepted(result: AdapterResult) {
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error("Expected an accepted execution");
  return JSON.parse(JSON.stringify(result)) as Extract<
    AdapterResult,
    { accepted: true }
  >;
}

test("invalid, stale, unsupported and unauthorized requests acquire nothing", async () => {
  const browser = mock.method(chromium, "launchServer", () => {
    throw new Error("Browser must not start");
  });
  const server = mock.method(Server.prototype, "listen", () => {
    throw new Error("Server must not start");
  });
  try {
    const { request, context } = examples();
    const invalid: unknown[] = [
      rejectedExample,
      { ...request, version: 2 },
      { ...request, target: "https://customer.invalid" },
      { ...request, scenarioIds: ["external-scenario"] },
      { ...request, scenarioIds: ["undefined-flow"] },
      { ...request, scenarioIds: ["browser-flow", "browser-flow"] },
      { ...request, scenarioIds: [] },
      { ...request, run: { ...request.run, gitRevision: "main" } },
      {
        ...request,
        approval: { ...request.approval, sourceRevision: "stale" },
      },
      { ...request, inputs: { ...request.inputs, fixtureRevision: "stale" } },
      { ...request, limits: { ...request.limits, retryCount: 3 } },
      { ...request, limits: { ...request.limits, runTimeoutMs: 120001 } },
      { ...request, limits: { ...request.limits, scenarioTimeoutMs: 49 } },
      { ...request, limits: { ...request.limits, maxConcurrentScenarios: 3 } },
      { ...request, testCleanupFailure: "context" },
      { ...request, onBrowserProcessStarted: () => {} },
      { ...request, password: "not-an-accepted-field" },
      { ...request, path: "../../arbitrary" },
      null,
    ];
    for (const input of invalid) {
      const result = await executeAdapter(input, context);
      assert.equal(result.accepted, false);
      assert.doesNotMatch(
        JSON.stringify(result),
        /customer|password|arbitrary/,
      );
    }
    for (const owner of [
      { ...context, runId: "another-run" },
      { ...context, gitRevision: "b".repeat(40) },
      { ...context, allowedScenarioIds: ["assertion-failure"] },
      { ...context, authorization: "customer" },
      {
        ...context,
        approval: { ...request.approval, featureRevision: "0".repeat(64) },
      },
      {
        ...context,
        inputs: { ...request.inputs, environmentRevision: "stale" },
      },
      null,
    ]) {
      assert.equal((await executeAdapter(request, owner)).accepted, false);
    }
    const fixture = path.resolve(
      __dirname,
      "../../../fixtures/execution/approved-inputs.json",
    );
    const original = readFileSync(fixture, "utf8");
    try {
      writeFileSync(
        fixture,
        original.replace("Synthetic Visitor", "Changed Visitor"),
      );
      const result = await executeAdapter(request, context);
      assert.equal(result.accepted, false);
      if (!result.accepted) assert.equal(result.error.code, "STALE_REVIEW");
    } finally {
      writeFileSync(fixture, original);
    }
    assert.equal(browser.mock.callCount(), 0);
    assert.equal(server.mock.callCount(), 0);
  } finally {
    mock.restoreAll();
  }
});

test("approved real execution retains caller identity and matches direct business/lifecycle behavior", async () => {
  const { request, context } = examples();
  const result = accepted(await executeAdapter(request, context));
  const direct = await engine.executeReviewedScenarios({
    scenarioIds: request.scenarioIds,
  });
  assert.deepEqual(result.run, request.run);
  assert.equal(result.callerId, context.callerId);
  assert.notEqual(result.report.runReference, request.run.id);
  assert.equal(result.report.sourceRevision, request.approval.sourceRevision);
  assert.equal(result.report.status, "passed");
  assert.deepEqual(
    result.report.scenarios[0].steps,
    direct.scenarios[0].cucumber?.steps,
  );
  const { injectedPendingCleanup: _injected, ...directCleanup } =
    direct.resourceCleanup;
  assert.deepEqual(result.lifecycle.resourceCleanup, directCleanup);
  assert.deepEqual(result.lifecycle.dataRestoration, {
    status: "unknown",
    operationPerformed: false,
  });
  const second = accepted(await executeAdapter(request, context));
  assert.notEqual(second.report.runReference, result.report.runReference);
  assert.equal(second.report.totals.attemptCount, 1);
});

test("real engine retries, failed/unknown cleanup and unfinished outcomes survive serialization", async () => {
  const original = engine.executeReviewedScenarios;
  for (const [scenario, options, status, cleanup] of [
    [
      "retry-assertion-flow",
      { retryCount: 1, testAssertionMismatchAttempts: [1] },
      "passed_after_retry",
      "confirmed",
    ],
    ["browser-flow", { testCleanupFailure: "context" }, "failed", "failed"],
    [
      "browser-flow",
      { testCleanupFailure: "browser-state-unknown" },
      "failed",
      "unknown",
    ],
    ["pending-flow", {}, "failed", "confirmed"],
    ["timeout-flow", { scenarioTimeoutMs: 1500 }, "timed_out", "confirmed"],
  ] as const) {
    const fixture = examples([scenario]);
    const seam = mock.method(
      engine,
      "executeReviewedScenarios",
      (bounded: engine.ExecutionOptions) =>
        original({ ...bounded, ...options }),
    );
    try {
      const result = accepted(
        await executeAdapter(fixture.request, fixture.context),
      );
      assert.equal(result.report.status, status);
      assert.equal(result.lifecycle.resourceCleanup.status, cleanup);
      assert.equal(
        result.lifecycle.attempts.length,
        result.report.attempts.length,
      );
      if (status === "passed_after_retry") {
        assert.deepEqual(
          result.report.attempts.map((attempt) => attempt.status),
          ["failed", "passed"],
        );
        assert.equal(
          result.report.attempts[0].scenarios[0].steps[2].status,
          "failed",
        );
        assert.equal(result.report.scenarios[0].status, "passed_after_retry");
      }
      assert.doesNotMatch(
        JSON.stringify(result),
        /Error:|node_modules|WEB_EXECUTION|cleanupFaultInjected|injectedPendingCleanup/,
      );
    } finally {
      seam.mock.restore();
    }
  }
});

test("cancellation is isolated between two real runs and late cancellation cannot rewrite a pass", async () => {
  const controller = new AbortController();
  const original = engine.executeReviewedScenarios;
  const seam = mock.method(
    engine,
    "executeReviewedScenarios",
    (options: engine.ExecutionOptions) =>
      original({
        ...options,
        onBrowserProcessStarted: () => {
          if (options.signal === controller.signal)
            controller.abort("untrusted reason");
        },
      }),
  );
  try {
    const a = examples();
    const b = examples();
    const [cancelled, completed] = await Promise.all([
      executeAdapter(a.request, a.context, controller.signal),
      executeAdapter(b.request, b.context),
    ]);
    assert.equal(accepted(cancelled).report.status, "cancelled");
    assert.equal(
      accepted(cancelled).lifecycle.resourceCleanup.status,
      "confirmed",
    );
    assert.equal(accepted(completed).report.status, "passed");
    assert.doesNotMatch(JSON.stringify(cancelled), /untrusted reason/);
  } finally {
    seam.mock.restore();
  }
  const late = new AbortController();
  const fixture = examples();
  const cleanup = mock.method(
    engine,
    "executeReviewedScenarios",
    (options: engine.ExecutionOptions) =>
      original({
        ...options,
        testOnAttemptCleanupStarted: () => late.abort(),
      }),
  );
  try {
    const result = accepted(
      await executeAdapter(fixture.request, fixture.context, late.signal),
    );
    assert.equal(late.signal.aborted, true);
    assert.equal(result.report.status, "passed");
    assert.equal(result.lifecycle.resourceCleanup.status, "confirmed");
  } finally {
    cleanup.mock.restore();
  }
  const stopped = accepted(
    await executeAdapter(fixture.request, fixture.context, late.signal),
  );
  assert.equal(stopped.report.status, "cancelled");
  assert.equal(stopped.lifecycle.resourceCleanup.status, "not_required");
});

test("actual acquisition failure stays incomplete with unknown cleanup, not a raw exception", async () => {
  const browser = mock.method(chromium, "launchServer", async () => {
    throw new Error("private diagnostic must not escape");
  });
  try {
    const fixture = examples();
    const result = accepted(
      await executeAdapter(fixture.request, fixture.context),
    );
    assert.equal(result.report.status, "incomplete");
    assert.equal(result.report.attempts[0].status, "incomplete");
    assert.equal(result.lifecycle.resourceCleanup.status, "unknown");
    assert.equal(result.lifecycle.resourceCleanup.browserProcessStopped, null);
    assert.doesNotMatch(JSON.stringify(result), /private diagnostic/);
    assert.equal(browser.mock.callCount(), 1);
  } finally {
    browser.mock.restore();
  }
});
