import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  InputPreparationError,
  prepareScenarioInputs,
  type ReviewedDataReferenceInput,
  type ReviewedFixtureFieldPolicy,
} from "../src/input-preparation";
import {
  type DataReferenceSelection,
  reviewDataReferences,
  verifyDataReferenceBinding,
} from "../src/input-preparation/data-references";
import { validateFeatureFile } from "../src/validation/feature-validator";
import type { ScenarioApproval } from "../src/validation/scenario-selector";

const catalogue = {
  datasets: [{ id: "owned-demo", revision: "v1", rows: ["row-a", "row-b"] }],
  secrets: [{ id: "synthetic-account", revision: "v1" }],
};
const selection: DataReferenceSelection = {
  version: 1,
  rows: ["row-a", "row-b"].map((rowId) => ({
    scenarioId: `approved-outline/${rowId}`,
    dataset: { id: "owned-demo", revision: "v1" },
    rowId,
    secret: { id: "synthetic-account", revision: "v1" },
  })),
};
const preparationSelection: DataReferenceSelection = {
  version: 1,
  rows: selection.rows.map(({ secret: _secret, ...row }) => row),
};

const workspaceRoot = path.resolve(__dirname, "../../..");
const scenarioIds = ["approved-outline/row-a", "approved-outline/row-b"];
const fixturePolicy: ReviewedFixtureFieldPolicy = {
  version: 1,
  id: "synthetic-fixture-policy",
  revision: "fixture-policy-review-1",
  sharedFields: {},
  scenarioFields: {
    "approved-outline/row-a": {
      action: { type: "string", maxLength: 32 },
      expectedOutcome: { type: "string", maxLength: 32 },
      genres: { type: "string-list", maxItems: 5, maxLength: 32 },
    },
    "approved-outline/row-b": {
      action: { type: "string", maxLength: 32 },
      expectedOutcome: { type: "string", maxLength: 32 },
    },
  },
};

async function loadPreparationContext(): Promise<{
  input: Record<string, unknown> & {
    scenarios: { id: string; dataReference?: unknown }[];
  };
  validation: Awaited<ReturnType<typeof validateFeatureFile>>;
  approval: ScenarioApproval;
}> {
  const validation = await validateFeatureFile({
    workspaceRoot,
    featurePath: "fixtures/validation/reviewed-scenarios.feature",
    sourceRevision: "synthetic-source-1",
    manifest: {
      implementationRevision: "synthetic-steps-1",
      steps: [
        { id: "common-setup", expression: "common setup is ready" },
        { id: "rule-setup", expression: "rule setup is ready" },
        { id: "open-demo", expression: "the demo page is open" },
        { id: "activate", expression: "I activate {word}" },
        { id: "outcome", expression: "outcome is {word}" },
      ],
    },
  });
  assert.equal(validation.valid, true);
  if (!validation.valid) throw new Error("Owned synthetic feature is invalid");

  const approval: ScenarioApproval = {
    featurePath: validation.featurePath,
    sourceRevision: validation.sourceRevision,
    featureRevision: validation.featureRevision,
    implementationRevision: validation.implementationRevision,
    scenarios: scenarioIds.map((id) => {
      const scenario = validation.scenarios.find(
        (candidate) => candidate.id === id,
      );
      assert.ok(scenario);
      return { id, tags: scenario.tags };
    }),
  };

  const input = JSON.parse(
    readFileSync(
      path.join(
        workspaceRoot,
        "fixtures/input-preparation/approved-scenarios.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown> & {
    scenarios: { id: string; dataReference?: unknown }[];
  };
  input.scenarios = input.scenarios.filter((scenario) =>
    preparationSelection.rows.some(
      (reference) => reference.scenarioId === scenario.id,
    ),
  );
  for (const reference of preparationSelection.rows) {
    const scenario = input.scenarios.find(
      (candidate) => candidate.id === reference.scenarioId,
    );
    assert.ok(scenario);
    scenario.dataReference = {
      dataset: { ...reference.dataset },
      rowId: reference.rowId,
    };
  }
  return { input, validation, approval };
}

test("An operator can bind two distinct approved dataset rows without supplying secret values", () => {
  const review = reviewDataReferences(selection, catalogue);
  assert.deepEqual(
    verifyDataReferenceBinding(selection, catalogue, review.binding),
    review,
  );
  assert.deepEqual(
    review.rows.map((row) => row.rowId),
    ["row-a", "row-b"],
  );
  assert.equal(review.binding.length, 64);
});

test("Input preparation verifies dataset rows and environment before returning scenarios", async () => {
  const { input, validation, approval } = await loadPreparationContext();
  const reviewed = reviewDataReferences(preparationSelection, catalogue);
  const descriptor = prepareScenarioInputs(
    JSON.stringify(input),
    validation,
    approval,
    fixturePolicy,
    { scenarioIds },
    {
      selection: preparationSelection,
      approvedCatalogue: catalogue,
      binding: reviewed.binding,
      approvedEnvironment: {
        id: "synthetic-review",
        revision: "environment-1",
        approvedOrigin: "https://synthetic.example.test",
      },
    },
  );
  assert.deepEqual(
    descriptor.scenarios.map((scenario) => scenario.dataReference?.rowId),
    ["row-a", "row-b"],
  );
  assert.equal(descriptor.dataReferences?.binding, reviewed.binding);
  assert.deepEqual(
    descriptor.dataReferences?.rows.map((row) => row.dataset.revision),
    ["v1", "v1"],
  );
  assert.deepEqual(
    descriptor.scenarios.map((scenario) => scenario.values.action),
    ["alpha", "beta"],
  );
});

test("Preparation accepts path-scoped identifiers from the merged reference contract", async () => {
  const { input, validation, approval } = await loadPreparationContext();
  const scopedSelection: DataReferenceSelection = {
    version: 1,
    rows: preparationSelection.rows.map((row) => ({
      ...row,
      dataset: { id: "owned/demo", revision: "revisions/v1" },
      rowId: `rows/${row.rowId}`,
    })),
  };
  const scopedCatalogue = {
    datasets: [
      {
        id: "owned/demo",
        revision: "revisions/v1",
        rows: ["rows/row-a", "rows/row-b"],
      },
    ],
    secrets: [],
  };
  for (const reference of scopedSelection.rows) {
    const fixture = input.scenarios.find(
      (scenario) => scenario.id === reference.scenarioId,
    );
    assert.ok(fixture);
    fixture.dataReference = {
      dataset: { ...reference.dataset },
      rowId: reference.rowId,
    };
  }
  const reviewed = reviewDataReferences(scopedSelection, scopedCatalogue);
  const descriptor = prepareScenarioInputs(
    JSON.stringify(input),
    validation,
    approval,
    fixturePolicy,
    { scenarioIds },
    {
      selection: scopedSelection,
      approvedCatalogue: scopedCatalogue,
      binding: reviewed.binding,
      approvedEnvironment: {
        id: "synthetic-review",
        revision: "environment-1",
        approvedOrigin: "https://synthetic.example.test",
      },
    },
  );
  assert.deepEqual(descriptor.dataReferences, reviewed);
});

test("Preparation rejects withdrawn or missing references before any execution handoff", async () => {
  const { input, validation, approval } = await loadPreparationContext();
  const review = reviewDataReferences(preparationSelection, catalogue);
  const referenceInput: ReviewedDataReferenceInput = {
    selection: preparationSelection,
    approvedCatalogue: catalogue,
    binding: review.binding,
    approvedEnvironment: {
      id: "synthetic-review",
      revision: "environment-1",
      approvedOrigin: "https://synthetic.example.test",
    },
  };
  const noFixtureReference = structuredClone(input);
  delete noFixtureReference.scenarios[0].dataReference;
  const changedSelection = structuredClone(preparationSelection);
  changedSelection.rows[0].rowId = "row-b";
  const extraSelection: DataReferenceSelection = {
    version: 1,
    rows: [
      ...preparationSelection.rows,
      {
        ...preparationSelection.rows[0],
        scenarioId: "approved-basic",
      },
    ],
  };
  const candidates = [
    { referenceInput: undefined, input },
    { referenceInput, input: noFixtureReference },
    {
      referenceInput: {
        ...referenceInput,
        approvedCatalogue: { ...catalogue, datasets: [] },
      },
      input,
    },
    {
      referenceInput: {
        ...referenceInput,
        approvedCatalogue: {
          ...catalogue,
          datasets: [{ ...catalogue.datasets[0], rows: ["row-b"] }],
        },
      },
      input,
    },
    {
      referenceInput: {
        ...referenceInput,
        selection: changedSelection,
      },
      input,
    },
    {
      referenceInput: {
        ...referenceInput,
        selection: extraSelection,
        binding: reviewDataReferences(extraSelection, catalogue).binding,
      },
      input,
    },
  ];
  for (const candidate of candidates) {
    let executionHandoffs = 0;
    assert.throws(
      () => {
        prepareScenarioInputs(
          JSON.stringify(candidate.input),
          validation,
          approval,
          fixturePolicy,
          { scenarioIds },
          candidate.referenceInput,
        );
        executionHandoffs += 1;
      },
      (error: unknown) =>
        error instanceof InputPreparationError &&
        error.code === "invalid-data-reference",
    );
    assert.equal(executionHandoffs, 0);
  }
});

test("Preparation retains versioned secret references but rejects secret payloads safely", async () => {
  const { input, validation, approval } = await loadPreparationContext();
  for (const reference of selection.rows) {
    const fixture = input.scenarios.find(
      (scenario) => scenario.id === reference.scenarioId,
    );
    assert.ok(fixture);
    fixture.dataReference = {
      dataset: { ...reference.dataset },
      rowId: reference.rowId,
      secret: { ...reference.secret },
    };
  }
  const review = reviewDataReferences(selection, catalogue);
  const referenceInput: ReviewedDataReferenceInput = {
    selection,
    approvedCatalogue: catalogue,
    binding: review.binding,
    approvedEnvironment: {
      id: "synthetic-review",
      revision: "environment-1",
      approvedOrigin: "https://synthetic.example.test",
    },
  };
  const prepare = (candidateInput = input) =>
    prepareScenarioInputs(
      JSON.stringify(candidateInput),
      validation,
      approval,
      fixturePolicy,
      { scenarioIds },
      referenceInput,
    );
  const descriptor = prepare();
  assert.deepEqual(descriptor.dataReferences, review);
  assert.deepEqual(
    descriptor.scenarios.map((scenario) => scenario.dataReference?.secret),
    [
      { id: "synthetic-account", revision: "v1" },
      { id: "synthetic-account", revision: "v1" },
    ],
  );
  const mismatchedSecret = structuredClone(input);
  mismatchedSecret.scenarios[0].dataReference = {
    dataset: { id: "owned-demo", revision: "v1" },
    rowId: "row-a",
    secret: { id: "synthetic-account", revision: "v2" },
  };
  assert.throws(
    () => prepare(mismatchedSecret),
    (error: unknown) =>
      error instanceof InputPreparationError &&
      error.code === "invalid-data-reference",
  );
  const sentinel = "SYNTHETIC_PRIVATE_VALUE_83";
  const candidate = structuredClone(input);
  candidate.scenarios[0].dataReference = {
    dataset: { id: "owned-demo", revision: "v1" },
    rowId: "row-a",
    secret: { id: "synthetic-account", revision: "v1", value: sentinel },
  };
  assert.throws(
    () => prepare(candidate),
    (error: unknown) => {
      assert.ok(error instanceof InputPreparationError);
      assert.ok(!error.message.includes(sentinel));
      assert.ok(!JSON.stringify(error).includes(sentinel));
      return true;
    },
  );
  assert.ok(!JSON.stringify(descriptor).includes(sentinel));
});

test("Input preparation rejects missing, stale, mismatched rows and environments safely", async () => {
  const { input, validation, approval } = await loadPreparationContext();
  const reviewed = reviewDataReferences(preparationSelection, catalogue);
  const prepare = (
    referenceInput: ReviewedDataReferenceInput,
    candidateInput = input,
  ) =>
    prepareScenarioInputs(
      JSON.stringify(candidateInput),
      validation,
      approval,
      fixturePolicy,
      { scenarioIds },
      referenceInput,
    );
  const referenceInput = {
    selection: preparationSelection,
    approvedCatalogue: catalogue,
    binding: reviewed.binding,
    approvedEnvironment: {
      id: "synthetic-review",
      revision: "environment-1",
      approvedOrigin: "https://synthetic.example.test",
    },
  };

  assert.throws(
    () =>
      prepare({
        ...referenceInput,
        selection: { version: 1, rows: [] },
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid-data-reference",
  );

  const staleSelection = structuredClone(preparationSelection);
  const firstStaleRow = staleSelection.rows[0];
  assert.ok(firstStaleRow);
  firstStaleRow.dataset.revision = "v2";
  assert.throws(
    () =>
      prepare({
        ...referenceInput,
        selection: staleSelection,
        approvedCatalogue: {
          ...catalogue,
          datasets: [
            ...catalogue.datasets,
            { ...catalogue.datasets[0], revision: "v2" },
          ],
        },
      }),
    /Data reference review is stale/,
  );

  const mismatchedInput = structuredClone(input);
  const rowA = mismatchedInput.scenarios.find(
    (scenario) => scenario.id === "approved-outline/row-a",
  );
  assert.ok(rowA?.dataReference);
  rowA.dataReference = {
    dataset: { id: "owned-demo", revision: "v1" },
    rowId: "row-b",
  };
  assert.throws(
    () => prepare(referenceInput, mismatchedInput),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid-data-reference",
  );

  assert.throws(
    () =>
      prepare({
        ...referenceInput,
        approvedEnvironment: {
          ...referenceInput.approvedEnvironment,
          revision: "environment-2",
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid-environment",
  );

  assert.throws(
    () =>
      prepare({
        ...referenceInput,
        approvedEnvironment: {
          ...referenceInput.approvedEnvironment,
          approvedOrigin: "https://other.example.test",
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid-environment",
  );
});

test("Missing, unknown, unversioned and duplicate row references stop preparation safely", () => {
  for (const change of [
    { dataset: { id: "owned-demo" } },
    { dataset: { id: "unknown", revision: "v1" } },
    { rowId: "missing" },
    { secret: { id: "unknown", revision: "v1" } },
    { secret: { id: "synthetic-account" } },
  ]) {
    assert.throws(
      () =>
        reviewDataReferences(
          { ...selection, rows: [{ ...selection.rows[0], ...change }] },
          catalogue,
        ),
      /Data references are missing, invalid or unapproved/,
    );
  }
  assert.throws(() =>
    reviewDataReferences(
      { ...selection, rows: [selection.rows[0], selection.rows[0]] },
      catalogue,
    ),
  );
  assert.throws(() =>
    reviewDataReferences({ version: 1, rows: [] }, catalogue),
  );
});

test("An approved data or secret revision change requires a fresh review and binding", () => {
  const old = reviewDataReferences(selection, catalogue);
  for (const field of ["dataset", "secret"] as const) {
    const changed = structuredClone(selection);
    const changedRow = changed.rows[0];
    assert.ok(changedRow);
    const changedReference = changedRow[field];
    assert.ok(changedReference);
    changedReference.revision = "v2";
    const nextCatalogue = {
      datasets: [
        ...catalogue.datasets,
        { ...catalogue.datasets[0], revision: "v2" },
      ],
      secrets: [
        ...catalogue.secrets,
        { ...catalogue.secrets[0], revision: "v2" },
      ],
    };
    assert.throws(
      () => verifyDataReferenceBinding(changed, nextCatalogue, old.binding),
      /Data reference review is stale/,
    );
    assert.notEqual(
      reviewDataReferences(changed, nextCatalogue).binding,
      old.binding,
    );
  }
});

test("Rejected secret payloads never appear in safe errors or serialized reference results", () => {
  const sentinel = "SYNTHETIC_PRIVATE_VALUE_83";
  for (const candidate of [
    { ...selection, secretValue: sentinel },
    {
      ...selection,
      rows: [
        {
          ...selection.rows[0],
          secret: { ...selection.rows[0].secret, value: sentinel },
        },
      ],
    },
  ]) {
    assert.throws(
      () => reviewDataReferences(candidate, catalogue),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes(sentinel));
        assert.ok(!JSON.stringify(error).includes(sentinel));
        return true;
      },
    );
  }
  assert.ok(
    !JSON.stringify(reviewDataReferences(selection, catalogue)).includes(
      sentinel,
    ),
  );
});

test("Reordering rows preserves a review, but reassociation or withdrawn approval rejects it", () => {
  const reviewed = reviewDataReferences(selection, catalogue);
  const reversed = { ...selection, rows: [...selection.rows].reverse() };
  assert.equal(
    reviewDataReferences(reversed, catalogue).binding,
    reviewed.binding,
  );
  const changed = structuredClone(selection);
  changed.rows[0].rowId = "row-b";
  assert.throws(
    () => verifyDataReferenceBinding(changed, catalogue, reviewed.binding),
    /review is stale/,
  );
  assert.throws(
    () =>
      verifyDataReferenceBinding(
        selection,
        { ...catalogue, secrets: [] },
        reviewed.binding,
      ),
    /unapproved/,
  );
  const publicOnly = {
    ...selection,
    rows: selection.rows.map(({ secret: _secret, ...row }) => row),
  };
  assert.equal(
    reviewDataReferences(publicOnly, { ...catalogue, secrets: [] }).rows.length,
    2,
  );
});
