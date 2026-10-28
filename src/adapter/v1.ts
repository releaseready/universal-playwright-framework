import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  executeReviewedScenarios,
  makeFixtureInput,
  type ExecutionSummary,
  type ResourceCleanupStatus,
} from "../execution";
import {
  loadReviewedScenarios,
  reviewedFixturePolicy,
} from "../execution/reviewed-scenarios";
import { prepareScenarioInputs } from "../input-preparation";
import { createExecutionReport, type ExecutionReport } from "../reporting";
import { selectApprovedScenarios } from "../validation/scenario-selector";

const reference = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const gitRevision = z.string().regex(/^[a-f0-9]{40}$/);
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
const scenarioIds = z
  .array(reference)
  .min(1)
  .max(6)
  .refine((ids) => new Set(ids).size === ids.length);
const requestSchema = z
  .object({
    version: z.literal(1),
    run: z.object({ id: reference, gitRevision }).strict(),
    target: z.literal("owned-synthetic"),
    scenarioIds,
    approval: approvalSchema,
    inputs: inputsSchema,
    limits: z
      .object({
        runTimeoutMs: z.number().int().min(50).max(120000),
        scenarioTimeoutMs: z.number().int().min(50).max(60000),
        maxConcurrentScenarios: z.number().int().min(1).max(2),
        retryCount: z.number().int().min(0).max(2),
      })
      .strict(),
  })
  .strict();
const contextSchema = z
  .object({
    version: z.literal(1),
    authorization: z.literal("owned-synthetic"),
    callerId: reference,
    runId: reference,
    gitRevision,
    allowedScenarioIds: z.array(reference).min(1).max(7),
    approval: approvalSchema,
    inputs: inputsSchema,
  })
  .strict();

export type AdapterRequest = z.infer<typeof requestSchema>;
export type TrustedAdapterContext = z.infer<typeof contextSchema>;

const messages = {
  INVALID_REQUEST:
    "Use the v1 owned-synthetic request and bounded limits; URLs, paths and extra fields are unsupported.",
  INVALID_CONTEXT:
    "The central owner must supply consistent authorized run, revision, scenario and input references.",
  STALE_REVIEW:
    "Use references from the reviewed package; restore or re-review changed runtime artifacts and fixed inputs.",
  UNSUPPORTED_SCENARIO:
    "Select only runnable scenarios in the owned synthetic approval registry.",
} as const;
export interface AdapterError {
  readonly code: keyof typeof messages;
  readonly message: (typeof messages)[keyof typeof messages];
}

type Lifecycle = {
  readonly resourceCleanup: Omit<
    ExecutionSummary["resourceCleanup"],
    "injectedPendingCleanup"
  >;
  readonly dataRestoration: ExecutionSummary["dataRestoration"];
};
export type AdapterResult =
  | {
      readonly version: 1;
      readonly accepted: false;
      readonly resourceAcquisition: "not_started";
      readonly error: AdapterError;
    }
  | {
      readonly version: 1;
      readonly accepted: true;
      readonly run: AdapterRequest["run"];
      readonly callerId: string;
      readonly target: "owned-synthetic";
      readonly approval: AdapterRequest["approval"];
      readonly inputs: AdapterRequest["inputs"];
      readonly report: ExecutionReport;
      readonly lifecycle: Lifecycle & {
        readonly attempts: readonly (Lifecycle & {
          readonly attemptNumber: number;
          readonly diagnosticReference: string;
          readonly scenarios: readonly {
            readonly scenarioId: string;
            readonly cleanupStatus: ResourceCleanupStatus;
            readonly cleanupFailures: readonly string[];
            readonly workerStopped: boolean;
          }[];
        })[];
      };
    };

function reject(code: AdapterError["code"]): AdapterResult {
  return {
    version: 1,
    accepted: false,
    resourceAcquisition: "not_started",
    error: { code, message: messages[code] },
  };
}

function sameReferences(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function lifecycle(
  summary: Lifecycle & {
    resourceCleanup: ExecutionSummary["resourceCleanup"];
  },
): Lifecycle {
  return {
    resourceCleanup: {
      status: summary.resourceCleanup.status,
      failures: [...summary.resourceCleanup.failures],
      browserProcessStopped: summary.resourceCleanup.browserProcessStopped,
      blockedTargetRequestCount:
        summary.resourceCleanup.blockedTargetRequestCount,
    },
    dataRestoration: { ...summary.dataRestoration },
  };
}

export async function executeAdapter(
  input: unknown,
  trustedContext: unknown,
  signal?: AbortSignal,
): Promise<AdapterResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return reject("INVALID_REQUEST");
  const owner = contextSchema.safeParse(trustedContext);
  if (!owner.success) return reject("INVALID_CONTEXT");
  const request = parsed.data;
  const context = owner.data;
  if (
    context.runId !== request.run.id ||
    context.gitRevision !== request.run.gitRevision ||
    !sameReferences(context.approval, request.approval) ||
    !sameReferences(context.inputs, request.inputs) ||
    request.scenarioIds.some((id) => !context.allowedScenarioIds.includes(id))
  )
    return reject("INVALID_CONTEXT");

  try {
    const { approval, validation } = await loadReviewedScenarios();
    if (
      !sameReferences(request.approval, {
        sourceRevision: approval.sourceRevision,
        featureRevision: approval.featureRevision,
        implementationRevision: approval.implementationRevision,
      })
    )
      return reject("STALE_REVIEW");
    const filters = { scenarioIds: request.scenarioIds };
    const selection = selectApprovedScenarios(validation, approval, filters);
    if (
      !selection.runnable ||
      selection.scenarios.length !== request.scenarioIds.length
    )
      return reject("UNSUPPORTED_SCENARIO");
    const descriptor = prepareScenarioInputs(
      makeFixtureInput(request.scenarioIds, "http://127.0.0.1"),
      validation,
      approval,
      reviewedFixturePolicy,
      filters,
    );
    if (
      !sameReferences(request.inputs, {
        fixtureRevision: descriptor.fixtureRevision,
        environmentRevision: descriptor.environment.revision,
        policyRevision: reviewedFixturePolicy.revision,
      })
    )
      return reject("STALE_REVIEW");
  } catch {
    return reject("STALE_REVIEW");
  }

  let summary: ExecutionSummary;
  try {
    summary = await executeReviewedScenarios({
      scenarioIds: request.scenarioIds,
      ...request.limits,
      signal,
    });
  } catch {
    // An unexpected engine failure provides no proof of completed cleanup.
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
  return {
    version: 1,
    accepted: true,
    run: request.run,
    callerId: context.callerId,
    target: request.target,
    approval: request.approval,
    inputs: request.inputs,
    report: createExecutionReport(summary),
    lifecycle: {
      ...lifecycle(summary),
      attempts: summary.attempts.map((attempt) => ({
        ...lifecycle(attempt),
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
}
