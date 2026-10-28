import type {
  CucumberScenarioEvidence,
  CucumberStepStatus,
  ExecutionAttemptSummary,
  ExecutionStatus,
  ExecutionSummary,
  ScenarioExecutionResult,
} from "../execution";
import { REVIEWED_SOURCE_REVISION } from "../execution/reviewed-scenarios";

const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  "passed",
  "passed_after_retry",
  "failed",
  "incomplete",
  "timed_out",
  "cancelled",
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SCENARIOS = 6;
const MAX_ATTEMPTS = 3;
const MAX_STEPS = 100;
const MAX_NAME_LENGTH = 300;
const SCENARIO_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const UNSAFE_REFERENCE_PATTERN =
  /(?:https?:\/\/|file:|javascript:|(?:^|[\s"'`])(?:\.\.?[\\/]|[a-z]:[\\/]|\/\S))/i;

export type ReportScenario = {
  readonly scenarioId?: string;
  readonly featureName?: string;
  readonly scenarioName?: string;
  readonly status: ExecutionStatus;
  readonly executionState: "executed" | "not_executed" | "unknown";
  readonly evidenceStatus: "available" | "unavailable";
  readonly evidenceReason?: string;
  readonly cleanupStatus: ScenarioExecutionResult["cleanupStatus"];
  readonly steps: readonly {
    readonly name: string;
    readonly status: CucumberStepStatus;
    readonly reason?: string;
  }[];
};

export interface ExecutionReport {
  readonly schemaVersion: 1;
  readonly label: "SYNTHETIC — NOT CUSTOMER ACCEPTANCE";
  readonly runReference: string;
  readonly sourceRevision: string;
  readonly status: ExecutionStatus;
  readonly totals: {
    readonly countedUnit: "scenarios";
    readonly scenarioCount: number;
    readonly attemptCount: number;
    readonly notExecutedScenarioCount: number;
    readonly scenarioOutcomes: Readonly<Record<ExecutionStatus, number>>;
    readonly attemptOutcomes: Readonly<Record<ExecutionStatus, number>>;
  };
  readonly scenarios: readonly ReportScenario[];
  readonly attempts: readonly {
    readonly attemptNumber: number;
    readonly diagnosticReference: string;
    readonly status: ExecutionStatus;
    readonly scenarios: readonly ReportScenario[];
  }[];
  readonly artifacts: {
    readonly status: "withheld";
    readonly types: readonly ["screenshots", "logs", "traces"];
    readonly reason: string;
  };
}

const EMPTY_OUTCOMES: Record<ExecutionStatus, number> = {
  passed: 0,
  passed_after_retry: 0,
  failed: 0,
  incomplete: 0,
  timed_out: 0,
  cancelled: 0,
};

function assertReference(reference: string): void {
  if (!UUID_PATTERN.test(reference)) {
    throw new Error(
      "Report references must be generated execution identifiers",
    );
  }
}

function countOutcomes(
  results: readonly { readonly status: ExecutionStatus }[],
): Readonly<Record<ExecutionStatus, number>> {
  const counts = { ...EMPTY_OUTCOMES };
  for (const result of results) {
    counts[result.status] += 1;
  }
  return counts;
}

function reasonForStep(status: CucumberStepStatus): string | undefined {
  switch (status) {
    case "failed":
      return "The business step failed; raw error details are withheld.";
    case "pending":
      return "The step is pending and did not execute.";
    case "undefined":
      return "No step implementation matched; the step did not execute.";
    case "skipped":
      return "The step was skipped after an earlier unfinished step.";
    case "ambiguous":
      return "Multiple step implementations matched; no successful result is claimed.";
    case "unknown":
      return "Cucumber did not provide a recognized step outcome.";
    case "passed":
      return undefined;
  }
}

function reportScenario(result: ScenarioExecutionResult): ReportScenario {
  const cucumber = result.cucumber;
  if (
    typeof result.scenarioId !== "string" ||
    result.scenarioId.length > MAX_NAME_LENGTH ||
    (cucumber && cucumber.steps.length > MAX_STEPS)
  ) {
    throw new Error("Scenario report data exceeds the local reporting bounds");
  }
  const safeCucumber =
    cucumber &&
    [
      cucumber.featureName,
      cucumber.scenarioName,
      ...cucumber.steps.map((step) => step.name),
    ].every(
      (value) =>
        value.length <= MAX_NAME_LENGTH &&
        !UNSAFE_REFERENCE_PATTERN.test(value),
    )
      ? cucumber
      : undefined;
  const hasExecutedStep = safeCucumber?.steps.some((step) =>
    ["passed", "failed"].includes(step.status),
  );
  const allStepsDidNotRun = safeCucumber?.steps.every((step) =>
    ["skipped", "pending", "undefined", "ambiguous"].includes(step.status),
  );
  const executionState = hasExecutedStep
    ? "executed"
    : allStepsDidNotRun ||
        result.cleanupFailures.includes("scenario-not-started")
      ? "not_executed"
      : "unknown";
  const steps =
    safeCucumber?.steps.map((step) => ({
      name: step.name,
      status: step.status,
      ...(reasonForStep(step.status)
        ? { reason: reasonForStep(step.status) }
        : {}),
    })) ?? [];
  return {
    ...(SCENARIO_ID_PATTERN.test(result.scenarioId)
      ? { scenarioId: result.scenarioId }
      : {}),
    ...(safeCucumber
      ? {
          featureName: safeCucumber.featureName,
          scenarioName: safeCucumber.scenarioName,
        }
      : {}),
    status: result.status,
    executionState,
    evidenceStatus: safeCucumber ? "available" : "unavailable",
    ...(!safeCucumber
      ? {
          evidenceReason: cucumber
            ? "Cucumber scenario evidence contained an unapproved reference and was rejected."
            : "Cucumber scenario evidence was unavailable; no artifact was fabricated.",
        }
      : {}),
    cleanupStatus: result.cleanupStatus,
    steps,
  };
}

export function createExecutionReport(
  summary: ExecutionSummary,
): ExecutionReport {
  assertReference(summary.diagnosticReference);
  if (
    !Array.isArray(summary.scenarios) ||
    summary.scenarios.length > MAX_SCENARIOS ||
    !Array.isArray(summary.attempts) ||
    summary.attempts.length > MAX_ATTEMPTS ||
    summary.attemptCount !== summary.attempts.length
  ) {
    throw new Error("Execution summary exceeds the local reporting bounds");
  }
  for (const attempt of summary.attempts) {
    assertReference(attempt.diagnosticReference);
    if (attempt.scenarios.length > MAX_SCENARIOS) {
      throw new Error("Attempt report data exceeds the local reporting bounds");
    }
  }
  const scenarios = summary.scenarios.map(reportScenario);
  const attempts = summary.attempts.map((attempt: ExecutionAttemptSummary) => ({
    attemptNumber: attempt.attemptNumber,
    diagnosticReference: attempt.diagnosticReference,
    status: attempt.status,
    scenarios: attempt.scenarios.map(reportScenario),
  }));
  return {
    schemaVersion: 1,
    label: "SYNTHETIC — NOT CUSTOMER ACCEPTANCE",
    runReference: summary.diagnosticReference,
    sourceRevision: REVIEWED_SOURCE_REVISION,
    status: summary.status,
    totals: {
      countedUnit: "scenarios",
      scenarioCount: scenarios.length,
      attemptCount: attempts.length,
      notExecutedScenarioCount: scenarios.filter(
        (scenario) => scenario.executionState === "not_executed",
      ).length,
      scenarioOutcomes: countOutcomes(scenarios),
      attemptOutcomes: countOutcomes(attempts),
    },
    scenarios,
    attempts,
    artifacts: {
      status: "withheld",
      types: ["screenshots", "logs", "traces"],
      reason:
        "Screenshots, logs, and traces are not collected or attached by this local reporting slice.",
    },
  };
}

function plainText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => {
    if (character === "\n") {
      return "\\n";
    }
    if (character === "\r") {
      return "\\r";
    }
    if (character === "\t") {
      return " ";
    }
    return "�";
  });
}

function scenarioLines(heading: string, scenario: ReportScenario): string[] {
  const name = scenario.scenarioName
    ? `${plainText(scenario.featureName ?? "Feature unavailable")} / ${plainText(scenario.scenarioName)}`
    : `Scenario ${plainText(scenario.scenarioId ?? "identifier unavailable")} (name unavailable)`;
  const lines = [
    `${heading}: ${name} — ${scenario.status} (${scenario.executionState})`,
  ];
  for (const step of scenario.steps) {
    lines.push(`  ${step.status}: ${plainText(step.name)}`);
    if (step.reason) {
      lines.push(`    Reason: ${step.reason}`);
    }
  }
  if (scenario.evidenceStatus === "unavailable") {
    lines.push(`  Evidence unavailable: ${scenario.evidenceReason}`);
  }
  return lines;
}

export function renderExecutionReport(report: ExecutionReport): string {
  const totals = report.totals;
  const lines = [
    report.label,
    `Outcome: ${report.status}`,
    `Run reference: ${report.runReference}`,
    `Source revision: ${report.sourceRevision}`,
    `Totals (scenarios, not attempts): scenarios=${totals.scenarioCount}; attempts=${totals.attemptCount}; not-executed=${totals.notExecutedScenarioCount}`,
    `Scenario outcomes: ${EXECUTION_STATUSES.map((status) => `${status}=${totals.scenarioOutcomes[status]}`).join(", ")}`,
    `Attempt outcomes: ${EXECUTION_STATUSES.map((status) => `${status}=${totals.attemptOutcomes[status]}`).join(", ")}`,
    "Scenarios:",
  ];
  for (const scenario of report.scenarios) {
    lines.push(...scenarioLines("  Result", scenario));
  }
  lines.push("Attempts:");
  for (const attempt of report.attempts) {
    lines.push(
      `  Attempt ${attempt.attemptNumber}: ${attempt.status} (reference ${attempt.diagnosticReference})`,
    );
    for (const scenario of attempt.scenarios) {
      lines.push(...scenarioLines("    Result", scenario));
    }
  }
  lines.push(
    `Evidence withheld: ${report.artifacts.reason}`,
    "This synthetic report is not customer acceptance.",
  );
  return `${lines.join("\n")}\n`;
}

export function renderExecutionReportJson(report: ExecutionReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export type { CucumberScenarioEvidence };
