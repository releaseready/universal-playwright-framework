import assert from "node:assert/strict";
import {
  Given,
  Then,
  When,
  World,
  setWorldConstructor,
  type IWorldOptions,
} from "@cucumber/cucumber";
import {
  createExecutionReport,
  renderExecutionReport,
  renderExecutionReportJson,
  type ExecutionReport,
} from "../../src/reporting";
import { createReportFixtures } from "./report-fixture";

class ReportingWorld extends World {
  reports: readonly ExecutionReport[] = [];

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(ReportingWorld);

Given(
  "reviewed synthetic features have finished",
  function (this: ReportingWorld) {
    this.reports = [];
  },
);

When("a report is generated", function (this: ReportingWorld) {
  this.reports = createReportFixtures().map(createExecutionReport);
});

Then(
  "the retry report preserves both actual attempts and stable references",
  function (this: ReportingWorld) {
    const report = this.reports[0];
    const text = renderExecutionReport(report);
    const json = JSON.parse(
      renderExecutionReportJson(report),
    ) as ExecutionReport;
    assert.equal(report.status, "passed_after_retry");
    assert.equal(report.attempts[0].status, "failed");
    assert.equal(report.attempts[0].scenarios[0].steps[2].status, "failed");
    assert.match(
      report.attempts[0].scenarios[0].steps[2].reason ?? "",
      /raw error details are withheld/,
    );
    assert.equal(json.runReference, report.runReference);
    assert.equal(json.sourceRevision, report.sourceRevision);
    assert.match(text, /Execute reviewed synthetic scenarios/);
    assert.match(text, /the synthetic status matches its retry attempt/);
  },
);

Then(
  "outcomes, attempts, totals, and not-executed work remain distinct",
  function (this: ReportingWorld) {
    for (const report of this.reports) {
      const text = renderExecutionReport(report);
      const json = JSON.parse(
        renderExecutionReportJson(report),
      ) as ExecutionReport;
      assert.equal(json.totals.scenarioCount, report.scenarios.length);
      assert.equal(json.totals.attemptCount, report.attempts.length);
      assert.equal(
        Object.values(json.totals.scenarioOutcomes).reduce(
          (total, count) => total + count,
          0,
        ),
        json.totals.scenarioCount,
      );
      assert.equal(
        Object.values(json.totals.attemptOutcomes).reduce(
          (total, count) => total + count,
          0,
        ),
        json.totals.attemptCount,
      );
      assert.match(
        text,
        new RegExp(
          `Totals \\(scenarios, not attempts\\): scenarios=${json.totals.scenarioCount}; attempts=${json.totals.attemptCount}; not-executed=${json.totals.notExecutedScenarioCount}`,
        ),
      );
    }
    assert.ok(
      this.reports.some((report) =>
        report.scenarios.some(
          (scenario) => scenario.executionState === "not_executed",
        ),
      ),
    );
    assert.ok(this.reports.some((report) => report.status === "cancelled"));
    assert.ok(this.reports.some((report) => report.status === "timed_out"));
    assert.ok(this.reports.some((report) => report.status === "incomplete"));
    assert.ok(
      this.reports.some((report) => report.status === "passed_after_retry"),
    );
  },
);

Then(
  "screenshots logs and traces are withheld without claiming sanitization",
  function (this: ReportingWorld) {
    for (const report of this.reports) {
      assert.equal(report.artifacts.status, "withheld");
      assert.deepEqual(report.artifacts.types, [
        "screenshots",
        "logs",
        "traces",
      ]);
      assert.match(report.artifacts.reason, /not collected or attached/);
      assert.doesNotMatch(report.artifacts.reason, /sanitized|redacted/i);
    }
  },
);

Then(
  "unsafe references are rejected without being echoed",
  function (this: ReportingWorld) {
    const fixture = createReportFixtures()[0];
    const unsafe = {
      ...fixture,
      diagnosticReference: "../../outside/customer.log",
    };
    assert.throws(
      () => createExecutionReport(unsafe),
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          "Report references must be generated execution identifiers",
    );
    const unsafeScenario = {
      ...fixture,
      scenarios: [
        {
          ...fixture.scenarios[0],
          scenarioId: "../../outside/customer.log",
          cucumber: {
            ...fixture.scenarios[0].cucumber!,
            scenarioName: "https://example.invalid/private",
          },
        },
      ],
    };
    const rejected = createExecutionReport(unsafeScenario);
    assert.equal(rejected.scenarios[0].status, fixture.status);
    assert.equal(rejected.scenarios[0].evidenceStatus, "unavailable");
    assert.equal(rejected.scenarios[0].scenarioId, undefined);
    assert.doesNotMatch(
      `${renderExecutionReport(rejected)}${renderExecutionReportJson(rejected)}`,
      /outside\/customer\.log|https:\/\//,
    );
    const outputs = this.reports.flatMap((report) => [
      renderExecutionReport(report),
      renderExecutionReportJson(report),
    ]);
    assert.ok(
      outputs.every(
        (output) =>
          !output.includes("outside/customer.log") &&
          !output.includes("https://"),
      ),
    );
  },
);

Then(
  "unavailable evidence does not change the execution outcome",
  function (this: ReportingWorld) {
    const report = this.reports.find(
      (candidate) => candidate.status === "incomplete",
    );
    assert.ok(report);
    assert.equal(report.scenarios[0].status, "incomplete");
    assert.equal(report.scenarios[0].evidenceStatus, "unavailable");
    assert.match(report.scenarios[0].evidenceReason ?? "", /no artifact/);
    assert.equal(report.scenarios[0].executionState, "not_executed");
  },
);

Then(
  "every output is visibly synthetic and not customer acceptance",
  function (this: ReportingWorld) {
    for (const report of this.reports) {
      assert.equal(report.label, "SYNTHETIC — NOT CUSTOMER ACCEPTANCE");
      assert.match(renderExecutionReport(report), /not customer acceptance/i);
      assert.match(
        renderExecutionReportJson(report),
        /SYNTHETIC — NOT CUSTOMER ACCEPTANCE/,
      );
    }
  },
);
