import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  executeReviewedScenarios,
  type ExecutionOptions,
  type ExecutionSummary,
} from "../src/execution";

async function run(
  scenarioId: string,
  options: Omit<ExecutionOptions, "scenarioIds"> = {},
): Promise<ExecutionSummary> {
  return executeReviewedScenarios({ ...options, scenarioIds: [scenarioId] });
}

test("reviewed synthetic browser actions pass with confirmed isolated cleanup", async () => {
  const result = await run("browser-flow");

  assert.equal(result.status, "passed");
  assert.equal(result.resourceCleanup.status, "confirmed");
  assert.deepEqual(result.dataRestoration, {
    status: "unknown",
    operationPerformed: false,
  });
  assert.match(result.diagnosticReference, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result.scenarios, [
    {
      scenarioId: "browser-flow",
      status: "passed",
      cleanupStatus: "confirmed",
      cleanupFailures: [],
      cleanupFaultInjected: false,
    },
  ]);
});

test("assertion and pending failures never produce a passing run", async () => {
  const assertion = await run("assertion-failure");
  const pending = await run("pending-flow");

  assert.equal(assertion.status, "failed");
  assert.equal(assertion.scenarios[0].status, "failed");
  assert.equal(assertion.scenarios[0].cleanupStatus, "confirmed");
  assert.equal(pending.status, "failed");
  assert.equal(pending.scenarios[0].status, "failed");
  assert.equal(pending.scenarios[0].cleanupStatus, "confirmed");
});

test("undefined and zero-selected scenarios are incomplete rather than pass", async () => {
  const undefinedStep = await run("undefined-flow");
  const zeroSelected = await executeReviewedScenarios({
    scenarioIds: ["not-approved"],
  });

  assert.equal(undefinedStep.status, "incomplete");
  assert.deepEqual(undefinedStep.scenarios, []);
  assert.equal(zeroSelected.status, "incomplete");
  assert.deepEqual(zeroSelected.scenarios, []);
});

test("approved-origin guard blocks a redirect before connecting", async () => {
  const result = await run("redirect-flow");

  assert.equal(result.status, "passed");
  assert.equal(result.scenarios[0].cleanupStatus, "confirmed");
});

test("scenario and run deadlines terminate only their owned workers", async () => {
  const scenarioTimeout = await run("timeout-flow", {
    runTimeoutMs: 5_000,
    scenarioTimeoutMs: 500,
  });
  const runTimeout = await run("timeout-flow", {
    runTimeoutMs: 500,
    scenarioTimeoutMs: 10_000,
  });

  for (const result of [scenarioTimeout, runTimeout]) {
    assert.equal(result.status, "timed_out");
    assert.equal(result.scenarios[0].status, "timed_out");
    assert.equal(result.scenarios[0].cleanupStatus, "unknown");
    assert.match(result.diagnosticReference, /^[0-9a-f-]{36}$/);
  }
});

test("cancelling one run does not cancel another isolated run", async () => {
  const controller = new AbortController();
  const cancelledPromise = run("timeout-flow", {
    signal: controller.signal,
    runTimeoutMs: 10_000,
    scenarioTimeoutMs: 8_000,
  });
  const independentPromise = run("browser-flow", {
    runTimeoutMs: 10_000,
    scenarioTimeoutMs: 8_000,
  });

  await delay(600);
  controller.abort();
  const [cancelled, independent] = await Promise.all([
    cancelledPromise,
    independentPromise,
  ]);

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.scenarios[0].status, "cancelled");
  assert.equal(cancelled.scenarios[0].cleanupStatus, "unknown");
  assert.equal(independent.status, "passed");
  assert.equal(independent.scenarios[0].cleanupStatus, "confirmed");
});

test("injected cleanup failure is visible and has a safe diagnostic reference", async () => {
  const result = await executeReviewedScenarios({
    scenarioIds: ["browser-flow", "pending-flow"],
    testCleanupFailure: "context",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.resourceCleanup.status, "failed");
  assert.equal(result.scenarios.length, 2);
  assert.equal(result.scenarios[0].cleanupStatus, "failed");
  assert.equal(result.scenarios[0].cleanupFaultInjected, true);
  assert.deepEqual(result.scenarios[0].cleanupFailures, [
    "context-close-injected",
  ]);
  assert.equal(result.scenarios[1].status, "incomplete");
  assert.match(result.diagnosticReference, /^[0-9a-f-]{36}$/);
});
