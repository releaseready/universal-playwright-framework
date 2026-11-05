import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { executeReviewedScenarios, type ExecutionSummary } from "../execution";
import {
  loadReviewedScenarios,
  reviewedFixturePolicy,
} from "../execution/reviewed-scenarios";
import { createExecutionReport } from "../reporting";
import { adapterLifecycle } from "./v1";

const reference = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const approvalSchema = z
  .object({
    sourceRevision: reference,
    featureRevision: digest,
    implementationRevision: digest,
  })
  .strict();
const inputsSchema = z
  .object({
    fixtureRevision: reference,
    environmentRevision: reference,
    policyRevision: reference,
  })
  .strict();
const targetSchema = z
  .object({
    kind: z.literal("owned-local"),
    id: reference,
    origin: z
      .string()
      .max(100)
      .regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/)
      .describe(
        "Canonical owned loopback HTTP origin with an explicit non-default port in 1..65535; URL canonicalization is also validated at runtime.",
      )
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "http:" &&
            url.hostname === "127.0.0.1" &&
            !!url.port &&
            url.origin === value
          );
        } catch {
          return false;
        }
      }),
  })
  .strict();
const bindingSchema = z
  .object({
    tenantId: reference,
    projectId: reference,
    environmentId: reference,
    caseId: reference,
    caseRevision: z.number().int().positive(),
    caseSourceHash: digest,
    dataRevision: digest,
    configurationRevision: digest,
    implementationRevision: digest,
    approvalId: reference,
    attempt: z.literal(1),
  })
  .strict();
const requestSchema = z
  .object({
    version: z.literal(2),
    run: z
      .object({
        id: reference,
        gitRevision: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict(),
    target: targetSchema,
    scenarioIds: z.tuple([z.literal("local-demo-navigation")]),
    binding: bindingSchema,
    approval: approvalSchema,
    inputs: inputsSchema,
    limits: z
      .object({
        runTimeoutMs: z.number().int().min(50).max(120000),
        scenarioTimeoutMs: z.number().int().min(50).max(60000),
        maxConcurrentScenarios: z.literal(1),
        retryCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
const contextSchema = z
  .object({
    version: z.literal(2),
    authorization: z.literal("owned-local"),
    callerId: reference,
    request: requestSchema,
    approval: z
      .object({ active: z.boolean(), expiresAt: z.number().int().positive() })
      .strict(),
    browserExecutablePath: z.literal("/usr/bin/chromium").optional(),
  })
  .strict();
export type OwnedLocalRequest = z.infer<typeof requestSchema>;
export type OwnedLocalContext = z.infer<typeof contextSchema>;
export type TrustedOwnedLocalContext = OwnedLocalContext;

const statuses = z.enum([
  "passed",
  "passed_after_retry",
  "failed",
  "incomplete",
  "timed_out",
  "cancelled",
]);
const cleanupStatus = z.enum([
  "not_required",
  "confirmed",
  "failed",
  "unknown",
]);
const failures = z
  .array(
    z.enum([
      "execution-evidence-unavailable",
      "browser-process-state-unknown",
      "browser-launch-state-unknown",
      "temporary-report-cleanup",
      "attempt-cleanup-hook",
      "fixture-server-state-unknown",
      "fixture-server-close",
      "redirect-server-state-unknown",
      "redirect-server-close",
      "owned-process-terminated",
      "owned-process-state-unknown",
      "worker-start",
      "cleanup-evidence-missing",
      "prepared-input-missing",
      "scenario-not-started",
      "context-close",
      "browser-close",
      "cleanup-report",
    ]),
  )
  .max(20);
const resourceCleanup = z
  .object({
    status: cleanupStatus,
    failures,
    browserProcessStopped: z.boolean().nullable(),
    blockedTargetRequestCount: z.number().int().nonnegative(),
  })
  .strict();
const lifecycleSchema = z
  .object({
    resourceCleanup,
    dataRestoration: z
      .object({
        status: z.literal("unknown"),
        operationPerformed: z.literal(false),
      })
      .strict(),
  })
  .strict();
const stepName = z.enum([
  "the synthetic reviewed page is open",
  "I explore the owned local demo",
  "the owned local demo shows its synthetic workspace and project",
  "I return from the owned local demo to sign in",
  "the owned local sign in page is visible",
]);
const reason = z.enum([
  "The business step failed; raw error details are withheld.",
  "The step is pending and did not execute.",
  "No step implementation matched; the step did not execute.",
  "The step was skipped after an earlier unfinished step.",
  "Multiple step implementations matched; no successful result is claimed.",
  "Cucumber did not provide a recognized step outcome.",
]);
const reportScenario = z
  .object({
    scenarioId: z.literal("local-demo-navigation"),
    featureName: z.literal("Execute reviewed synthetic scenarios").optional(),
    scenarioName: z
      .literal("A visitor explores the owned local demo and returns to sign in")
      .optional(),
    status: statuses,
    executionState: z.enum(["executed", "not_executed", "unknown"]),
    evidenceStatus: z.enum(["available", "unavailable"]),
    evidenceReason: z
      .enum([
        "Cucumber scenario evidence contained an unapproved reference and was rejected.",
        "Cucumber scenario evidence was unavailable; no artifact was fabricated.",
      ])
      .optional(),
    cleanupStatus,
    steps: z
      .array(
        z
          .object({
            name: stepName,
            status: z.enum([
              "passed",
              "failed",
              "skipped",
              "pending",
              "undefined",
              "ambiguous",
              "unknown",
            ]),
            reason: reason.optional(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
const counts = z
  .object({
    passed: z.number().int().min(0).max(1),
    passed_after_retry: z.literal(0),
    failed: z.number().int().min(0).max(1),
    incomplete: z.number().int().min(0).max(1),
    timed_out: z.number().int().min(0).max(1),
    cancelled: z.number().int().min(0).max(1),
  })
  .strict();
const reportSchema = z
  .object({
    schemaVersion: z.literal(1),
    label: z.literal("SYNTHETIC — NOT CUSTOMER ACCEPTANCE"),
    runReference: z.uuid(),
    sourceRevision: reference,
    status: statuses,
    totals: z
      .object({
        countedUnit: z.literal("scenarios"),
        scenarioCount: z.number().int().min(0).max(1),
        attemptCount: z.number().int().min(0).max(1),
        notExecutedScenarioCount: z.number().int().min(0).max(1),
        scenarioOutcomes: counts,
        attemptOutcomes: counts,
      })
      .strict(),
    scenarios: z.array(reportScenario).max(1),
    attempts: z
      .array(
        z
          .object({
            attemptNumber: z.literal(1),
            diagnosticReference: z.uuid(),
            status: statuses,
            scenarios: z.array(reportScenario).max(1),
          })
          .strict(),
      )
      .max(1),
    artifacts: z
      .object({
        status: z.literal("withheld"),
        types: z.tuple([
          z.literal("screenshots"),
          z.literal("logs"),
          z.literal("traces"),
        ]),
        reason: z.literal(
          "Screenshots, logs, and traces are not collected or attached by this local reporting slice.",
        ),
      })
      .strict(),
  })
  .strict();
const errorMessages = {
  INVALID_REQUEST: "Use the bounded owned-local v2 request.",
  INVALID_CONTEXT:
    "Obtain an active execution approval for these exact references.",
  STALE_REVIEW:
    "Restore or review the installed implementation before execution.",
} as const;
const rejectedSchema = z
  .object({
    version: z.literal(2),
    accepted: z.literal(false),
    resourceAcquisition: z.literal("not_started"),
    error: z
      .object({
        code: z.enum(["INVALID_REQUEST", "INVALID_CONTEXT", "STALE_REVIEW"]),
        message: z.enum(Object.values(errorMessages)),
      })
      .strict(),
  })
  .strict();
const acceptedSchema = z
  .object({
    version: z.literal(2),
    accepted: z.literal(true),
    run: requestSchema.shape.run,
    target: targetSchema,
    binding: bindingSchema,
    callerId: reference,
    approval: approvalSchema,
    inputs: inputsSchema,
    report: reportSchema,
    lifecycle: lifecycleSchema
      .extend({
        attempts: z
          .array(
            lifecycleSchema
              .extend({
                attemptNumber: z.literal(1),
                diagnosticReference: z.uuid(),
                scenarios: z
                  .array(
                    z
                      .object({
                        scenarioId: z.literal("local-demo-navigation"),
                        cleanupStatus,
                        cleanupFailures: failures,
                        workerStopped: z.boolean(),
                      })
                      .strict(),
                  )
                  .max(1),
              })
              .strict(),
          )
          .max(1),
      })
      .strict(),
  })
  .strict();
/** Canonical transport shapes; validateOwnedLocalEvidence also enforces coherence. */
export const ownedLocalRequestJsonSchema = z.toJSONSchema(requestSchema, {
  unrepresentable: "any",
});
export const ownedLocalResultJsonSchema = z.toJSONSchema(
  z.union([acceptedSchema, rejectedSchema]),
  { unrepresentable: "any" },
);

export type OwnedLocalResult =
  | z.infer<typeof acceptedSchema>
  | z.infer<typeof rejectedSchema>;

export async function getOwnedLocalReview(): Promise<{
  approval: OwnedLocalRequest["approval"];
  inputs: OwnedLocalRequest["inputs"];
}> {
  const { approval } = await loadReviewedScenarios();
  return {
    approval: {
      sourceRevision: approval.sourceRevision,
      featureRevision: approval.featureRevision,
      implementationRevision: approval.implementationRevision,
    },
    inputs: {
      fixtureRevision: "synthetic-execution-fixtures-1",
      environmentRevision: "loopback-only-1",
      policyRevision: reviewedFixturePolicy.revision,
    },
  };
}
function reject(code: keyof typeof errorMessages): OwnedLocalResult {
  return {
    version: 2,
    accepted: false,
    resourceAcquisition: "not_started",
    error: { code, message: errorMessages[code] },
  };
}

/** Read-only historical validation: never checks current approval, launches or replays. */
export function validateOwnedLocalEvidence(
  input: unknown,
  evidence: unknown,
): evidence is OwnedLocalResult {
  const request = requestSchema.safeParse(input);
  if (!request.success) return false;
  const rejected = rejectedSchema.safeParse(evidence);
  if (rejected.success)
    return (
      rejected.data.error.message === errorMessages[rejected.data.error.code]
    );
  const parsed = acceptedSchema.safeParse(evidence);
  if (!parsed.success) return false;
  const result = parsed.data;
  if (
    !(["run", "target", "binding", "approval", "inputs"] as const).every(
      (key) => isDeepStrictEqual(request.data[key], result[key]),
    )
  )
    return false;
  if (
    result.report.sourceRevision !== result.approval.sourceRevision ||
    result.binding.implementationRevision !==
      result.approval.implementationRevision
  )
    return false;
  const report = result.report;
  if (
    report.status === "passed_after_retry" ||
    report.totals.attemptCount !== report.attempts.length ||
    report.totals.scenarioCount !== report.scenarios.length ||
    result.lifecycle.attempts.length !== report.attempts.length
  )
    return false;
  const count = (values: readonly { status: string }[]) =>
    Object.fromEntries(
      statuses.options.map((status) => [
        status,
        values.filter((value) => value.status === status).length,
      ]),
    );
  if (
    !isDeepStrictEqual(
      report.totals.scenarioOutcomes,
      count(report.scenarios),
    ) ||
    !isDeepStrictEqual(report.totals.attemptOutcomes, count(report.attempts)) ||
    report.totals.notExecutedScenarioCount !==
      report.scenarios.filter(
        (scenario) => scenario.executionState === "not_executed",
      ).length
  )
    return false;
  if (report.attempts.length === 0) {
    return (
      report.scenarios.length === 0 &&
      report.status !== "passed" &&
      report.status !== "failed" &&
      result.lifecycle.resourceCleanup.status !== "confirmed"
    );
  }
  const attempt = report.attempts[0];
  const cleanup = result.lifecycle.attempts[0];
  if (
    report.runReference !== attempt.diagnosticReference ||
    cleanup.diagnosticReference !== attempt.diagnosticReference ||
    report.status !== attempt.status ||
    !isDeepStrictEqual(report.scenarios, attempt.scenarios) ||
    !isDeepStrictEqual(
      result.lifecycle.resourceCleanup,
      cleanup.resourceCleanup,
    ) ||
    !isDeepStrictEqual(
      result.lifecycle.dataRestoration,
      cleanup.dataRestoration,
    ) ||
    cleanup.scenarios.length !== report.scenarios.length
  )
    return false;
  for (let index = 0; index < report.scenarios.length; index++) {
    const scenario = report.scenarios[index];
    const owned = cleanup.scenarios[index];
    if (
      scenario.cleanupStatus !== owned.cleanupStatus ||
      scenario.scenarioId !== owned.scenarioId
    )
      return false;
    if (scenario.evidenceStatus === "available") {
      if (
        !scenario.featureName ||
        !scenario.scenarioName ||
        scenario.evidenceReason !== undefined ||
        !isDeepStrictEqual(
          scenario.steps.map((step) => step.name),
          stepName.options,
        )
      )
        return false;
    } else if (
      scenario.steps.length !== 0 ||
      scenario.featureName !== undefined ||
      scenario.scenarioName !== undefined ||
      !scenario.evidenceReason
    )
      return false;
  }
  if (
    report.status === "failed" &&
    !report.scenarios.some(
      (scenario) =>
        scenario.status === "failed" &&
        scenario.executionState === "executed" &&
        scenario.evidenceStatus === "available" &&
        scenario.steps.some((step) => step.status === "failed"),
    )
  )
    return false;
  if (report.status === "passed") {
    const scenario = report.scenarios[0];
    const owned = cleanup.scenarios[0];
    if (
      !scenario ||
      !owned ||
      scenario.status !== "passed" ||
      scenario.executionState !== "executed" ||
      scenario.evidenceStatus !== "available" ||
      scenario.steps.some(
        (step) => step.status !== "passed" || step.reason !== undefined,
      ) ||
      scenario.cleanupStatus !== "confirmed" ||
      !owned.workerStopped ||
      owned.cleanupFailures.length !== 0 ||
      result.lifecycle.resourceCleanup.status !== "confirmed" ||
      result.lifecycle.resourceCleanup.failures.length !== 0 ||
      result.lifecycle.resourceCleanup.browserProcessStopped !== true
    )
      return false;
  }
  return true;
}

export async function executeOwnedLocalAdapter(
  input: unknown,
  trustedContext: unknown,
  signal?: AbortSignal,
  beforeBrowserAcquire?: () => Promise<void>,
): Promise<OwnedLocalResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return reject("INVALID_REQUEST");
  if (typeof beforeBrowserAcquire !== "function")
    return reject("INVALID_CONTEXT");
  const owner = contextSchema.safeParse(trustedContext);
  if (
    !owner.success ||
    !owner.data.approval.active ||
    owner.data.approval.expiresAt <= Date.now() ||
    !isDeepStrictEqual(parsed.data, owner.data.request)
  )
    return reject("INVALID_CONTEXT");
  const request = parsed.data;
  try {
    const review = await getOwnedLocalReview();
    if (
      !isDeepStrictEqual(request.approval, review.approval) ||
      !isDeepStrictEqual(request.inputs, review.inputs) ||
      request.binding.implementationRevision !==
        review.approval.implementationRevision
    )
      return reject("STALE_REVIEW");
  } catch {
    return reject("STALE_REVIEW");
  }
  if (owner.data.approval.expiresAt <= Date.now())
    return reject("INVALID_CONTEXT");
  let summary: ExecutionSummary;
  let authorizationDenied = false;
  try {
    summary = await executeReviewedScenarios({
      ...request.limits,
      scenarioIds: request.scenarioIds,
      ownedLocalTarget: { origin: request.target.origin },
      browserExecutablePath: owner.data.browserExecutablePath,
      authorizationExpiresAt: owner.data.approval.expiresAt,
      beforeBrowserAcquire: async () => {
        try {
          await beforeBrowserAcquire();
        } catch {
          authorizationDenied = true;
          throw new Error("Execution approval unavailable");
        }
      },
      signal,
    });
  } catch {
    summary = {
      diagnosticReference: randomUUID(),
      status: "incomplete",
      resourceCleanup: {
        status: "unknown",
        failures: ["execution-evidence-unavailable"],
        browserProcessStopped: null,
        blockedTargetRequestCount: 0,
        injectedPendingCleanup: false,
      },
      dataRestoration: { status: "unknown", operationPerformed: false },
      scenarios: [],
      attempts: [],
      attemptCount: 0,
    };
  }
  if (authorizationDenied) return reject("INVALID_CONTEXT");
  // Operational failure without a failed business step cannot establish a
  // business failure. Preserve the underlying scenarios and cleanup verbatim.
  if (
    summary.status === "failed" &&
    !summary.scenarios.some((scenario) =>
      scenario.cucumber?.steps.some((step) => step.status === "failed"),
    )
  ) {
    summary = {
      ...summary,
      status: "incomplete",
      attempts: summary.attempts.map((attempt) => ({
        ...attempt,
        status: "incomplete",
      })),
    };
  }
  const result = {
    version: 2 as const,
    accepted: true as const,
    run: request.run,
    target: request.target,
    binding: request.binding,
    callerId: owner.data.callerId,
    approval: request.approval,
    inputs: request.inputs,
    report: createExecutionReport(summary),
    lifecycle: {
      ...adapterLifecycle(summary),
      attempts: summary.attempts.map((attempt) => ({
        ...adapterLifecycle(attempt),
        attemptNumber: attempt.attemptNumber,
        diagnosticReference: attempt.diagnosticReference,
        scenarios: attempt.scenarios.map((scenario) => ({
          scenarioId: scenario.scenarioId,
          cleanupStatus: scenario.cleanupStatus,
          cleanupFailures: [...scenario.cleanupFailures],
          workerStopped: scenario.workerStopped,
        })),
      })),
    },
  };
  if (!validateOwnedLocalEvidence(request, result))
    throw new Error("Owned local evidence unavailable");
  return result;
}
