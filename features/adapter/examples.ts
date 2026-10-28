import type {
  AdapterRequest,
  TrustedAdapterContext,
} from "../../src/adapter/v1";
import compatible from "../../fixtures/adapter/v1-compatible.json";

export function examples(scenarioIds = ["browser-flow"]): {
  request: AdapterRequest;
  context: TrustedAdapterContext;
} {
  const request = structuredClone(compatible) as AdapterRequest;
  request.scenarioIds = scenarioIds;
  return {
    request,
    context: {
      version: 1,
      authorization: "owned-synthetic",
      callerId: "central-owner",
      runId: request.run.id,
      gitRevision: request.run.gitRevision,
      allowedScenarioIds: [...scenarioIds],
      approval: { ...request.approval },
      inputs: { ...request.inputs },
    },
  };
}
