import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Given,
  Then,
  When,
  World,
  setWorldConstructor,
  type IWorldOptions,
} from "@cucumber/cucumber";
import {
  InputPreparationError,
  prepareScenarioInputs,
  type PreparedInputDescriptor,
} from "../../src/input-preparation";
import {
  validateFeatureFile,
  type FeatureValidation,
  type ReviewedStepManifest,
} from "../../src/validation/feature-validator";
import type { ScenarioApproval } from "../../src/validation/scenario-selector";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const inputFixturePath = path.join(
  repositoryRoot,
  "fixtures/input-preparation/approved-scenarios.json",
);
const featurePath = "fixtures/validation/reviewed-scenarios.feature";
const manifest: ReviewedStepManifest = {
  implementationRevision: "synthetic-steps-1",
  steps: [
    { id: "common-setup", expression: "common setup is ready" },
    { id: "rule-setup", expression: "rule setup is ready" },
    { id: "open-demo", expression: "the demo page is open" },
    { id: "activate", expression: "I activate {word}" },
    { id: "outcome", expression: "outcome is {word}" },
  ],
};
const approvedScenarioIds = [
  "approved-basic",
  "approved-outline/row-a",
  "approved-outline/row-b",
];

class InputPreparationWorld extends World {
  inputJson = "";
  validation?: FeatureValidation;
  approval?: ScenarioApproval;
  descriptor?: PreparedInputDescriptor;
  error?: unknown;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(InputPreparationWorld);

async function loadReviewedScenarios(
  world: InputPreparationWorld,
): Promise<void> {
  const validation = await validateFeatureFile({
    workspaceRoot: repositoryRoot,
    featurePath,
    sourceRevision: "synthetic-source-1",
    manifest,
  });
  assert.equal(validation.valid, true);
  if (!validation.valid) {
    throw new Error("Synthetic reviewed scenarios failed validation");
  }

  const scenarios = approvedScenarioIds.map((id) => {
    const scenario = validation.scenarios.find(
      (candidate) => candidate.id === id,
    );
    assert.ok(scenario);
    return { id, tags: scenario.tags };
  });
  world.validation = validation;
  world.approval = {
    featurePath,
    sourceRevision: validation.sourceRevision,
    featureRevision: validation.featureRevision,
    implementationRevision: validation.implementationRevision,
    scenarios,
  };
}

function useApprovedFixture(world: InputPreparationWorld): void {
  world.inputJson = readFileSync(inputFixturePath, "utf8");
  world.descriptor = undefined;
  world.error = undefined;
}

function changeFixture(
  world: InputPreparationWorld,
  change: (input: Record<string, unknown>) => void,
): void {
  useApprovedFixture(world);
  const input = JSON.parse(world.inputJson) as Record<string, unknown>;
  change(input);
  world.inputJson = JSON.stringify(input);
}

Given(
  "the approved synthetic fixture and reviewed scenarios",
  async function (this: InputPreparationWorld) {
    useApprovedFixture(this);
    await loadReviewedScenarios(this);
  },
);

Given(
  "the synthetic fixture has no environment settings",
  async function (this: InputPreparationWorld) {
    changeFixture(this, (input) => {
      delete input.environment;
    });
    await loadReviewedScenarios(this);
  },
);

Given(
  "a scenario refers to an unavailable account",
  async function (this: InputPreparationWorld) {
    changeFixture(this, (input) => {
      const scenarios = input.scenarios as Record<string, unknown>[];
      scenarios[0].accountReference = "synthetic-secret-that-must-not-leak";
    });
    await loadReviewedScenarios(this);
  },
);

Given(
  "a scenario contains a secret-value field",
  async function (this: InputPreparationWorld) {
    changeFixture(this, (input) => {
      const scenarios = input.scenarios as Record<string, unknown>[];
      const values = scenarios[0].values as Record<string, unknown>;
      values.secretValue = {
        classification: "secret",
        value: "synthetic-only-value",
      };
    });
    await loadReviewedScenarios(this);
  },
);

Given(
  "the initial target uses a same-origin blob URL",
  async function (this: InputPreparationWorld) {
    changeFixture(this, (input) => {
      const environment = input.environment as Record<string, unknown>;
      environment.initialTargetUrl =
        "blob:https://synthetic.example.test/example";
    });
    await loadReviewedScenarios(this);
  },
);

Given(
  "the initial target contains a synthetic secret query",
  async function (this: InputPreparationWorld) {
    changeFixture(this, (input) => {
      const environment = input.environment as Record<string, unknown>;
      environment.initialTargetUrl =
        "https://synthetic.example.test/demo?access_token=synthetic-secret-value";
    });
    await loadReviewedScenarios(this);
  },
);

Given(
  "the initial target contains a fragment",
  async function (this: InputPreparationWorld) {
    changeFixture(this, (input) => {
      const environment = input.environment as Record<string, unknown>;
      environment.initialTargetUrl =
        "https://synthetic.example.test/demo#synthetic-fragment";
    });
    await loadReviewedScenarios(this);
  },
);

Given(
  "a scenario has no fixture fields",
  async function (this: InputPreparationWorld) {
    changeFixture(this, (input) => {
      const scenarios = input.scenarios as Record<string, unknown>[];
      scenarios[0].values = {};
    });
    await loadReviewedScenarios(this);
  },
);

Given(
  "the initial target uses an unapproved origin",
  async function (this: InputPreparationWorld) {
    changeFixture(this, (input) => {
      const environment = input.environment as Record<string, unknown>;
      environment.initialTargetUrl = "https://outside.example.test/demo";
    });
    await loadReviewedScenarios(this);
  },
);

When("I prepare the scenario inputs", function (this: InputPreparationWorld) {
  assert.ok(this.validation);
  assert.ok(this.approval);
  try {
    this.descriptor = prepareScenarioInputs(
      this.inputJson,
      this.validation,
      this.approval,
    );
  } catch (error) {
    this.error = error;
  }
});

Then(
  "the prepared descriptor contains only safe revisions and selected values",
  function (this: InputPreparationWorld) {
    assert.ok(this.descriptor);
    assert.equal(this.descriptor.version, 1);
    assert.equal(
      this.descriptor.environment.initialTargetUrl,
      "https://synthetic.example.test/demo",
    );
    assert.deepEqual(this.descriptor.review, {
      sourceRevision: "synthetic-source-1",
      featureRevision: this.validation?.valid
        ? this.validation.featureRevision
        : "",
      implementationRevision: "synthetic-steps-1",
    });
    assert.deepEqual(
      this.descriptor.scenarios.map((scenario) => scenario.id),
      approvedScenarioIds,
    );
    assert.equal(
      this.descriptor.scenarios[0].values.displayName,
      "Synthetic Visitor",
    );
  },
);

Then(
  "preparation fails safely with {string}",
  function (this: InputPreparationWorld, code: string) {
    assert.ok(this.error instanceof InputPreparationError);
    assert.equal(this.error.code, code);
    assert.doesNotMatch(
      this.error.message,
      /synthetic-secret-value|outside\.example\.test|synthetic-only-value|access_token|synthetic-fragment/i,
    );
    assert.equal(this.descriptor, undefined);
  },
);

Then(
  "prepared account access contains references only",
  function (this: InputPreparationWorld) {
    assert.ok(this.descriptor);
    assert.deepEqual(this.descriptor.scenarios[0].account, {
      reference: "synthetic-account-basic",
      secretReference: { id: "synthetic-secret-basic" },
    });
    assert.equal(
      Object.hasOwn(this.descriptor.scenarios[0].account, "secretValue"),
      false,
    );
    assert.doesNotMatch(
      JSON.stringify(this.descriptor),
      /synthetic-only-value/,
    );
  },
);

Then(
  "mutating one scenario cannot mutate another scenario",
  function (this: InputPreparationWorld) {
    assert.ok(this.descriptor);
    const [first, second] = this.descriptor.scenarios;
    assert.ok(Array.isArray(first.values.genres));
    (first.values.genres as string[]).push("mutated");
    assert.deepEqual(second.values, {
      action: "alpha",
      expectedOutcome: "ready",
      genres: ["ambient", "jazz"],
    });
    const secondAccountReference = second.account.reference;
    (first.account as { reference: string }).reference = "mutated";
    assert.equal(second.account.reference, secondAccountReference);
    assert.notStrictEqual(first.values, second.values);
    assert.notStrictEqual(first.account, second.account);
    assert.notStrictEqual(
      first.account.secretReference,
      second.account.secretReference,
    );
  },
);

Then(
  "cleanup remains required and unknown until runtime evidence",
  function (this: InputPreparationWorld) {
    assert.ok(this.descriptor);
    for (const scenario of this.descriptor.scenarios) {
      assert.equal(scenario.cleanup.required, true);
      assert.equal(scenario.cleanup.authorized, true);
      assert.match(scenario.cleanup.reference, /^synthetic-cleanup-/);
      assert.equal(scenario.cleanup.authorizationRevision, "cleanup-review-1");
      assert.equal(scenario.cleanup.outcome, "unknown");
    }
  },
);
