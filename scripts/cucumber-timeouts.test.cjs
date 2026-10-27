const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DEFAULT_STEP_TIMEOUT_MS,
  MAX_STEP_TIMEOUT_MS,
  MIN_STEP_TIMEOUT_MS,
  getStepTimeoutMs,
} = require("../features/support/step-timeout.cjs");

const root = path.resolve(__dirname, "..");
const cucumberBin = path.join(
  root,
  "node_modules/@cucumber/cucumber/bin/cucumber.js",
);
const hooks = path.join(root, "features/support/hooks.cjs");
const steps = path.join(root, "features/steps/synthetic.steps.cjs");
const cucumberModule = require.resolve("@cucumber/cucumber");

function runScenario(feature, additionalSteps, tag, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cucumber-timeout-"));
  const featurePath = path.join(directory, "scenario.feature");
  fs.writeFileSync(featurePath, feature);

  const args = ["--config", "cucumber.js", "--tags", tag, featurePath];
  if (additionalSteps) {
    const stepsPath = path.join(directory, "steps.cjs");
    fs.writeFileSync(stepsPath, additionalSteps);
    args.splice(args.length - 1, 0, "--require", stepsPath);
  }

  const env = { ...process.env };
  delete env.CUCUMBER_STEP_TIMEOUT_MS;
  if (options.stepTimeoutMs !== undefined) {
    env.CUCUMBER_STEP_TIMEOUT_MS = String(options.stepTimeoutMs);
  }
  const startedAt = Date.now();
  let result;
  try {
    result = spawnSync(process.execPath, [cucumberBin, ...args], {
      cwd: root,
      encoding: "utf8",
      env,
      timeout: options.processTimeoutMs,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const elapsedMs = Date.now() - startedAt;

  return {
    ...result,
    elapsedMs,
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
    `const { Given } = require(${JSON.stringify(cucumberModule)});
Given("I wait {int} milliseconds", function (duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
});
`,
    "@timeout-regression",
    { processTimeoutMs: 20_000 },
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
    undefined,
    "@assertion-regression",
    { processTimeoutMs: 12_000, stepTimeoutMs: MIN_STEP_TIMEOUT_MS },
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
    undefined,
    "@invalid-timeout",
    { processTimeoutMs: 5_000, stepTimeoutMs: MAX_STEP_TIMEOUT_MS + 1 },
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /CUCUMBER_STEP_TIMEOUT_MS must be an integer from 12000 to 60000/,
  );
  assert.doesNotMatch(result.output, /browserType\.launch/);
});
