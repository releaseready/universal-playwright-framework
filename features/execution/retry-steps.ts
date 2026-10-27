import assert from "node:assert/strict";
import {
  Then,
  When,
  World,
  setDefaultTimeout,
  setWorldConstructor,
  type IWorldOptions,
} from "@cucumber/cucumber";
import {
  executeReviewedScenarios,
  type ExecutionSummary,
} from "../../src/execution";

class RetryWorld extends World {
  result?: ExecutionSummary;
  browserStarts = 0;
  browserPids: number[] = [];

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setDefaultTimeout(30_000);
setWorldConstructor(RetryWorld);

When(
  "I execute retry-assertion-flow with one retry and an assertion mismatch on attempt 1",
  async function (this: RetryWorld) {
    this.result = await executeReviewedScenarios({
      scenarioIds: ["retry-assertion-flow"],
      retryCount: 1,
      testAssertionMismatchAttempts: [1],
      onBrowserProcessStarted: (pid) => this.browserPids.push(pid),
    });
  },
);

When(
  "I execute retry-assertion-flow with retries disabled and an assertion mismatch on attempt 1",
  async function (this: RetryWorld) {
    this.result = await executeReviewedScenarios({
      scenarioIds: ["retry-assertion-flow"],
      testAssertionMismatchAttempts: [1],
    });
  },
);

When(
  "I execute retry-assertion-flow with assertion mismatches on attempts 1 and 2",
  async function (this: RetryWorld) {
    this.result = await executeReviewedScenarios({
      scenarioIds: ["retry-assertion-flow"],
      retryCount: 1,
      testAssertionMismatchAttempts: [1, 2],
    });
  },
);

When(
  "I cancel browser-flow after its first browser starts with two retries allowed",
  async function (this: RetryWorld) {
    const controller = new AbortController();
    this.result = await executeReviewedScenarios({
      scenarioIds: ["browser-flow"],
      retryCount: 2,
      signal: controller.signal,
      onBrowserProcessStarted: () => {
        this.browserStarts += 1;
        controller.abort();
      },
    });
  },
);

When(
  "I execute browser-flow with a context cleanup failure and two retries allowed",
  async function (this: RetryWorld) {
    this.result = await executeReviewedScenarios({
      scenarioIds: ["browser-flow"],
      retryCount: 2,
      testCleanupFailure: "context",
    });
  },
);

When(
  "I cancel browser-flow during successful attempt teardown",
  async function (this: RetryWorld) {
    const controller = new AbortController();
    this.result = await executeReviewedScenarios({
      scenarioIds: ["browser-flow"],
      signal: controller.signal,
      testOnAttemptCleanupStarted: () => controller.abort(),
    });
  },
);

When(
  "the deadline expires during successful browser-flow teardown",
  async function (this: RetryWorld) {
    let now = 0;
    this.result = await executeReviewedScenarios({
      scenarioIds: ["browser-flow"],
      runTimeoutMs: 30_000,
      testNow: () => now,
      testOnAttemptCleanupStarted: () => {
        now = 30_001;
      },
    });
  },
);

When(
  "I cancel retry-assertion-flow after its first real failure",
  async function (this: RetryWorld) {
    const controller = new AbortController();
    this.result = await executeReviewedScenarios({
      scenarioIds: ["retry-assertion-flow"],
      retryCount: 1,
      signal: controller.signal,
      testAssertionMismatchAttempts: [1],
      testOnAttemptCleanupStarted: () => controller.abort(),
      onBrowserProcessStarted: (pid) => this.browserPids.push(pid),
    });
  },
);

When(
  "the deadline expires after retry-assertion-flow first fails",
  async function (this: RetryWorld) {
    let now = 0;
    this.result = await executeReviewedScenarios({
      scenarioIds: ["retry-assertion-flow"],
      retryCount: 1,
      runTimeoutMs: 30_000,
      testAssertionMismatchAttempts: [1],
      testNow: () => now,
      testOnAttemptCleanupStarted: () => {
        now = 30_001;
      },
      onBrowserProcessStarted: (pid) => this.browserPids.push(pid),
    });
  },
);

When(
  "I cancel browser-flow during teardown with unknown browser cleanup",
  async function (this: RetryWorld) {
    const controller = new AbortController();
    this.result = await executeReviewedScenarios({
      scenarioIds: ["browser-flow"],
      retryCount: 1,
      signal: controller.signal,
      testCleanupFailure: "browser-state-unknown",
      testOnAttemptCleanupStarted: () => controller.abort(),
    });
  },
);

Then(
  "the first attempt records the real assertion failure",
  function (this: RetryWorld) {
    assert.ok(this.result);
    assert.equal(this.result.attempts[0].status, "failed");
    assert.equal(this.result.attempts[0].scenarios[0].status, "failed");
    assert.equal(
      this.result.attempts[0].scenarios[0].cleanupStatus,
      "confirmed",
    );
  },
);

Then(
  "the second attempt passes with a fresh browser resource",
  function (this: RetryWorld) {
    assert.ok(this.result);
    assert.equal(this.result.attemptCount, 2);
    assert.equal(this.result.attempts[1].status, "passed");
    assert.equal(this.result.status, "passed_after_retry");
    assert.equal(this.result.scenarios[0].status, "passed_after_retry");
    assert.equal(this.browserPids.length, 2);
    assert.notEqual(this.browserPids[0], this.browserPids[1]);
    assert.notEqual(
      this.result.attempts[0].diagnosticReference,
      this.result.attempts[1].diagnosticReference,
    );
  },
);

Then(
  "the run is failed after {int} attempt with the real assertion failure preserved",
  function (this: RetryWorld, attempts: number) {
    assert.ok(this.result);
    assert.equal(this.result.status, "failed");
    assert.equal(this.result.attemptCount, attempts);
    assert.equal(this.result.attempts[0].scenarios[0].status, "failed");
  },
);

Then(
  "the run is failed after {int} attempts with both assertion failures preserved",
  function (this: RetryWorld, attempts: number) {
    assert.ok(this.result);
    assert.equal(this.result.status, "failed");
    assert.equal(this.result.attemptCount, attempts);
    assert.deepEqual(
      this.result.attempts.map((attempt) => attempt.scenarios[0].status),
      ["failed", "failed"],
    );
  },
);

Then(
  "the cancelled run has only {int} attempt and {int} browser start",
  function (this: RetryWorld, attempts: number, browserStarts: number) {
    assert.ok(this.result);
    assert.equal(this.result.status, "cancelled");
    assert.equal(this.result.attemptCount, attempts);
    assert.equal(this.browserStarts, browserStarts);
  },
);

Then(
  "the failed cleanup is visible and the run has only {int} attempt",
  function (this: RetryWorld, attempts: number) {
    assert.ok(this.result);
    assert.equal(this.result.status, "failed");
    assert.equal(this.result.resourceCleanup.status, "failed");
    assert.equal(this.result.attemptCount, attempts);
    assert.equal(
      this.result.attempts[0].scenarios[0].cleanupFaultInjected,
      true,
    );
  },
);

Then(
  "the completed successful attempt remains passed",
  function (this: RetryWorld) {
    assert.ok(this.result);
    assert.equal(this.result.status, "passed");
    assert.equal(this.result.attempts[0].status, "passed");
    assert.equal(this.result.attempts[0].scenarios[0].status, "passed");
    assert.equal(this.result.resourceCleanup.status, "confirmed");
  },
);

Then(
  "the first real failure is retained without another browser launch",
  function (this: RetryWorld) {
    assert.ok(this.result);
    assert.equal(this.result.attemptCount, 1);
    assert.equal(this.result.attempts[0].status, "failed");
    assert.equal(this.result.attempts[0].scenarios[0].status, "failed");
    assert.equal(this.browserPids.length, 1);
  },
);

Then("the run status is {string}", function (this: RetryWorld, status: string) {
  assert.ok(this.result);
  assert.equal(this.result.status, status);
});

Then(
  "unknown browser cleanup remains visible after late cancellation",
  function (this: RetryWorld) {
    assert.ok(this.result);
    assert.equal(this.result.status, "failed");
    assert.equal(this.result.attemptCount, 1);
    assert.equal(this.result.resourceCleanup.status, "unknown");
    assert.equal(this.result.attempts[0].resourceCleanup.status, "unknown");
  },
);
