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

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setDefaultTimeout(30_000);
setWorldConstructor(RetryWorld);

When(
  "I execute browser-flow with one retry and a failure injected on attempt 1",
  async function (this: RetryWorld) {
    this.result = await executeReviewedScenarios({
      scenarioIds: ["browser-flow"],
      retryCount: 1,
      testFailAttempts: [1],
    });
  },
);

When(
  "I execute browser-flow with retries disabled and a failure injected on attempt 1",
  async function (this: RetryWorld) {
    this.result = await executeReviewedScenarios({
      scenarioIds: ["browser-flow"],
      testFailAttempts: [1],
    });
  },
);

When(
  "I execute browser-flow with one retry and failures injected on attempts 1 and 2",
  async function (this: RetryWorld) {
    this.result = await executeReviewedScenarios({
      scenarioIds: ["browser-flow"],
      retryCount: 1,
      testFailAttempts: [1, 2],
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

Then(
  "the first attempt records an injected failure after the browser passed",
  function (this: RetryWorld) {
    assert.ok(this.result);
    assert.equal(this.result.attempts[0].status, "failed");
    assert.equal(this.result.attempts[0].injectedFailure, true);
    assert.equal(this.result.attempts[0].scenarios[0].status, "passed");
  },
);

Then(
  "the second attempt passes and the run is passed after retry",
  function (this: RetryWorld) {
    assert.ok(this.result);
    assert.equal(this.result.attemptCount, 2);
    assert.equal(this.result.attempts[1].status, "passed");
    assert.equal(this.result.status, "passed_after_retry");
    assert.equal(this.result.scenarios[0].status, "passed_after_retry");
  },
);

Then(
  "the run is failed after {int} attempt with the injected failure preserved",
  function (this: RetryWorld, attempts: number) {
    assert.ok(this.result);
    assert.equal(this.result.status, "failed");
    assert.equal(this.result.attemptCount, attempts);
    assert.equal(this.result.attempts[0].injectedFailure, true);
  },
);

Then(
  "the run is failed after {int} attempts with both injected failures preserved",
  function (this: RetryWorld, attempts: number) {
    assert.ok(this.result);
    assert.equal(this.result.status, "failed");
    assert.equal(this.result.attemptCount, attempts);
    assert.deepEqual(
      this.result.attempts.map((attempt) => attempt.injectedFailure),
      [true, true],
    );
    assert.deepEqual(
      this.result.attempts.map((attempt) => attempt.scenarios[0].status),
      ["passed", "passed"],
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
