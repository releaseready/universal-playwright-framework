import type {
  ExecutionAttemptSummary,
  ExecutionSummary,
  ScenarioExecutionResult,
} from "../../src/execution";

const reference = (tail: string): string => `00000000-0000-4000-8000-${tail}`;
const confirmedCleanup = {
  status: "confirmed" as const,
  failures: [],
  browserProcessStopped: true,
  blockedTargetRequestCount: 0,
  injectedPendingCleanup: false,
};
const dataRestoration = {
  status: "unknown" as const,
  operationPerformed: false as const,
};

function scenario(
  scenarioId: string,
  status: ScenarioExecutionResult["status"],
  cucumber?: ScenarioExecutionResult["cucumber"],
  cleanupFailures: readonly string[] = [],
): ScenarioExecutionResult {
  return {
    scenarioId,
    status,
    ...(cucumber ? { cucumber } : {}),
    cleanupStatus: status === "incomplete" ? "unknown" : "confirmed",
    cleanupFailures,
    cleanupFaultInjected: false,
    workerStopped: true,
    workerStallInjected: false,
  };
}

function attempt(
  attemptNumber: number,
  status: ExecutionAttemptSummary["status"],
  scenarios: readonly ScenarioExecutionResult[],
): ExecutionAttemptSummary {
  return {
    attemptNumber,
    diagnosticReference: reference(`00000000000${attemptNumber}`),
    status,
    resourceCleanup: confirmedCleanup,
    dataRestoration,
    scenarios,
  };
}

function summary(
  diagnosticReference: string,
  status: ExecutionSummary["status"],
  scenarios: readonly ScenarioExecutionResult[],
  attempts: readonly ExecutionAttemptSummary[],
): ExecutionSummary {
  return {
    diagnosticReference,
    status,
    resourceCleanup: confirmedCleanup,
    dataRestoration,
    scenarios,
    attemptCount: attempts.length,
    attempts,
  };
}

const passedRetryScenario = scenario("retry-assertion-flow", "passed", {
  featureName: "Execute reviewed synthetic scenarios",
  scenarioName: "A real assertion can fail before a retry passes",
  steps: [
    { name: "the synthetic reviewed page is open", status: "passed" },
    { name: "I enter the prepared display name", status: "passed" },
    {
      name: "the synthetic status matches its retry attempt",
      status: "passed",
    },
  ],
});
const failedRetryScenario = scenario("retry-assertion-flow", "failed", {
  featureName: "Execute reviewed synthetic scenarios",
  scenarioName: "A real assertion can fail before a retry passes",
  steps: [
    { name: "the synthetic reviewed page is open", status: "passed" },
    { name: "I enter the prepared display name", status: "passed" },
    {
      name: "the synthetic status matches its retry attempt",
      status: "failed",
    },
  ],
});

export function createReportFixtures(): readonly ExecutionSummary[] {
  return [
    summary(
      reference("000000000001"),
      "passed_after_retry",
      [
        {
          ...passedRetryScenario,
          status: "passed_after_retry",
        },
      ],
      [
        attempt(1, "failed", [failedRetryScenario]),
        attempt(2, "passed", [passedRetryScenario]),
      ],
    ),
    summary(
      reference("000000000002"),
      "cancelled",
      [failedRetryScenario],
      [attempt(1, "failed", [failedRetryScenario])],
    ),
    summary(
      reference("000000000003"),
      "timed_out",
      [scenario("timeout-flow", "timed_out")],
      [attempt(1, "timed_out", [scenario("timeout-flow", "timed_out")])],
    ),
    summary(
      reference("000000000004"),
      "incomplete",
      [
        scenario("unstarted-flow", "incomplete", undefined, [
          "scenario-not-started",
        ]),
      ],
      [
        attempt(1, "incomplete", [
          scenario("unstarted-flow", "incomplete", undefined, [
            "scenario-not-started",
          ]),
        ]),
      ],
    ),
    summary(
      reference("000000000005"),
      "failed",
      [
        scenario("pending-flow", "failed", {
          featureName: "Execute reviewed synthetic scenarios",
          scenarioName: "A pending reviewed step fails the run",
          steps: [
            { name: "the scenario is explicitly pending", status: "pending" },
          ],
        }),
      ],
      [
        attempt(1, "failed", [
          scenario("pending-flow", "failed", {
            featureName: "Execute reviewed synthetic scenarios",
            scenarioName: "A pending reviewed step fails the run",
            steps: [
              { name: "the scenario is explicitly pending", status: "pending" },
            ],
          }),
        ]),
      ],
    ),
  ];
}
