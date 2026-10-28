import { z } from "zod";
import {
  selectApprovedScenarios,
  type ScenarioApproval,
  type ScenarioSelectionFilters,
} from "../validation/scenario-selector";
import type { FeatureValidation } from "../validation/feature-validator";
import {
  verifyDataReferenceBinding,
  type ApprovedDataCatalogue,
  type DataReferenceSelection,
  type ReviewedDataReferences,
} from "./data-references";

export const MAX_INPUT_DOCUMENT_BYTES = 64 * 1024;
export const MAX_PREPARED_SCENARIOS = 100;

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
const fixtureValueContentSchema = z.union([
  z.string().max(512),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(512)).max(25),
]);
const fixtureValueSchema = z
  .object({
    classification: z.enum(["non-sensitive", "secret"]),
    value: fixtureValueContentSchema,
  })
  .strict();
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
  });
const fixtureFieldNameSchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/);
const fixtureFieldSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("string"),
      maxLength: z.number().int().min(1).max(512),
    })
    .strict(),
  z
    .object({
      type: z.literal("string-list"),
      maxItems: z.number().int().min(1).max(25),
      maxLength: z.number().int().min(1).max(512),
    })
    .strict(),
  z.object({ type: z.literal("number") }).strict(),
  z.object({ type: z.literal("boolean") }).strict(),
]);
const fixtureFieldMapSchema = z
  .record(fixtureFieldNameSchema, fixtureFieldSchema)
  .superRefine((fields, context) => {
    if (Object.keys(fields).length > 32) {
      context.addIssue({
        code: "custom",
        message: "Fixture field limit exceeded",
      });
    }
  });
const fixturePolicySchema = z
  .object({
    version: z.literal(1),
    id: identifierSchema,
    revision: revisionSchema,
    sharedFields: fixtureFieldMapSchema,
    scenarioFields: z.record(scenarioIdSchema, fixtureFieldMapSchema),
  })
  .strict()
  .superRefine((policy, context) => {
    if (Object.keys(policy.scenarioFields).length > MAX_PREPARED_SCENARIOS) {
      context.addIssue({
        code: "custom",
        message: "Scenario fixture policy limit exceeded",
      });
    }
    const sharedNames = Object.keys(policy.sharedFields);
    for (const fields of Object.values(policy.scenarioFields)) {
      const fieldNames = Object.keys(fields);
      if (fieldNames.length + sharedNames.length > 32) {
        context.addIssue({
          code: "custom",
          message: "Scenario fixture field limit exceeded",
        });
      }
      if (fieldNames.some((name) => sharedNames.includes(name))) {
        context.addIssue({
          code: "custom",
          message: "Shared fixture fields cannot be redeclared",
        });
      }
    }

    const allFieldNames = [...sharedNames];
    for (const fields of Object.values(policy.scenarioFields)) {
      allFieldNames.push(...Object.keys(fields));
    }
    const credentialName =
      /password|passwd|passcode|secret|token|credential|authorization|cookie|apikey|accesskey|privatekey/;
    if (
      allFieldNames.some((name) =>
        credentialName.test(name.replace(/[^A-Za-z0-9]/g, "").toLowerCase()),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Credential fields cannot be fixture data",
      });
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
const environmentReferenceSchema = z
  .object({
    id: identifierSchema,
    revision: revisionSchema,
    approvedOrigin: z.string().min(1).max(2_048),
  })
  .strict();
const dataReferencePreparationSchema = z
  .object({
    selection: z.unknown(),
    approvedCatalogue: z.unknown(),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    approvedEnvironment: environmentReferenceSchema,
  })
  .strict();
const accountSchema = z
  .object({
    reference: identifierSchema,
    secretReference: identifierSchema,
  })
  .strict();
const fixtureDataReferenceSchema = z
  .object({
    dataset: z
      .object({ id: scenarioIdSchema, revision: scenarioIdSchema })
      .strict(),
    rowId: scenarioIdSchema,
    secret: z
      .object({ id: scenarioIdSchema, revision: scenarioIdSchema })
      .strict()
      .optional(),
  })
  .strict();
const cleanupSchema = z
  .object({
    reference: identifierSchema,
    authorizationRevision: revisionSchema,
    requested: z.literal(true),
  })
  .strict();
const scenarioInputSchema = z
  .object({
    id: scenarioIdSchema,
    values: fixtureValuesSchema,
    dataReference: fixtureDataReferenceSchema.optional(),
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

export type ReviewedFixtureFieldSchema =
  | { readonly type: "string"; readonly maxLength: number }
  | {
      readonly type: "string-list";
      readonly maxItems: number;
      readonly maxLength: number;
    }
  | { readonly type: "number" }
  | { readonly type: "boolean" };

export interface ReviewedFixtureFieldPolicy {
  readonly version: 1;
  readonly id: string;
  readonly revision: string;
  readonly sharedFields: Readonly<Record<string, ReviewedFixtureFieldSchema>>;
  readonly scenarioFields: Readonly<
    Record<string, Readonly<Record<string, ReviewedFixtureFieldSchema>>>
  >;
}

export interface SecretReference {
  readonly id: string;
  readonly revision?: string;
  readonly field?: "username" | "password";
}

export interface RuntimeSecretScope {
  readonly projectId: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly dataBinding: string;
  readonly environment: {
    readonly id: string;
    readonly revision: string;
    readonly approvedOrigin: string;
  };
}

export interface RuntimeSecretProvider {
  resolve(
    reference: SecretReference,
    scope?: RuntimeSecretScope,
  ): Promise<string>;
  dispose?(): void;
}

export interface PreparedScenarioInputs {
  readonly id: string;
  readonly tags: readonly string[];
  readonly dataReference?: DataReferenceSelection["rows"][number];
  readonly values: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
  readonly account: {
    readonly reference: string;
    readonly secretReference: SecretReference;
  };
  readonly cleanup: {
    readonly requested: true;
    readonly authorizationStatus: "unverified";
    readonly reference: string;
    readonly requestedRevision: string;
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
  readonly fixturePolicy: {
    readonly id: string;
    readonly revision: string;
  };
  readonly fixtureRevision: string;
  readonly dataReferences?: ReviewedDataReferences;
  readonly scenarios: readonly PreparedScenarioInputs[];
}

export interface ReviewedDataReferenceInput {
  readonly selection: DataReferenceSelection;
  readonly approvedCatalogue: ApprovedDataCatalogue;
  readonly binding: string;
  readonly approvedEnvironment: {
    readonly id: string;
    readonly revision: string;
    readonly approvedOrigin: string;
  };
}

export type InputPreparationErrorCode =
  | "invalid-json"
  | "input-too-large"
  | "invalid-environment"
  | "target-outside-approved-origin"
  | "invalid-scenario-data"
  | "invalid-account-reference"
  | "invalid-selection"
  | "invalid-fixture-policy"
  | "invalid-data-reference";

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
  values: Record<
    string,
    {
      classification: "non-sensitive" | "secret";
      value: string | number | boolean | string[];
    }
  >,
): Readonly<Record<string, string | number | boolean | readonly string[]>> {
  return Object.fromEntries(
    Object.entries(values).map(([field, fixtureValue]) => [
      field,
      Array.isArray(fixtureValue.value)
        ? [...fixtureValue.value]
        : fixtureValue.value,
    ]),
  );
}

function fixtureValueMatches(
  value: string | number | boolean | string[],
  schema: ReviewedFixtureFieldSchema,
): boolean {
  switch (schema.type) {
    case "string":
      return typeof value === "string" && value.length <= schema.maxLength;
    case "string-list":
      return (
        Array.isArray(value) &&
        value.length <= schema.maxItems &&
        value.every(
          (item) => typeof item === "string" && item.length <= schema.maxLength,
        )
      );
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

function fixtureFieldsMatchPolicy(
  values: Record<
    string,
    {
      classification: "non-sensitive" | "secret";
      value: string | number | boolean | string[];
    }
  >,
  policy: ReviewedFixtureFieldPolicy,
  scenarioId: string,
): boolean {
  const fieldPolicy = {
    ...policy.sharedFields,
    ...policy.scenarioFields[scenarioId],
  };
  const fixtureNames = Object.keys(values).sort();
  const policyNames = Object.keys(fieldPolicy).sort();
  return (
    fixtureNames.length === policyNames.length &&
    fixtureNames.every((name, index) => {
      const fixtureValue = values[name];
      const fieldSchema = fieldPolicy[name];
      return (
        name === policyNames[index] &&
        fixtureValue.classification === "non-sensitive" &&
        fixtureValueMatches(fixtureValue.value, fieldSchema)
      );
    })
  );
}

export function prepareScenarioInputs(
  inputJson: string,
  validation: FeatureValidation,
  approval: ScenarioApproval,
  fixturePolicyInput: ReviewedFixtureFieldPolicy,
  filters: ScenarioSelectionFilters = {},
  dataReferenceInput?: ReviewedDataReferenceInput,
): PreparedInputDescriptor {
  const fixturePolicyResult = fixturePolicySchema.safeParse(fixturePolicyInput);
  if (!fixturePolicyResult.success) {
    return fail(
      "invalid-fixture-policy",
      "Reviewed fixture field policy is missing or invalid",
    );
  }

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
  let reviewedDataReferences: ReviewedDataReferences | undefined;
  if (dataReferenceInput !== undefined) {
    const dataReferenceResult =
      dataReferencePreparationSchema.safeParse(dataReferenceInput);
    if (!dataReferenceResult.success) {
      return fail(
        "invalid-data-reference",
        "Reviewed data references are missing or invalid",
      );
    }
    const reviewedOrigin = parseOrigin(
      dataReferenceResult.data.approvedEnvironment.approvedOrigin,
    );
    if (
      dataReferenceResult.data.approvedEnvironment.id !==
        environmentResult.data.id ||
      dataReferenceResult.data.approvedEnvironment.revision !==
        environmentResult.data.revision ||
      !reviewedOrigin ||
      reviewedOrigin.origin !== origin.origin
    ) {
      return fail(
        "invalid-environment",
        "Selected environment does not match the reviewed environment",
      );
    }
    try {
      reviewedDataReferences = verifyDataReferenceBinding(
        dataReferenceResult.data.selection,
        dataReferenceResult.data.approvedCatalogue,
        dataReferenceResult.data.binding,
      );
    } catch (error) {
      const message =
        error instanceof Error &&
        error.message ===
          "Data reference review is stale; review the selected data again"
          ? error.message
          : "Data references are missing, invalid or unapproved";
      return fail("invalid-data-reference", message);
    }
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
  if (
    reviewedDataReferences &&
    (reviewedDataReferences.rows.length !== selectedIds.length ||
      reviewedDataReferences.rows.some(
        (row) => !selectedIdSet.has(row.scenarioId),
      ))
  ) {
    return fail(
      "invalid-data-reference",
      "Data references must exactly match the approved scenario selection",
    );
  }
  const scenarioInputs = fixtureResult.data.scenarios;
  if (
    !reviewedDataReferences &&
    scenarioInputs.some((scenario) => scenario.dataReference !== undefined)
  ) {
    return fail(
      "invalid-data-reference",
      "Fixture data references require an approved data reference review",
    );
  }
  if (
    reviewedDataReferences &&
    reviewedDataReferences.rows.some((reference) => {
      const fixture = scenarioInputs.find(
        (scenario) => scenario.id === reference.scenarioId,
      );
      return (
        !fixture?.dataReference ||
        fixture.dataReference.rowId !== reference.rowId ||
        fixture.dataReference.dataset.id !== reference.dataset.id ||
        fixture.dataReference.dataset.revision !== reference.dataset.revision ||
        fixture.dataReference.secret?.id !== reference.secret?.id ||
        fixture.dataReference.secret?.revision !== reference.secret?.revision
      );
    })
  ) {
    return fail(
      "invalid-data-reference",
      "Fixture rows do not match the reviewed dataset references",
    );
  }
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
  const fixturePolicy = fixturePolicyResult.data as ReviewedFixtureFieldPolicy;
  if (
    selectedIds.some((id) => {
      const scenario = scenarioInputs.find((candidate) => candidate.id === id);
      return (
        !scenario ||
        !fixtureFieldsMatchPolicy(scenario.values, fixturePolicy, id ?? "")
      );
    })
  ) {
    return fail(
      "invalid-scenario-data",
      "Scenario fixture fields do not match the reviewed field policy",
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
    const dataReference = reviewedDataReferences?.rows.find(
      (reference) => reference.scenarioId === scenario.id,
    );
    if (reviewedDataReferences && !dataReference) {
      return fail(
        "invalid-data-reference",
        "Data references must exactly match the approved scenario selection",
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
      ...(dataReference ? { dataReference } : {}),
      values: copyValues(fixture.values),
      account: {
        reference: account.reference,
        secretReference: { id: account.secretReference },
      },
      cleanup: {
        requested: true as const,
        authorizationStatus: "unverified" as const,
        reference: fixture.cleanup.reference,
        requestedRevision: fixture.cleanup.authorizationRevision,
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
    fixturePolicy: {
      id: fixturePolicy.id,
      revision: fixturePolicy.revision,
    },
    fixtureRevision: fixtureResult.data.fixtureRevision,
    ...(reviewedDataReferences
      ? { dataReferences: reviewedDataReferences }
      : {}),
    scenarios: preparedScenarios,
  };
}
