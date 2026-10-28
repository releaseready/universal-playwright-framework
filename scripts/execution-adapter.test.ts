import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  executeReviewedScenarios,
  type ExecutionOptions,
  type ExecutionSummary,
} from "../src/execution";

const repositoryRoot = path.resolve(__dirname, "../../..");

async function run(
  scenarioId: string,
  options: Omit<ExecutionOptions, "scenarioIds"> = {},
): Promise<ExecutionSummary> {
  return executeReviewedScenarios({ ...options, scenarioIds: [scenarioId] });
}

async function assertProcessExited(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      return;
    }
    await delay(25);
  }
  assert.fail(`Owned browser process ${pid} remained alive after cleanup`);
}

test("reviewed synthetic browser actions pass with confirmed isolated cleanup", async () => {
  let browserPid = 0;
  const result = await run("browser-flow", {
    onBrowserProcessStarted: (pid) => {
      browserPid = pid;
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.resourceCleanup.status, "confirmed");
  assert.equal(result.resourceCleanup.browserProcessStopped, true);
  assert.deepEqual(result.dataRestoration, {
    status: "unknown",
    operationPerformed: false,
  });
  assert.match(result.diagnosticReference, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result.scenarios, [
    {
      scenarioId: "browser-flow",
      status: "passed",
      cucumber: {
        featureName: "Execute reviewed synthetic scenarios",
        scenarioName: "A reviewed visitor action succeeds",
        steps: [
          { name: "the synthetic reviewed page is open", status: "passed" },
          { name: "I enter the prepared display name", status: "passed" },
          {
            name: "the synthetic page confirms the prepared display name",
            status: "passed",
          },
        ],
      },
      cleanupStatus: "confirmed",
      cleanupFailures: [],
      cleanupFaultInjected: false,
      workerStopped: true,
      workerStallInjected: false,
    },
  ]);
  assert.ok(browserPid > 0);
  await assertProcessExited(browserPid);
});

test("a real assertion failure stays visible when a fresh browser attempt passes", async () => {
  const browserPids: number[] = [];
  const result = await run("retry-assertion-flow", {
    retryCount: 1,
    testAssertionMismatchAttempts: [1],
    onBrowserProcessStarted: (pid) => browserPids.push(pid),
  });

  assert.equal(result.status, "passed_after_retry");
  assert.equal(result.attemptCount, 2);
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.status),
    ["failed", "passed"],
  );
  assert.equal(result.attempts[0].scenarios[0].status, "failed");
  assert.equal(result.attempts[0].scenarios[0].cleanupStatus, "confirmed");
  assert.equal(result.attempts[0].resourceCleanup.status, "confirmed");
  assert.equal(result.attempts[1].scenarios[0].status, "passed");
  assert.equal(result.scenarios[0].status, "passed_after_retry");
  assert.equal(result.resourceCleanup.status, "confirmed");
  assert.equal(browserPids.length, 2);
  assert.notEqual(browserPids[0], browserPids[1]);
  assert.notEqual(
    result.attempts[0].diagnosticReference,
    result.attempts[1].diagnosticReference,
  );
  await Promise.all(browserPids.map(assertProcessExited));
});

test("retries are disabled unless an explicit retry count is supplied", async () => {
  const result = await run("retry-assertion-flow", {
    testAssertionMismatchAttempts: [1],
  });

  assert.equal(result.status, "failed");
  assert.equal(result.attemptCount, 1);
  assert.equal(result.attempts[0].scenarios[0].status, "failed");
  assert.equal(result.attempts[0].scenarios[0].cleanupStatus, "confirmed");
  assert.equal(result.resourceCleanup.status, "confirmed");
});

test("retry limit exhaustion preserves every attempt", async () => {
  const result = await run("retry-assertion-flow", {
    retryCount: 1,
    testAssertionMismatchAttempts: [1, 2],
  });

  assert.equal(result.status, "failed");
  assert.equal(result.attemptCount, 2);
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.scenarios[0].status),
    ["failed", "failed"],
  );
  assert.equal(result.resourceCleanup.status, "confirmed");
});

test("cancellation during the first attempt prevents another browser launch", async () => {
  const controller = new AbortController();
  const browserPids: number[] = [];
  const result = await run("browser-flow", {
    retryCount: 2,
    signal: controller.signal,
    onBrowserProcessStarted: (pid) => {
      browserPids.push(pid);
      controller.abort();
    },
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.attemptCount, 1);
  assert.equal(browserPids.length, 1);
  assert.equal(result.resourceCleanup.status, "confirmed");
  await Promise.all(browserPids.map(assertProcessExited));
});

test("cancellation during teardown preserves a completed successful attempt", async () => {
  const controller = new AbortController();
  const result = await run("browser-flow", {
    signal: controller.signal,
    testOnAttemptCleanupStarted: () => controller.abort(),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.attempts[0].status, "passed");
  assert.equal(result.attempts[0].scenarios[0].status, "passed");
  assert.equal(result.resourceCleanup.status, "confirmed");
});

test("a deadline during teardown preserves a completed successful attempt", async () => {
  let now = 0;
  const result = await run("browser-flow", {
    runTimeoutMs: 30_000,
    testNow: () => now,
    testOnAttemptCleanupStarted: () => {
      now = 30_001;
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.attempts[0].status, "passed");
  assert.equal(result.attempts[0].scenarios[0].status, "passed");
  assert.equal(result.resourceCleanup.status, "confirmed");
});

test("cancellation between attempts preserves failure and prevents another launch", async () => {
  const controller = new AbortController();
  const browserPids: number[] = [];
  const result = await run("retry-assertion-flow", {
    retryCount: 1,
    signal: controller.signal,
    testAssertionMismatchAttempts: [1],
    testOnAttemptCleanupStarted: () => controller.abort(),
    onBrowserProcessStarted: (pid) => browserPids.push(pid),
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.attemptCount, 1);
  assert.equal(result.attempts[0].status, "failed");
  assert.equal(result.attempts[0].scenarios[0].status, "failed");
  assert.equal(result.attempts[0].resourceCleanup.status, "confirmed");
  assert.equal(browserPids.length, 1);
  await Promise.all(browserPids.map(assertProcessExited));
});

test("a deadline between attempts preserves failure and prevents another launch", async () => {
  let now = 0;
  const browserPids: number[] = [];
  const result = await run("retry-assertion-flow", {
    retryCount: 1,
    runTimeoutMs: 30_000,
    testAssertionMismatchAttempts: [1],
    testNow: () => now,
    testOnAttemptCleanupStarted: () => {
      now = 30_001;
    },
    onBrowserProcessStarted: (pid) => browserPids.push(pid),
  });

  assert.equal(result.status, "timed_out");
  assert.equal(result.attemptCount, 1);
  assert.equal(result.attempts[0].status, "failed");
  assert.equal(result.attempts[0].scenarios[0].status, "failed");
  assert.equal(result.attempts[0].resourceCleanup.status, "confirmed");
  assert.equal(browserPids.length, 1);
  await Promise.all(browserPids.map(assertProcessExited));
});

test("unknown browser cleanup during late cancellation remains unknown and non-retriable", async () => {
  const controller = new AbortController();
  const browserPids: number[] = [];
  const result = await run("browser-flow", {
    retryCount: 1,
    signal: controller.signal,
    testCleanupFailure: "browser-state-unknown",
    testOnAttemptCleanupStarted: () => controller.abort(),
    onBrowserProcessStarted: (pid) => browserPids.push(pid),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.attemptCount, 1);
  assert.equal(result.attempts[0].status, "failed");
  assert.equal(result.resourceCleanup.status, "unknown");
  assert.equal(result.attempts[0].resourceCleanup.status, "unknown");
  assert.equal(result.resourceCleanup.browserProcessStopped, false);
  assert.equal(browserPids.length, 1);
  await Promise.all(browserPids.map(assertProcessExited));
});

test("the public 50 ms minimum still admits a positive internal remaining budget", async () => {
  let clockReads = 0;
  const result = await executeReviewedScenarios({
    scenarioIds: ["not-approved"],
    runTimeoutMs: 50,
    testNow: () => (clockReads++ === 0 ? 0 : 1),
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.attemptCount, 1);
  assert.equal(result.attempts[0].status, "incomplete");
  assert.equal(result.resourceCleanup.status, "not_required");
});

test("cleanup failure prevents another attempt", async () => {
  const result = await run("browser-flow", {
    retryCount: 2,
    testCleanupFailure: "context",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.attemptCount, 1);
  assert.equal(result.resourceCleanup.status, "failed");
  assert.equal(result.attempts[0].scenarios[0].cleanupFaultInjected, true);
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
    retryCount: 2,
  });

  assert.equal(undefinedStep.status, "incomplete");
  assert.deepEqual(undefinedStep.scenarios, []);
  assert.equal(zeroSelected.status, "incomplete");
  assert.equal(zeroSelected.attemptCount, 1);
  assert.equal(zeroSelected.attempts[0].status, "incomplete");
  assert.deepEqual(zeroSelected.scenarios, []);
  assert.equal(zeroSelected.resourceCleanup.status, "not_required");
  assert.deepEqual(zeroSelected.resourceCleanup.failures, []);
});

test("cancellation before resource acquisition reports no cleanup work", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await executeReviewedScenarios({ signal: controller.signal });

  assert.equal(result.status, "cancelled");
  assert.equal(result.resourceCleanup.status, "not_required");
  assert.deepEqual(result.resourceCleanup.failures, []);
});

test("redirects fail closed before a second owned listener receives a request", async () => {
  const result = await run("redirect-flow");

  assert.equal(result.status, "passed");
  assert.equal(result.scenarios[0].cleanupStatus, "confirmed");
  assert.equal(result.resourceCleanup.blockedTargetRequestCount, 0);
});

test("scenario and run deadlines terminate only their owned workers", async () => {
  const pids: number[] = [];
  const scenarioTimeout = await run("timeout-flow", {
    runTimeoutMs: 5_000,
    scenarioTimeoutMs: 500,
    onBrowserProcessStarted: (pid) => pids.push(pid),
  });
  const runTimeout = await run("timeout-flow", {
    runTimeoutMs: 500,
    scenarioTimeoutMs: 10_000,
    onBrowserProcessStarted: (pid) => pids.push(pid),
  });

  for (const result of [scenarioTimeout, runTimeout]) {
    assert.equal(result.status, "timed_out");
    assert.equal(result.scenarios[0].status, "timed_out");
    assert.equal(result.scenarios[0].cleanupStatus, "confirmed");
    assert.equal(result.scenarios[0].workerStopped, true);
    assert.equal(result.resourceCleanup.browserProcessStopped, true);
    assert.match(result.diagnosticReference, /^[0-9a-f-]{36}$/);
  }
  assert.equal(pids.length, 2);
  await Promise.all(pids.map(assertProcessExited));
});

test("cancelling one run does not cancel another isolated run", async () => {
  const controller = new AbortController();
  const browserPids = new Map<string, number>();
  let resolveBothStarted: (() => void) | undefined;
  const bothStarted = new Promise<void>((resolve) => {
    resolveBothStarted = resolve;
  });
  const cancelledPromise = run("timeout-flow", {
    signal: controller.signal,
    runTimeoutMs: 20_000,
    scenarioTimeoutMs: 15_000,
    onBrowserProcessStarted: (pid) => {
      browserPids.set("cancelled", pid);
      if (browserPids.size === 2) {
        resolveBothStarted?.();
      }
    },
  });
  const independentPromise = run("timeout-flow", {
    runTimeoutMs: 20_000,
    scenarioTimeoutMs: 15_000,
    onBrowserProcessStarted: (pid) => {
      browserPids.set("independent", pid);
      if (browserPids.size === 2) {
        resolveBothStarted?.();
      }
    },
  });

  await Promise.race([
    bothStarted,
    delay(5_000).then(() =>
      assert.fail("Independent BrowserServer did not start"),
    ),
  ]);
  await delay(500);
  controller.abort();
  const cancelled = await cancelledPromise;

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.scenarios[0].status, "cancelled");
  assert.equal(cancelled.scenarios[0].cleanupStatus, "confirmed");
  assert.equal(cancelled.scenarios[0].workerStopped, true);
  assert.equal(cancelled.resourceCleanup.browserProcessStopped, true);
  const independentPid = browserPids.get("independent");
  const cancelledPid = browserPids.get("cancelled");
  assert.ok(independentPid);
  assert.ok(cancelledPid);
  assert.doesNotThrow(() => process.kill(independentPid, 0));
  await assertProcessExited(cancelledPid);

  const independent = await independentPromise;
  assert.equal(independent.status, "passed");
  assert.equal(independent.scenarios[0].cleanupStatus, "confirmed");
  assert.equal(independent.resourceCleanup.browserProcessStopped, true);
  await assertProcessExited(independentPid);
});

test("a never-exiting worker and pending browser close are bounded and evidenced", async () => {
  const workerPids: number[] = [];
  const workerStall = await run("timeout-flow", {
    scenarioTimeoutMs: 500,
    runTimeoutMs: 5_000,
    testCleanupFailure: "worker-stall",
    onBrowserProcessStarted: (pid) => workerPids.push(pid),
  });
  assert.equal(workerStall.status, "timed_out");
  assert.equal(workerStall.scenarios[0].workerStallInjected, true);
  assert.equal(workerStall.scenarios[0].workerStopped, true);
  assert.equal(workerStall.scenarios[0].cleanupStatus, "confirmed");
  assert.equal(workerStall.resourceCleanup.browserProcessStopped, true);
  await Promise.all(workerPids.map(assertProcessExited));

  const startedAt = Date.now();
  let browserPid = 0;
  const pendingClose = await run("browser-flow", {
    testCleanupFailure: "server-pending",
    onBrowserProcessStarted: (pid) => {
      browserPid = pid;
    },
  });
  assert.equal(pendingClose.status, "passed");
  assert.equal(pendingClose.resourceCleanup.injectedPendingCleanup, true);
  assert.equal(pendingClose.resourceCleanup.browserProcessStopped, true);
  assert.ok(Date.now() - startedAt < 5_000);
  await assertProcessExited(browserPid);
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

test("tampered emitted code, runner config, and dependency metadata fail pre-acquisition", async () => {
  for (const relativePath of [
    "dist/cucumber/features/execution/steps.js",
    "cucumber-execution.json",
    "node_modules/playwright/package.json",
  ]) {
    const file = path.join(repositoryRoot, relativePath);
    const original = readFileSync(file);
    let result: ExecutionSummary | undefined;
    try {
      writeFileSync(
        file,
        Buffer.concat([original, Buffer.from("\n// tampered\n")]),
      );
      result = await run("browser-flow");
    } finally {
      writeFileSync(file, original);
    }

    assert.equal(result?.status, "incomplete", relativePath);
    assert.equal(result?.resourceCleanup.status, "not_required", relativePath);
    assert.deepEqual(result?.resourceCleanup.failures, [], relativePath);
    assert.equal(result?.resourceCleanup.browserProcessStopped, null);
  }
});
