import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { executeReviewedScenarios } from "../src/execution";
import {
  createExecutionReport,
  renderExecutionReport,
  renderExecutionReportJson,
} from "../src/reporting";
import { saveExecutionReport } from "../src/reporting/output";
import { createReportFixtures } from "../features/reporting/report-fixture";

const repositoryRoot = path.resolve(__dirname, "../../..");
const reportsDirectory = path.join(repositoryRoot, "reports");

test("the typed report retains Cucumber evidence from real retried execution", async () => {
  const summary = await executeReviewedScenarios({
    scenarioIds: ["retry-assertion-flow"],
    retryCount: 1,
    testAssertionMismatchAttempts: [1],
  });
  const report = createExecutionReport(summary);
  const failedScenario = report.attempts[0].scenarios[0];
  const failedStep = failedScenario.steps.find(
    (step) => step.status === "failed",
  );

  assert.equal(report.status, "passed_after_retry");
  assert.equal(report.attempts.length, 2);
  assert.equal(report.attempts[0].status, "failed");
  assert.equal(report.attempts[1].status, "passed");
  assert.equal(
    failedScenario.featureName,
    "Execute reviewed synthetic scenarios",
  );
  assert.equal(
    failedScenario.scenarioName,
    "A real assertion can fail before a retry passes",
  );
  assert.equal(
    failedStep?.name,
    "the synthetic status matches its retry attempt",
  );
  assert.match(failedStep?.reason ?? "", /raw error details are withheld/);
  assert.equal(report.totals.scenarioCount, 1);
  assert.equal(report.totals.attemptCount, 2);
  assert.equal(report.totals.countedUnit, "scenarios");
  assert.equal(report.artifacts.status, "withheld");
  assert.doesNotMatch(
    `${renderExecutionReport(report)}${renderExecutionReportJson(report)}`,
    /Expected string|Received string|Call log/,
  );
});

test("text and JSON render the same bounded totals and retain earlier failures", () => {
  const report = createExecutionReport(createReportFixtures()[0]);
  const text = renderExecutionReport(report);
  const json = JSON.parse(renderExecutionReportJson(report)) as typeof report;

  assert.equal(json.totals.scenarioCount, 1);
  assert.equal(json.totals.attemptCount, 2);
  assert.equal(json.totals.attemptOutcomes.failed, 1);
  assert.equal(json.totals.attemptOutcomes.passed, 1);
  assert.match(
    text,
    /Totals \(scenarios, not attempts\): scenarios=1; attempts=2; not-executed=0/,
  );
  assert.match(text, /failed: the synthetic status matches its retry attempt/);
  assert.match(text, /passed: the synthetic status matches its retry attempt/);
  assert.match(text, /SYNTHETIC — NOT CUSTOMER ACCEPTANCE/);
});

test("human text escapes terminal controls while JSON preserves names as data", () => {
  const fixture = createReportFixtures()[0];
  const attempt = fixture.attempts[0];
  const scenario = attempt.scenarios[0];
  const unsafe = {
    ...fixture,
    scenarios: [
      {
        ...fixture.scenarios[0],
        cucumber: {
          ...scenario.cucumber!,
          featureName: "\u001b[31m<script>\nFeature",
        },
      },
    ],
  };
  const report = createExecutionReport(unsafe);
  const text = renderExecutionReport(report);
  const json = renderExecutionReportJson(report);

  assert.doesNotMatch(text, /\u001b/);
  assert.match(text, /<script>\\nFeature/);
  assert.match(json, /\\u001b/);
  assert.doesNotMatch(text, /<!doctype html/i);
});

test("report files use a generated name and contain the authoritative outputs", () => {
  const report = createExecutionReport(createReportFixtures()[0]);
  const files = saveExecutionReport(report);
  const textPath = path.join(repositoryRoot, files.text);
  const jsonPath = path.join(repositoryRoot, files.json);

  try {
    assert.match(files.text, /^reports\/local-report-[0-9a-f-]+\.txt$/);
    assert.match(files.json, /^reports\/local-report-[0-9a-f-]+\.json$/);
    assert.match(readFileSync(textPath, "utf8"), /attempts=2/);
    assert.deepEqual(JSON.parse(readFileSync(jsonPath, "utf8")), report);
    assert.equal(lstatSync(jsonPath).isSymbolicLink(), false);
  } finally {
    unlinkSync(textPath);
    unlinkSync(jsonPath);
  }
});

test("report output refuses a symlink directory without writing through it", () => {
  const backupDirectory = path.join(
    repositoryRoot,
    `.reports-backup-${process.pid}`,
  );
  const externalDirectory = mkdtempSync(
    path.join(tmpdir(), "rrdweb5-report-output-"),
  );
  renameSync(reportsDirectory, backupDirectory);
  let linkCreated = false;

  try {
    symlinkSync(externalDirectory, reportsDirectory, "dir");
    linkCreated = true;
    assert.throws(
      () =>
        saveExecutionReport(createExecutionReport(createReportFixtures()[0])),
      /Local report output is unavailable/,
    );
    assert.deepEqual(readdirSync(externalDirectory), []);
  } finally {
    if (linkCreated) {
      unlinkSync(reportsDirectory);
    }
    renameSync(backupDirectory, reportsDirectory);
    rmSync(externalDirectory, { recursive: true, force: true });
  }
});

test("caller-controlled traversal references are rejected without being echoed", () => {
  const fixture = createReportFixtures()[0];
  assert.throws(
    () =>
      createExecutionReport({
        ...fixture,
        diagnosticReference: "../../unrelated/private.log",
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message ===
        "Report references must be generated execution identifiers",
  );
  for (const summary of createReportFixtures()) {
    const text = renderExecutionReport(createExecutionReport(summary));
    const json = renderExecutionReportJson(createExecutionReport(summary));
    assert.doesNotMatch(`${text}${json}`, /unrelated\/private\.log/);
    assert.doesNotMatch(`${text}${json}`, /https:\/\//);
  }
});

test("missing Cucumber evidence remains unavailable without changing its outcome", () => {
  const summary = createReportFixtures()[3];
  const report = createExecutionReport(summary);

  assert.equal(report.status, "incomplete");
  assert.equal(report.scenarios[0].status, "incomplete");
  assert.equal(report.scenarios[0].executionState, "not_executed");
  assert.equal(report.scenarios[0].evidenceStatus, "unavailable");
  assert.match(report.scenarios[0].evidenceReason ?? "", /no artifact/);
});
