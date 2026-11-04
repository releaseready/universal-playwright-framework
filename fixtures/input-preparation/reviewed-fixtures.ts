import type { ReviewedFixtureFieldPolicy } from "../../src/input-preparation";
import type { ReviewedStepManifest } from "../../src/validation/feature-validator";

export function createValidationManifest(
  implementationRevision: string,
): ReviewedStepManifest {
  return {
    implementationRevision,
    steps: [
      { id: "common-setup", expression: "common setup is ready" },
      { id: "rule-setup", expression: "rule setup is ready" },
      { id: "open-demo", expression: "the demo page is open" },
      { id: "activate", expression: "I activate {word}" },
      { id: "outcome", expression: "outcome is {word}" },
    ],
  };
}

export function createOutlineFixtureFields(): ReviewedFixtureFieldPolicy["scenarioFields"] {
  return {
    "approved-outline/row-a": {
      action: { type: "string", maxLength: 32 },
      expectedOutcome: { type: "string", maxLength: 32 },
      genres: { type: "string-list", maxItems: 5, maxLength: 32 },
    },
    "approved-outline/row-b": {
      action: { type: "string", maxLength: 32 },
      expectedOutcome: { type: "string", maxLength: 32 },
    },
  };
}
