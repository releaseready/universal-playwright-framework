import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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

export const REVIEWED_SOURCE_REVISION = "rrdweb4-synthetic-source-1";
export const REVIEWED_FEATURE_REVISION =
  "c916c0e7ad8efab755c669578827870c5fdfb48e53536362715d7dfdfcc31268";
export const REVIEWED_IMPLEMENTATION_REVISION =
  "7014f60ccc112f36ea2701822420a790ee3eae7d9900cdad090f43cd0993f808";

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

const RUNTIME_DEPENDENCIES = [
  "@cucumber/cucumber",
  "@cucumber/cucumber-expressions",
  "@cucumber/gherkin",
  "@playwright/test",
  "playwright",
  "playwright-core",
  "zod",
] as const;

export function runtimePackagePath(name: string): string {
  let directory = path.dirname(
    require.resolve(name, { paths: [REPOSITORY_ROOT] }),
  );
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, "package.json");
    if (existsSync(manifest)) {
      const identity = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (identity.name === name && typeof identity.version === "string")
        return manifest;
    }
    directory = path.dirname(directory);
  }
  throw new Error("Reviewed runtime package manifest is unavailable");
}

export function calculateReviewedImplementationRevision(): string {
  const hash = createHash("sha256");
  for (const relativePath of [
    "cucumber-execution.json",
    "tsconfig.cucumber.json",
    "package.json",
    "src/adapter/v1.ts",
    "dist/cucumber/src/adapter/v1.js",
    "src/execution/index.ts",
    "src/reporting/index.ts",
    "src/reporting/output.ts",
    "features/execution/steps.ts",
    "features/execution/support/hooks.ts",
    "features/execution/support/world.ts",
    "features/support/step-timeout.ts",
    "src/input-preparation/index.ts",
    "src/input-preparation/data-references.ts",
    "src/input-preparation/runtime-login.ts",
    "src/input-preparation/operator-prompt.ts",
    "src/validation/feature-validator.ts",
    "src/validation/scenario-selector.ts",
    "dist/cucumber/src/execution/index.js",
    "dist/cucumber/src/execution/cli.js",
    "dist/cucumber/src/execution/reviewed-scenarios.js",
    "dist/cucumber/src/reporting/index.js",
    "dist/cucumber/src/reporting/output.js",
    "dist/cucumber/src/input-preparation/index.js",
    "dist/cucumber/src/input-preparation/data-references.js",
    "dist/cucumber/src/input-preparation/runtime-login.js",
    "dist/cucumber/src/input-preparation/operator-prompt.js",
    "dist/cucumber/src/validation/feature-validator.js",
    "dist/cucumber/src/validation/scenario-selector.js",
    "dist/cucumber/features/execution/steps.js",
    "dist/cucumber/features/execution/support/hooks.js",
    "dist/cucumber/features/execution/support/world.js",
    "dist/cucumber/features/support/step-timeout.js",
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
  for (const name of RUNTIME_DEPENDENCIES) {
    hash.update(name).update("\0");
    hash.update(readFileSync(runtimePackagePath(name))).update("\0");
  }
  hash.update(JSON.stringify(stepManifest.steps)).update("\0");
  hash.update(JSON.stringify(reviewedFixturePolicy)).update("\0");
  hash.update(readFileSync(path.join(REPOSITORY_ROOT, INPUT_FIXTURE_PATH)));
  return hash.digest("hex");
}

function dependenciesMatchPackage(): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    return RUNTIME_DEPENDENCIES.every((name) => {
      const pinnedVersion =
        manifest.dependencies[
          name === "playwright" || name === "playwright-core"
            ? "@playwright/test"
            : name
        ];
      const installed = JSON.parse(
        readFileSync(runtimePackagePath(name), "utf8"),
      ) as { version?: string };
      return (
        typeof pinnedVersion === "string" && installed.version === pinnedVersion
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
    !dependenciesMatchPackage() ||
    hashFile(REVIEWED_FEATURE_PATH) !== REVIEWED_FEATURE_REVISION ||
    calculateReviewedImplementationRevision() !==
      REVIEWED_IMPLEMENTATION_REVISION
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
