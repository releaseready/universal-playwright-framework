import type { FeatureValidation, ValidatedScenario } from "./feature-validator";

export interface ApprovedScenario {
  readonly id: string;
  readonly tags: readonly string[];
}

export interface ScenarioApproval {
  readonly featurePath: string;
  readonly sourceRevision: string;
  readonly featureRevision: string;
  readonly implementationRevision: string;
  readonly scenarios: readonly ApprovedScenario[];
}

export interface ScenarioSelectionFilters {
  readonly scenarioIds?: readonly string[];
  readonly tags?: readonly string[];
}

export type ScenarioSelection =
  | {
      readonly runnable: false;
      readonly reason: string;
      readonly scenarios: readonly [];
    }
  | {
      readonly runnable: true;
      readonly scenarios: readonly ValidatedScenario[];
    };

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((tag) => right.includes(tag))
  );
}

function notRunnable(reason: string): ScenarioSelection {
  return { runnable: false, reason, scenarios: [] };
}

export function selectApprovedScenarios(
  validation: FeatureValidation,
  approval: ScenarioApproval,
  filters: ScenarioSelectionFilters = {},
): ScenarioSelection {
  if (!validation.valid) {
    return notRunnable(validation.reason);
  }
  if (
    validation.featurePath !== approval.featurePath ||
    validation.sourceRevision !== approval.sourceRevision ||
    validation.featureRevision !== approval.featureRevision ||
    validation.implementationRevision !== approval.implementationRevision
  ) {
    return notRunnable(
      "Approval is stale; feature or implementation revision changed",
    );
  }

  const approvedIds = new Set<string>();
  for (const scenario of approval.scenarios) {
    if (approvedIds.has(scenario.id)) {
      return notRunnable("Approval contains duplicate scenario identifiers");
    }
    approvedIds.add(scenario.id);
  }

  const scenariosById = new Map<string, ValidatedScenario>();
  for (const scenario of validation.scenarios) {
    if (scenario.id !== null) {
      scenariosById.set(scenario.id, scenario);
    }
  }

  for (const approved of approval.scenarios) {
    const current = scenariosById.get(approved.id);
    if (!current || !sameTags(current.tags, approved.tags)) {
      return notRunnable(
        "Approval is stale; an approved scenario or its tags changed",
      );
    }
  }

  const requestedIds = filters.scenarioIds
    ? new Set(filters.scenarioIds)
    : undefined;
  const requestedTags = filters.tags ?? [];
  const selected = approval.scenarios
    .map((approved) => scenariosById.get(approved.id))
    .filter(
      (scenario): scenario is ValidatedScenario =>
        scenario !== undefined &&
        scenario.runnable &&
        (!requestedIds || requestedIds.has(scenario.id ?? "")) &&
        requestedTags.every((tag) => scenario.tags.includes(tag)),
    );

  if (selected.length === 0) {
    return notRunnable(
      "No approved runnable scenarios match the requested identifiers and tags",
    );
  }
  return { runnable: true, scenarios: selected };
}
