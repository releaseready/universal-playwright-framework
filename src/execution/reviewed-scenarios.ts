import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  validateFeatureFile,
  type ReviewedStepManifest,
} from "../validation/feature-validator";
import type { ScenarioApproval } from "../validation/scenario-selector";
import type { ReviewedFixtureFieldPolicy } from "../input-preparation";

export const REPOSITORY_ROOT = path.resolve(__dirname, "../../../..");
export const REVIEWED_FEATURE_PATH =
  "fixtures/execution/reviewed-scenarios.feature";
export const INPUT_FIXTURE_PATH =
  "fixtures/execution/approved-inputs.json";

const REVIEWED_SOURCE_REVISION = "rrdweb4-synthetic-source-1";
const REVIEWED_FEATURE_REVISION = "TO_BE_PINNED";
const REVIEWED_IMPLEMENTATION_REVISION = "TO_BE_PINNED";

const stepManifest: ReviewedStepManifest = {
  implementationRevision: REVIEWED_IMPLEMENTATION_REVISION,
  steps: [
    { id: "open-synthetic-page", expression: "the synthetic reviewed page is open" },
    { id: "enter-prepared-name", expression: "I enter the prepared display name" },
    {
      id: "confirm-prepared-name",
      expression: "the synthetic page confirms the prepared display name",
    },
    { id: "confirm-status", expression: "the synthetic status says {string}" },
    { id: "pending-step", expression: "the scenario is explicitly pending" },
    { id: "bounded-wait", expression: "I wait for {int} milliseconds" },
    {
      id: "unapproved-redirect",
      expression: "I follow a redirect to an unapproved target",
    },
    {
      id: "blocked-navigation",
      expression: "the unapproved navigation was blocked",
    },
  ],
};

export const reviewedFixturePolicy: ReviewedFixtureFieldPolicy = {
  version: 1,
  id: "rrdweb4-synthetic-fixtures",
  revision: "synthetic-field-policy-1",
  sharedFields: {},
  scenarioFields: {
    "browser-flow": { displayName: { type: "string", maxLength: 64 } },
    "assertion-failure": { displayName: { type: "string", maxLength: 64 } },
    "pending-flow": { displayName: { type: "string", maxLength: 64 } },
    "undefined-flow": { displayName: { type: "string", maxLength: 64 } },
    "timeout-flow": { displayName: { type: "string", maxLength: 64 } },
    "redirect-flow": { displayName: { type: "string", maxLength: 64 } },
  },
};

function hashFile(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(REPOSITORY_ROOT, relativePath)))
    .digest("hex");
}

function hashImplementation(): string {
  const hash = createHash("sha256");
  for (const relativePath of [
    "features/execution/steps.ts",
    "features/execution/support/hooks.ts",
  ]) {
    hash.update(readFileSync(path.join(REPOSITORY_ROOT, relativePath)));
  }
  return hash.digest("hex");
}

export async function loadReviewedScenarios(): Promise<{
  readonly approval: ScenarioApproval;
  readonly validation: Awaited<ReturnType<typeof validateFeatureFile>>;
}> {
  if (
    hashFile(REVIEWED_FEATURE_PATH) !== REVIEWED_FEATURE_REVISION ||
    hashImplementation() !== REVIEWED_IMPLEMENTATION_REVISION
  ) {
    throw new Error("Pinned synthetic scenario review is stale");
  }
  const validation = await validateFeatureFile({
    workspaceRoot: REPOSITORY_ROOT,
    featurePath: REVIEWED_FEATURE_PATH,
    sourceRevision: REVIEWED_SOURCE_REVISION,
    manifest: stepManifest,
  });
  if (
    !validation.valid ||
    validation.featureRevision !== REVIEWED_FEATURE_REVISION
  ) {
    throw new Error("Pinned synthetic scenarios could not be validated");
  }
  const approval: ScenarioApproval = {
    featurePath: REVIEWED_FEATURE_PATH,
    sourceRevision: REVIEWED_SOURCE_REVISION,
    featureRevision: REVIEWED_FEATURE_REVISION,
    implementationRevision: REVIEWED_IMPLEMENTATION_REVISION,
    scenarios: validation.scenarios.flatMap((scenario) =>
      scenario.id === null
        ? []
        : [{ id: scenario.id, tags: [...scenario.tags] }],
    ),
  };
  return { approval, validation };
}
