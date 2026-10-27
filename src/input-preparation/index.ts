import { z } from "zod";
import {
  selectApprovedScenarios,
  type ScenarioApproval,
  type ScenarioSelectionFilters,
} from "../validation/scenario-selector";
import type { FeatureValidation } from "../validation/feature-validator";

export const MAX_INPUT_DOCUMENT_BYTES = 64 * 1024;
export const MAX_PREPARED_SCENARIOS = 100;

const approvedFixtureFields = new Set([
  "displayName",
  "genres",
  "action",
  "expectedOutcome",
]);
const identifierSchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const revisionSchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const scenarioIdSchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
const fixtureValueSchema = z.union([
  z.string().max(512),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(512)).max(25),
]);
const fixtureValuesSchema = z
  .record(
    z
      .string()
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    fixtureValueSchema,
  )
  .superRefine((values, context) => {
    const entries = Object.entries(values);
    if (entries.length === 0 || entries.length > 32) {
      context.addIssue({
        code: "custom",
        message: "Fixture fields are missing or exceed the limit",
      });
    }
    for (const [field] of entries) {
      if (!approvedFixtureFields.has(field)) {
        context.addIssue({
          code: "custom",
          message: "Fixture contains an unapproved field",
        });
      }
    }
  });
const environmentSchema = z
  .object({
    id: identifierSchema,
    revision: revisionSchema,
    approvedOrigin: z.string().min(1).max(2_048),
    initialTargetUrl: z.string().min(1).max(2_048),
  })
  .strict();
const accountSchema = z
  .object({
    reference: identifierSchema,
    secretReference: identifierSchema,
  })
  .strict();
const cleanupSchema = z
  .object({
    reference: identifierSchema,
    authorizationRevision: revisionSchema,
    authorized: z.literal(true),
  })
  .strict();
const scenarioInputSchema = z
  .object({
    id: scenarioIdSchema,
    values: fixtureValuesSchema,
    accountReference: z.string().max(128),
    cleanup: cleanupSchema,
  })
  .strict();
const fixtureRevisionSchema = z
  .object({
    version: z.literal(1),
    fixtureRevision: revisionSchema,
    environment: environmentSchema,
    accounts: z.array(accountSchema).max(MAX_PREPARED_SCENARIOS),
    scenarios: z.array(scenarioInputSchema).max(MAX_PREPARED_SCENARIOS),
  })
  .strict();

export type CleanupOutcome = "restored" | "unrestored" | "unknown";

export interface SecretReference {
  readonly id: string;
}

export interface RuntimeSecretProvider {
  resolve(reference: SecretReference): Promise<string>;
}

export interface PreparedScenarioInputs {
  readonly id: string;
  readonly tags: readonly string[];
  readonly values: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
  readonly account: {
    readonly reference: string;
    readonly secretReference: SecretReference;
  };
  readonly cleanup: {
    readonly required: true;
    readonly reference: string;
    readonly authorizationRevision: string;
    readonly authorized: true;
    readonly outcome: CleanupOutcome;
  };
}

export interface PreparedInputDescriptor {
  readonly version: 1;
  readonly environment: {
    readonly id: string;
    readonly revision: string;
    readonly approvedOrigin: string;
    readonly initialTargetUrl: string;
  };
  readonly review: {
    readonly sourceRevision: string;
    readonly featureRevision: string;
    readonly implementationRevision: string;
  };
  readonly fixtureRevision: string;
  readonly scenarios: readonly PreparedScenarioInputs[];
}

export type InputPreparationErrorCode =
  | "invalid-json"
  | "input-too-large"
  | "invalid-environment"
  | "target-outside-approved-origin"
  | "invalid-scenario-data"
  | "invalid-account-reference"
  | "invalid-selection";

export class InputPreparationError extends Error {
  constructor(
    readonly code: InputPreparationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InputPreparationError";
  }
}

function fail(code: InputPreparationErrorCode, message: string): never {
  throw new InputPreparationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOrigin(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function copyValues(
  values: Record<string, string | number | boolean | string[]>,
): Readonly<Record<string, string | number | boolean | readonly string[]>> {
  return Object.fromEntries(
    Object.entries(values).map(([field, value]) => [
      field,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

export function prepareScenarioInputs(
  inputJson: string,
  validation: FeatureValidation,
  approval: ScenarioApproval,
  filters: ScenarioSelectionFilters = {},
): PreparedInputDescriptor {
  if (typeof inputJson !== "string") {
    return fail("invalid-json", "Input must be valid JSON text");
  }
  if (Buffer.byteLength(inputJson, "utf8") > MAX_INPUT_DOCUMENT_BYTES) {
    return fail("input-too-large", "Input document exceeds the 64 KiB limit");
  }

  let document: unknown;
  try {
    document = JSON.parse(inputJson) as unknown;
  } catch {
    return fail("invalid-json", "Input document is malformed JSON");
  }
  if (!isRecord(document)) {
    return fail(
      "invalid-scenario-data",
      "Scenario fixture fields or account references are missing or invalid",
    );
  }

  const environmentResult = environmentSchema.safeParse(document.environment);
  if (!environmentResult.success) {
    return fail(
      "invalid-environment",
      "Approved environment settings are missing or invalid",
    );
  }
  const origin = parseOrigin(environmentResult.data.approvedOrigin);
  if (!origin) {
    return fail(
      "invalid-environment",
      "Approved environment origin must be an HTTP(S) origin",
    );
  }
  let target: URL | undefined;
  try {
    target = new URL(environmentResult.data.initialTargetUrl);
  } catch {
    target = undefined;
  }
  if (
    !target ||
    !["http:", "https:"].includes(target.protocol) ||
    target.origin !== origin.origin ||
    target.username !== "" ||
    target.password !== "" ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    return fail(
      "target-outside-approved-origin",
      "Initial target must be an HTTP(S) URL on the approved origin without query or fragment",
    );
  }

  const fixtureResult = fixtureRevisionSchema.safeParse(document);
  if (!fixtureResult.success) {
    return fail(
      "invalid-scenario-data",
      "Scenario fixture fields or account references are missing or invalid",
    );
  }

  const selection = selectApprovedScenarios(validation, approval, filters);
  if (!validation.valid) {
    return fail(
      "invalid-selection",
      "Input preparation requires a valid, bounded approved scenario selection",
    );
  }
  if (
    !selection.runnable ||
    selection.scenarios.length > MAX_PREPARED_SCENARIOS
  ) {
    return fail(
      "invalid-selection",
      "Input preparation requires a valid, bounded approved scenario selection",
    );
  }

  const selectedIds = selection.scenarios.map((scenario) => scenario.id);
  if (selectedIds.some((id) => id === null)) {
    return fail(
      "invalid-selection",
      "Approved scenarios require stable identifiers",
    );
  }
  const selectedIdSet = new Set(selectedIds as string[]);
  const scenarioInputs = fixtureResult.data.scenarios;
  if (
    scenarioInputs.length !== selectedIds.length ||
    new Set(scenarioInputs.map((scenario) => scenario.id)).size !==
      scenarioInputs.length ||
    scenarioInputs.some((scenario) => !selectedIdSet.has(scenario.id))
  ) {
    return fail(
      "invalid-scenario-data",
      "Scenario fixture data must exactly match the approved selection",
    );
  }

  const accounts = new Map(
    fixtureResult.data.accounts.map((account) => [account.reference, account]),
  );
  if (accounts.size !== fixtureResult.data.accounts.length) {
    return fail(
      "invalid-account-reference",
      "Account references must be valid and unique",
    );
  }

  const usedAccountReferences = new Set<string>();
  const preparedScenarios = selection.scenarios.map((scenario) => {
    const fixture = scenarioInputs.find(
      (candidate) => candidate.id === scenario.id,
    );
    if (!fixture) {
      return fail(
        "invalid-scenario-data",
        "Scenario fixture data must exactly match the approved selection",
      );
    }
    const account = accounts.get(fixture.accountReference);
    if (
      !account ||
      !identifierSchema.safeParse(fixture.accountReference).success ||
      usedAccountReferences.has(fixture.accountReference)
    ) {
      return fail(
        "invalid-account-reference",
        "Each approved scenario requires its own valid account reference",
      );
    }
    usedAccountReferences.add(fixture.accountReference);
    return {
      id: scenario.id as string,
      tags: [...scenario.tags],
      values: copyValues(fixture.values),
      account: {
        reference: account.reference,
        secretReference: { id: account.secretReference },
      },
      cleanup: {
        required: true as const,
        reference: fixture.cleanup.reference,
        authorizationRevision: fixture.cleanup.authorizationRevision,
        authorized: true as const,
        outcome: "unknown" as const,
      },
    };
  });

  if (
    !revisionSchema.safeParse(validation.sourceRevision).success ||
    !revisionSchema.safeParse(validation.featureRevision).success ||
    !revisionSchema.safeParse(validation.implementationRevision).success
  ) {
    return fail(
      "invalid-selection",
      "Reviewed scenario revisions must be safe identifiers",
    );
  }

  return {
    version: 1,
    environment: {
      id: environmentResult.data.id,
      revision: environmentResult.data.revision,
      approvedOrigin: origin.origin,
      initialTargetUrl: target.href,
    },
    review: {
      sourceRevision: validation.sourceRevision,
      featureRevision: validation.featureRevision,
      implementationRevision: validation.implementationRevision,
    },
    fixtureRevision: fixtureResult.data.fixtureRevision,
    scenarios: preparedScenarios,
  };
}
