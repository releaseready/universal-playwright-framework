import type {
  PreparedInputDescriptor,
  RuntimeLoginRequest,
} from "../../src/runtime-login/v1";
import { PARTAY_LOGIN_URL } from "../../src/runtime-login/v1";
import { reviewDataReferences } from "../../src/input-preparation/data-references";

export function runtimeEntryFixture() {
  const references = reviewDataReferences(
    {
      version: 1,
      rows: [
        {
          scenarioId: "owned-login",
          dataset: { id: "owned-data", revision: "v1" },
          rowId: "owned-row",
          secret: { id: "owned-account", revision: "v1" },
        },
      ],
    },
    {
      datasets: [{ id: "owned-data", revision: "v1", rows: ["owned-row"] }],
      secrets: [{ id: "owned-account", revision: "v1" }],
    },
  );
  const environment = {
    id: "owned-environment",
    revision: "v1",
    approvedOrigin: new URL(PARTAY_LOGIN_URL).origin,
  };
  const request: RuntimeLoginRequest = {
    scope: {
      projectId: "owned-project",
      runId: "owned-run",
      scenarioId: "owned-login",
      dataBinding: references.binding,
      environment,
    },
    account: { id: "owned-account", revision: "v1" },
    expiresAt: Date.now() + 60_000,
  };
  const descriptor: PreparedInputDescriptor = {
    version: 1,
    environment: { ...environment, initialTargetUrl: PARTAY_LOGIN_URL },
    review: {
      sourceRevision: "owned-v1",
      featureRevision: "owned-v1",
      implementationRevision: "owned-v1",
    },
    fixturePolicy: { id: "owned-policy", revision: "v1" },
    fixtureRevision: "owned-v1",
    dataReferences: references,
    scenarios: [
      {
        id: "owned-login",
        tags: ["@RRDWEB-8-login-S01"],
        values: { displayName: "Owned fixture" },
        dataReference: references.rows[0],
        account: {
          reference: "owned-account",
          secretReference: { id: "owned-account" },
        },
        cleanup: {
          requested: true,
          authorizationStatus: "unverified",
          reference: "owned-cleanup",
          requestedRevision: "v1",
          outcome: "unknown",
        },
      },
    ],
  };
  return { descriptor, request };
}
