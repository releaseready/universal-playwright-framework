import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_STEP_TIMEOUT_MS,
  MAX_STEP_TIMEOUT_MS,
  MIN_STEP_TIMEOUT_MS,
  getStepTimeoutMs,
} from "../features/support/step-timeout";
import { closeRuntime } from "../features/support/cleanup-runtime";
import type { Server } from "node:http";
import type { Browser } from "@playwright/test";

const root = path.resolve(__dirname, "../../..");
const cucumberBin = path.join(
  root,
  "node_modules/@cucumber/cucumber/bin/cucumber.js",
);
const reportPath = path.join(root, "reports/cucumber-results.json");
const resultsBytes = readFileSync(reportPath);
const results = JSON.parse(resultsBytes.toString()) as {
  elements?: Array<{ steps: Array<{ result: { status: string } }> }>;
}[];

assert.ok(
  results.some((feature) =>
    feature.elements?.some((scenario) =>
      scenario.steps.every((step) => step.result.status === "passed"),
    ),
  ),
  "The real Cucumber E2E report must contain a passed scenario",
);

function runScenario(
  feature: string,
  tag: string,
  stepTimeoutMs?: number,
  processTimeoutMs = 20_000,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "cucumber-timeout-"));
  const featurePath = path.join(directory, "scenario.feature");
  writeFileSync(featurePath, feature);
  const env = { ...process.env };
  delete env.CUCUMBER_STEP_TIMEOUT_MS;
  if (stepTimeoutMs !== undefined) {
    env.CUCUMBER_STEP_TIMEOUT_MS = String(stepTimeoutMs);
  }

  const startedAt = Date.now();
  let result;
  try {
    result = spawnSync(
      process.execPath,
      [
        cucumberBin,
        "--config",
        "cucumber-regression.json",
        "--tags",
        tag,
        featurePath,
      ],
      { cwd: root, encoding: "utf8", env, timeout: processTimeoutMs },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  assert.deepEqual(
    readFileSync(reportPath),
    resultsBytes,
    "Regression Cucumber execution must not overwrite the real E2E report",
  );

  return {
    ...result,
    elapsedMs: Date.now() - startedAt,
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

test("Cucumber step timeout defaults and rejects values outside its documented bounds", () => {
  assert.equal(DEFAULT_STEP_TIMEOUT_MS, 15_000);
  assert.equal(getStepTimeoutMs(undefined), DEFAULT_STEP_TIMEOUT_MS);
  assert.equal(
    getStepTimeoutMs(String(MIN_STEP_TIMEOUT_MS)),
    MIN_STEP_TIMEOUT_MS,
  );
  assert.equal(
    getStepTimeoutMs(String(MAX_STEP_TIMEOUT_MS)),
    MAX_STEP_TIMEOUT_MS,
  );

  for (const invalid of ["11999", "60001", "5s", "1.5", ""]) {
    assert.throws(() => getStepTimeoutMs(invalid), /CUCUMBER_STEP_TIMEOUT_MS/);
  }
});

test("a step longer than the legacy 5s timeout passes with the default", () => {
  const result = runScenario(
    `@timeout-regression
Feature: Cucumber step timeout
  Scenario: a synthetic step outlasts the old default
    Given I wait 5500 milliseconds
`,
    "@timeout-regression",
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /1 scenario \(1 passed\)/);
  assert.ok(
    result.elapsedMs >= 5_500,
    `completed too early: ${result.elapsedMs}ms`,
  );
});

test("assertion failures stay readable and Cucumber exits after running cleanup", () => {
  const result = runScenario(
    `@assertion-regression
Feature: failed synthetic assertion
  Scenario: cleanup still runs after an assertion failure
    Given the demo page is open
    Then the page title should be "Incorrect title"
`,
    "@assertion-regression",
    MIN_STEP_TIMEOUT_MS,
    12_000,
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Expected string: "Incorrect title"/);
  assert.match(result.output, /Received string: "Synthetic demo"/);
  assert.doesNotMatch(result.output, /function timed out/);
  assert.ok(
    result.elapsedMs < 12_000,
    `Cucumber process did not clean up: ${result.elapsedMs}ms`,
  );
});

test("invalid timeout configuration fails before browser setup", () => {
  const result = runScenario(
    `@invalid-timeout
Feature: invalid timeout setting
  Scenario: invalid timeout fails at startup
    Given the demo page is open
`,
    "@invalid-timeout",
    MAX_STEP_TIMEOUT_MS + 1,
    5_000,
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /CUCUMBER_STEP_TIMEOUT_MS must be an integer from 12000 to 60000/,
  );
  assert.doesNotMatch(result.output, /browserType\.launch/);
});

test("server closes when browser close rejects and the browser error is preserved", async () => {
  const browserError = new Error("browser close failed");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const browser = {
    close: async () => {
      throw browserError;
    },
  } as Pick<Browser, "close">;

  try {
    await assert.rejects(closeRuntime(browser, server), (error) => {
      assert.equal(error, browserError);
      return true;
    });
    assert.equal(
      server.listening,
      false,
      "HTTP listener must close despite browser error",
    );
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});

test("server closes within a bound when browser close never settles", async () => {
  const browserCloseTimeoutMs = 100;
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const browser = {
    close: () => new Promise<void>(() => {}),
  } as Pick<Browser, "close">;
  const startedAt = Date.now();

  try {
    await assert.rejects(
      closeRuntime(browser, server, browserCloseTimeoutMs),
      new RegExp(
        `Browser close did not finish within ${browserCloseTimeoutMs} ms; browser shutdown status is unknown`,
      ),
    );
    assert.equal(
      server.listening,
      false,
      "HTTP listener must close after browser-close timeout",
    );
    assert.ok(
      Date.now() - startedAt < 1_000,
      "cleanup should finish shortly after the bounded browser-close timeout",
    );
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});

test("both cleanup failures are attempted and preserved", async () => {
  const browserError = new Error("browser close failed");
  const serverError = new Error("server close failed");
  let serverCloseAttempted = false;
  const browser = {
    close: async () => {
      throw browserError;
    },
  } as Pick<Browser, "close">;
  const server = {
    listening: true,
    close: (callback?: (error?: Error) => void) => {
      serverCloseAttempted = true;
      callback?.(serverError);
      return server;
    },
  } as unknown as Pick<Server, "listening" | "close">;

  await assert.rejects(closeRuntime(browser, server), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [browserError, serverError]);
    return true;
  });
  assert.equal(serverCloseAttempted, true);
});
