import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Compiled under dist/authoring/examples/authoring/regression.
const root = path.resolve(__dirname, "../../../../..");
const cucumber = path.join(
  root,
  "node_modules/@cucumber/cucumber/bin/cucumber.js",
);
type Scenario = {
  steps: Array<{
    result: { status: string };
    embeddings?: Array<{ data: string; mime_type: string }>;
  }>;
};
type Feature = { elements?: Scenario[] };

function runCucumber(extraArgs: string[], feature?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), "owned-authoring-"));
  const report = path.join(directory, "report.json");
  const args = [cucumber, ...extraArgs, "--format", `json:${report}`];
  if (feature) {
    const file = path.join(directory, "probe.feature");
    writeFileSync(file, feature);
    args.push(file);
  }
  try {
    const started = Date.now();
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      timeout: 45000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(
      result.signal,
      null,
      `Cucumber was terminated: ${result.stderr}`,
    );
    const scenarios = (
      JSON.parse(readFileSync(report, "utf8")) as Feature[]
    ).flatMap((item) => item.elements ?? []);
    assert.ok(scenarios.length > 0, "Cucumber must execute scenarios");
    for (const scenario of scenarios) {
      const cleanup = scenario.steps.flatMap((step) =>
        (step.embeddings ?? [])
          .filter((item) => item.mime_type === "application/json")
          .map((item) => ({
            status: step.result.status,
            evidence: JSON.parse(
              Buffer.from(item.data, "base64").toString(),
            ) as { ownedAuthoringCleanup?: boolean },
          })),
      );
      assert.equal(
        cleanup.length,
        1,
        "exactly one owned cleanup attachment per scenario",
      );
      assert.equal(
        cleanup[0].status,
        "passed",
        "cleanup hook must pass even when the scenario fails",
      );
      assert.equal(
        cleanup[0].evidence.ownedAuthoringCleanup,
        true,
        "owned cleanup must be error-free",
      );
    }
    return {
      ...result,
      scenarios,
      elapsed: Date.now() - started,
      output: result.stdout + result.stderr,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test(
  "three styles repeat with parallel scenario isolation and owned cleanup",
  { timeout: 150000 },
  () => {
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const result = runCucumber([
        "--config",
        "examples/authoring/cucumber.json",
        "--parallel",
        "3",
      ]);
      assert.equal(result.status, 0, result.output);
      assert.equal(result.scenarios.length, 3);
      assert.ok(
        result.scenarios.every((item) =>
          item.steps.every((step) => step.result.status === "passed"),
        ),
      );
    }
  },
);

for (const [name, step, message] of [
  [
    "missing readiness",
    "When I require a missing ready control",
    /Timeout 100ms exceeded/,
  ],
  [
    "hidden readiness",
    "When I require a hidden ready control",
    /Timeout 100ms exceeded/,
  ],
  ["false saved outcome", "Then only that draft is saved", /Not saved/],
  [
    "context interruption",
    "When the owned browser context is interrupted during readiness",
    /closed/,
  ],
] as const) {
  test(
    `${name} fails visibly, exits within a bound and cleans owned resources`,
    { timeout: 50000 },
    () => {
      const result = runCucumber(
        ["--config", "examples/authoring/regression/cucumber.json"],
        `Feature: owned failure propagation\n  Scenario: ${name}\n    Given a fresh synthetic draft workspace\n    ${step}\n`,
      );
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, message);
      assert.equal(result.scenarios.length, 1);
      assert.ok(
        result.scenarios[0].steps.some(
          (item) => item.result.status === "failed",
        ),
      );
      assert.ok(
        result.elapsed < 20000,
        `unbounded failure: ${result.elapsed}ms`,
      );
    },
  );
}

test(
  "root and dedicated Playwright discovery remain separate",
  { timeout: 30000 },
  () => {
    function list(config: string) {
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, "node_modules/@playwright/test/cli.js"),
          "test",
          "--config",
          config,
          "--list",
          "--reporter=json",
        ],
        { cwd: root, encoding: "utf8", timeout: 15000 },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as { suites: Suite[] };
    }
    type Suite = {
      file: string;
      specs?: Array<{ tests: unknown[] }>;
      suites?: Suite[];
    };
    function files(suites: Suite[]): string[] {
      return suites.flatMap((suite) => [
        ...(suite.specs ?? []).flatMap((spec) =>
          spec.tests.map(() => suite.file),
        ),
        ...files(suite.suites ?? []),
      ]);
    }
    const standard = files(list("playwright.config.ts").suites);
    assert.equal(
      standard.length,
      21,
      "existing root coverage must remain intact",
    );
    assert.ok(standard.every((file) => !file.includes("authoring")));
    const dedicated = files(
      list("examples/authoring/playwright.config.ts").suites,
    );
    assert.equal(dedicated.length, 10);
    assert.deepEqual([...new Set(dedicated)].sort(), [
      "business-flows.spec.ts",
      "page-objects.spec.ts",
      "readiness.spec.ts",
      "simple.spec.ts",
    ]);
  },
);

test(
  "a timed-out Before cannot report cleanup before late browser acquisition closes",
  { timeout: 30000 },
  () => {
    const result = runCucumber(
      ["--config", "examples/authoring/regression/late-setup.json"],
      "Feature: late setup\n  Scenario: setup timeout\n    Given the interrupted setup probe\n",
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /function timed out/);
    assert.equal(result.scenarios.length, 1);
    assert.ok(
      result.scenarios[0].steps.some((step) => step.result.status === "failed"),
    );
    assert.ok(result.elapsed < 20000);
  },
);
