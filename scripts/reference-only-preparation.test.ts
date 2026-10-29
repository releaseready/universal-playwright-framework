import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareScenarioInputs, validateFeatureFile } from "../src/index";
import { reviewDataReferences } from "../src/input-preparation/data-references";

test("Given a reviewed reference-only scenario, preparation preserves its empty policy and verified secret revision", async () => {
  const directory = mkdtempSync(join(tmpdir(), "web6-reference-only-"));
  try {
    writeFileSync(
      join(directory, "login.feature"),
      "Feature: Owned login\n  @scenario-id=owned-login\n  Scenario: One login\n    Given the owned login journey\n",
    );
    const validation = await validateFeatureFile({
      workspaceRoot: directory,
      featurePath: "login.feature",
      sourceRevision: "owned-source-v1",
      manifest: {
        implementationRevision: "owned-implementation-v1",
        steps: [{ id: "owned-login", expression: "the owned login journey" }],
      },
    });
    assert.equal(validation.valid, true);
    if (!validation.valid) throw new Error("Owned feature invalid");
    const approval = {
      ...validation,
      scenarios: validation.scenarios.map((s) => ({ id: s.id!, tags: s.tags })),
    };
    const catalogue = {
      datasets: [{ id: "owned-data", revision: "v1", rows: ["owned-row"] }],
      secrets: [{ id: "owned-secret", revision: "v7" }],
    };
    const selection = {
      version: 1 as const,
      rows: [
        {
          scenarioId: "owned-login",
          dataset: { id: "owned-data", revision: "v1" },
          rowId: "owned-row",
          secret: { id: "owned-secret", revision: "v7" },
        },
      ],
    };
    const reviewed = reviewDataReferences(selection, catalogue);
    const environment = {
      id: "owned-env",
      revision: "1",
      approvedOrigin: "https://owned.example.test",
      initialTargetUrl: "https://owned.example.test/",
    };
    const policy = {
      version: 1 as const,
      id: "owned-empty-fields",
      revision: "v1",
      sharedFields: {},
      scenarioFields: { "owned-login": {} },
    };
    const input = {
      version: 1,
      fixtureRevision: "v1",
      environment,
      accounts: [{ reference: "owned-row", secretReference: "owned-secret" }],
      scenarios: [
        {
          id: "owned-login",
          values: {},
          dataReference: selection.rows[0],
          accountReference: "owned-row",
          cleanup: {
            reference: "owned-browser-only",
            authorizationRevision: "v1",
            requested: true,
          },
        },
      ],
    };
    const { scenarioId: _scenarioId, ...row } = selection.rows[0];
    void _scenarioId;
    const fixture = {
      ...input,
      scenarios: [{ ...input.scenarios[0], dataReference: row }],
    };
    const data = {
      selection,
      approvedCatalogue: catalogue,
      binding: reviewed.binding,
      approvedEnvironment: {
        id: environment.id,
        revision: environment.revision,
        approvedOrigin: environment.approvedOrigin,
      },
    };
    const prepare = (
      candidate: unknown = fixture,
      fields: unknown = policy,
      review = approval,
    ) =>
      prepareScenarioInputs(
        JSON.stringify(candidate),
        validation,
        review,
        fields as typeof policy,
        undefined,
        data,
      );
    const result = prepare();
    assert.deepEqual(result.scenarios[0].values, {});
    assert.deepEqual(result.scenarios[0].account.secretReference, {
      id: "owned-secret",
      revision: "v7",
    });
    assert.equal(result.scenarios[0].cleanup.authorizationStatus, "unverified");
    assert.equal(result.scenarios[0].cleanup.outcome, "unknown");
    for (const fields of [
      null,
      {},
      { ...policy, scenarioFields: {} },
      { ...policy, sharedFields: { required: { type: "boolean" } } },
    ]) {
      assert.throws(() => prepare(fixture, fields), /policy|fields/i);
    }
    assert.throws(() =>
      prepare({
        ...fixture,
        scenarios: [
          {
            ...fixture.scenarios[0],
            values: {
              unexpected: { classification: "non-sensitive", value: true },
            },
          },
        ],
      }),
    );
    assert.throws(() =>
      prepare({
        ...fixture,
        scenarios: [
          {
            ...fixture.scenarios[0],
            dataReference: {
              ...row,
              secret: { id: "owned-secret", revision: "unreviewed" },
            },
          },
        ],
      }),
    );
    assert.throws(() =>
      prepare(fixture, policy, { ...approval, featureRevision: "stale" }),
    );
    assert.throws(() =>
      prepare({
        ...fixture,
        scenarios: [{ ...fixture.scenarios[0], values: undefined }],
      }),
    );
    assert.throws(
      () =>
        prepare({
          ...fixture,
          accounts: [
            { reference: "owned-row", secretReference: "other-secret" },
          ],
        }),
      { code: "invalid-account-reference" },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
