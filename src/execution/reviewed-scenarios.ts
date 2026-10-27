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
export const INPUT_FIXTURE_PATH = "fixtures/execution/approved-inputs.json";

const REVIEWED_SOURCE_REVISION = "rrdweb4-synthetic-source-1";
const REVIEWED_FEATURE_REVISION =
  "c916c0e7ad8efab755c669578827870c5fdfb48e53536362715d7dfdfcc31268";
const REVIEWED_IMPLEMENTATION_REVISION =
  "039be36fbd9b903fc9baf9b751df3da70beb2914772c48222a9b4dc745d86afa";

const stepManifest: ReviewedStepManifest = {
  implementationRevision: REVIEWED_IMPLEMENTATION_REVISION,
  steps: [
    {
      id: "open-synthetic-page",
      expression: "the synthetic reviewed page is open",
    },
    {
      id: "enter-prepared-name",
      expression: "I enter the prepared display name",
    },
    {
      id: "confirm-prepared-name",
      expression: "the synthetic page confirms the prepared display name",
    },
    { id: "confirm-status", expression: "the synthetic status says {string}" },
    {
      id: "retry-status",
      expression: "the synthetic status matches its retry attempt",
    },
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

function approveScenario(id: string, acceptanceTag: string) {
  return {
    id,
    tags: [
      "@web-safe-execution",
      `@scenario-id=${id}`,
      `@web-safe-execution-${acceptanceTag}`,
    ],
  };
}

const reviewedApproval: ScenarioApproval = {
  featurePath: REVIEWED_FEATURE_PATH,
  sourceRevision: REVIEWED_SOURCE_REVISION,
  featureRevision: REVIEWED_FEATURE_REVISION,
  implementationRevision: REVIEWED_IMPLEMENTATION_REVISION,
  scenarios: [
    approveScenario("browser-flow", "S01"),
    approveScenario("retry-assertion-flow", "S03"),
    approveScenario("assertion-failure", "S02"),
    approveScenario("pending-flow", "S02"),
    approveScenario("undefined-flow", "S02"),
    approveScenario("timeout-flow", "S03"),
    approveScenario("redirect-flow", "S03"),
  ],
};

export const reviewedFixturePolicy: ReviewedFixtureFieldPolicy = {
  version: 1,
  id: "rrdweb4-synthetic-fixtures",
  revision: "synthetic-field-policy-1",
  sharedFields: {},
  scenarioFields: {
    "browser-flow": { displayName: { type: "string", maxLength: 64 } },
    "retry-assertion-flow": { displayName: { type: "string", maxLength: 64 } },
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
    "cucumber-execution.json",
    "tsconfig.cucumber.json",
    "package.json",
    "package-lock.json",
    "src/execution/index.ts",
    "features/execution/steps.ts",
    "features/execution/support/hooks.ts",
    "features/execution/support/world.ts",
    "features/support/step-timeout.ts",
    "src/input-preparation/index.ts",
    "src/validation/feature-validator.ts",
    "src/validation/scenario-selector.ts",
    "dist/cucumber/src/execution/index.js",
    "dist/cucumber/src/execution/cli.js",
    "dist/cucumber/src/execution/reviewed-scenarios.js",
    "dist/cucumber/src/input-preparation/index.js",
    "dist/cucumber/src/validation/feature-validator.js",
    "dist/cucumber/src/validation/scenario-selector.js",
    "dist/cucumber/features/execution/steps.js",
    "dist/cucumber/features/execution/support/hooks.js",
    "dist/cucumber/features/execution/support/world.js",
    "dist/cucumber/features/support/step-timeout.js",
    "node_modules/@cucumber/cucumber/package.json",
    "node_modules/@playwright/test/package.json",
    "node_modules/playwright/package.json",
    "node_modules/playwright-core/package.json",
  ]) {
    hash.update(relativePath).update("\0");
    const bytes = readFileSync(path.join(REPOSITORY_ROOT, relativePath));
    const normalized =
      relativePath === "dist/cucumber/src/execution/reviewed-scenarios.js"
        ? bytes
            .toString("utf8")
            .replace(REVIEWED_IMPLEMENTATION_REVISION, "<PINNED-REVISION>")
        : bytes;
    hash.update(normalized).update("\0");
  }
  hash.update(JSON.stringify(stepManifest.steps)).update("\0");
  hash.update(JSON.stringify(reviewedFixturePolicy)).update("\0");
  hash.update(readFileSync(path.join(REPOSITORY_ROOT, INPUT_FIXTURE_PATH)));
  return hash.digest("hex");
}

function dependenciesMatchLockfile(): boolean {
  try {
    const lock = JSON.parse(
      readFileSync(path.join(REPOSITORY_ROOT, "package-lock.json"), "utf8"),
    ) as { packages?: Record<string, { version?: string }> };
    return [
      "@cucumber/cucumber",
      "@playwright/test",
      "playwright",
      "playwright-core",
    ].every((name) => {
      const location = `node_modules/${name}`;
      const lockedVersion = lock.packages?.[location]?.version;
      const installed = JSON.parse(
        readFileSync(
          path.join(REPOSITORY_ROOT, location, "package.json"),
          "utf8",
        ),
      ) as { version?: string };
      return (
        typeof lockedVersion === "string" && installed.version === lockedVersion
      );
    });
  } catch {
    return false;
  }
}

export async function loadReviewedScenarios(): Promise<{
  readonly approval: ScenarioApproval;
  readonly validation: Awaited<ReturnType<typeof validateFeatureFile>>;
}> {
  if (
    !dependenciesMatchLockfile() ||
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
  return { approval: reviewedApproval, validation };
}
