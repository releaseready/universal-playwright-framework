import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  MAX_FEATURE_BYTES,
  validateFeatureFile,
  type FeatureValidation,
  type ReviewedStepManifest,
} from "../src/validation/feature-validator";
import {
  selectApprovedScenarios,
  type ScenarioApproval,
} from "../src/validation/scenario-selector";

const repositoryRoot = path.resolve(__dirname, "../../..");
const fixturePath = "fixtures/validation/reviewed-scenarios.feature";
const manifest: ReviewedStepManifest = {
  implementationRevision: "steps-revision-a",
  steps: [
    { id: "common-setup", expression: "common setup is ready" },
    { id: "rule-setup", expression: "rule setup is ready" },
    { id: "open-demo", expression: "the demo page is open" },
    { id: "activate", expression: "I activate {word}" },
    { id: "outcome", expression: "outcome is {word}" },
  ],
};

function createWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "feature-validation-"));
}

function expectInvalid(
  result: FeatureValidation,
  expectedReason: RegExp,
): void {
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.match(result.reason, expectedReason);
  }
}

async function validateFixture(
  overrides: Partial<Parameters<typeof validateFeatureFile>[0]> = {},
): Promise<FeatureValidation> {
  return validateFeatureFile({
    workspaceRoot: repositoryRoot,
    featurePath: fixturePath,
    sourceRevision: "source-revision-a",
    manifest,
    ...overrides,
  });
}

function approvalFor(
  validation: Extract<FeatureValidation, { valid: true }>,
  ids: readonly string[],
): ScenarioApproval {
  return {
    featurePath: validation.featurePath,
    sourceRevision: validation.sourceRevision,
    featureRevision: validation.featureRevision,
    implementationRevision: validation.implementationRevision,
    scenarios: ids.map((id) => {
      const scenario = validation.scenarios.find(
        (candidate) => candidate.id === id,
      );
      assert.ok(scenario, `Expected fixture scenario ${id}`);
      return { id, tags: scenario.tags };
    }),
  };
}

test("validates synthetic feature metadata, inherited setup, tags, and example rows", async () => {
  const validation = await validateFixture();
  assert.equal(validation.valid, true);
  if (!validation.valid) {
    return;
  }

  assert.equal(validation.sourceRevision, "source-revision-a");
  assert.match(validation.featureRevision, /^[a-f0-9]{64}$/);

  const basic = validation.scenarios.find(
    (scenario) => scenario.id === "approved-basic",
  );
  assert.ok(basic);
  assert.equal(basic.name, "Basic synthetic flow");
  assert.equal(basic.runnable, true);
  assert.ok(basic.tags.includes("@validation-synthetic"));
  assert.ok(basic.tags.includes("@rule-review"));
  assert.deepEqual(
    basic.steps.map((step) => step.implementationId),
    ["common-setup", "rule-setup", "open-demo"],
  );

  const rowA = validation.scenarios.find(
    (scenario) => scenario.id === "approved-outline/row-a",
  );
  assert.ok(rowA);
  assert.equal(rowA.name, "Synthetic example flow");
  assert.equal(rowA.exampleRow?.values.action, "alpha");
  assert.ok(rowA.tags.includes("@row-review"));
  assert.deepEqual(
    rowA.steps.map((step) => step.implementationId),
    ["common-setup", "rule-setup", "activate", "outcome"],
  );

  const unresolved = validation.scenarios.find(
    (scenario) => scenario.id === "undefined-step",
  );
  assert.ok(unresolved);
  assert.equal(unresolved.runnable, false);
  assert.equal(unresolved.steps.at(-1)?.issue, "undefined");
  assert.match(
    unresolved.issues.join(" "),
    /this synthetic step is not reviewed/,
  );
});

test("rejects unsafe paths, oversized input, malformed UTF-8, and invalid Gherkin", async () => {
  const workspace = createWorkspace();
  const outsideWorkspace = createWorkspace();
  try {
    writeFileSync(
      path.join(workspace, "oversized.feature"),
      Buffer.alloc(MAX_FEATURE_BYTES + 1),
    );
    writeFileSync(
      path.join(workspace, "malformed-utf8.feature"),
      Buffer.from([0xc3, 0x28]),
    );
    writeFileSync(
      path.join(workspace, "invalid-gherkin.feature"),
      "not a feature\n",
    );
    writeFileSync(
      path.join(workspace, "inside.feature"),
      "Feature: synthetic\n",
    );
    writeFileSync(
      path.join(outsideWorkspace, "outside.feature"),
      "Feature: synthetic\n",
    );
    symlinkSync(
      path.join(outsideWorkspace, "outside.feature"),
      path.join(workspace, "linked.feature"),
    );

    const shared = {
      workspaceRoot: workspace,
      sourceRevision: "synthetic-revision",
      manifest,
    };
    expectInvalid(
      await validateFeatureFile({ ...shared, featurePath: "missing.txt" }),
      /\.feature extension/,
    );
    expectInvalid(
      await validateFeatureFile({
        ...shared,
        featurePath: "../outside.feature",
      }),
      /stay within the workspace/,
    );
    expectInvalid(
      await validateFeatureFile({ ...shared, featurePath: "linked.feature" }),
      /stay within the workspace/,
    );
    expectInvalid(
      await validateFeatureFile({
        ...shared,
        featurePath: "oversized.feature",
      }),
      /exceeds the .*byte limit/,
    );
    expectInvalid(
      await validateFeatureFile({
        ...shared,
        featurePath: "malformed-utf8.feature",
      }),
      /not valid UTF-8/,
    );
    expectInvalid(
      await validateFeatureFile({
        ...shared,
        featurePath: "invalid-gherkin.feature",
      }),
      /invalid Gherkin at line/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outsideWorkspace, { recursive: true, force: true });
  }
});

test("marks missing and ambiguous reviewed step matches not runnable", async () => {
  const unresolvedValidation = await validateFixture();
  assert.equal(unresolvedValidation.valid, true);
  if (!unresolvedValidation.valid) {
    return;
  }
  const unresolved = unresolvedValidation.scenarios.find(
    (scenario) => scenario.id === "undefined-step",
  );
  assert.equal(unresolved?.runnable, false);
  assert.equal(
    unresolved?.steps.at(-1)?.text,
    "this synthetic step is not reviewed",
  );

  const ambiguousManifest: ReviewedStepManifest = {
    ...manifest,
    steps: [
      ...manifest.steps,
      { id: "broad-open-demo", expression: "the {word} page is open" },
    ],
  };
  const ambiguousValidation = await validateFixture({
    manifest: ambiguousManifest,
  });
  assert.equal(ambiguousValidation.valid, true);
  if (!ambiguousValidation.valid) {
    return;
  }
  const ambiguous = ambiguousValidation.scenarios.find(
    (scenario) => scenario.id === "approved-basic",
  );
  assert.equal(ambiguous?.runnable, false);
  assert.equal(ambiguous?.steps.at(-1)?.issue, "ambiguous");
  assert.match(
    ambiguous?.issues.join(" ") ?? "",
    /ambiguous reviewed implementations/,
  );
});

test("selects only approved IDs with matching tags and rejects empty or stale approval", async () => {
  const validation = await validateFixture();
  assert.equal(validation.valid, true);
  if (!validation.valid) {
    return;
  }
  const approval = approvalFor(validation, [
    "approved-basic",
    "approved-outline/row-a",
  ]);
  const selected = selectApprovedScenarios(validation, approval, {
    scenarioIds: ["approved-outline/row-a"],
    tags: ["@rule-review", "@row-review"],
  });
  assert.equal(selected.runnable, true);
  if (selected.runnable) {
    assert.deepEqual(
      selected.scenarios.map((scenario) => scenario.id),
      ["approved-outline/row-a"],
    );
  }

  const noMatches = selectApprovedScenarios(validation, approval, {
    tags: ["@not-approved"],
  });
  assert.equal(noMatches.runnable, false);
  if (!noMatches.runnable) {
    assert.match(noMatches.reason, /No approved runnable scenarios match/);
  }

  const changedSource = await validateFixture({
    sourceRevision: "source-revision-b",
  });
  assert.equal(
    selectApprovedScenarios(changedSource, approval).runnable,
    false,
  );

  const changedImplementation = await validateFixture({
    manifest: { ...manifest, implementationRevision: "steps-revision-b" },
  });
  assert.equal(
    selectApprovedScenarios(changedImplementation, approval).runnable,
    false,
  );

  const workspace = createWorkspace();
  try {
    const featureFile = path.join(workspace, "reviewed.feature");
    copyFileSync(path.join(repositoryRoot, fixturePath), featureFile);
    const original = await validateFeatureFile({
      workspaceRoot: workspace,
      featurePath: "reviewed.feature",
      sourceRevision: "source-revision-a",
      manifest,
    });
    assert.equal(original.valid, true);
    if (!original.valid) {
      return;
    }
    const originalApproval = approvalFor(original, ["approved-basic"]);
    writeFileSync(
      featureFile,
      readFileSync(featureFile, "utf8").replace(
        "Feature: Synthetic review intake",
        "Feature: Synthetic revised intake",
      ),
    );
    const changedFeature = await validateFeatureFile({
      workspaceRoot: workspace,
      featurePath: "reviewed.feature",
      sourceRevision: "source-revision-a",
      manifest,
    });
    assert.equal(
      selectApprovedScenarios(changedFeature, originalApproval).runnable,
      false,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
