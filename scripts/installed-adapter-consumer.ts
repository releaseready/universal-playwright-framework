import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mock } from "node:test";
import { examples } from "../features/adapter/examples";
import rejectedExample from "../fixtures/adapter/v1-rejected.json";
import type { executeAdapter } from "../src/adapter/v1";

async function main(): Promise<void> {
  const requireFromConsumer = createRequire(
    path.join(process.cwd(), "package.json"),
  );
  const exportPath = requireFromConsumer.resolve(
    "@universal/playwright-framework/adapter/v1",
  );
  const installedRoot = path.join(process.cwd(), "node_modules");
  assert.ok(
    realpathSync(exportPath).startsWith(
      `${realpathSync(installedRoot)}${path.sep}`,
    ),
  );
  for (const name of [
    "@cucumber/cucumber",
    "@cucumber/gherkin",
    "@cucumber/cucumber-expressions",
    "@playwright/test",
    "playwright",
    "playwright-core",
    "zod",
  ]) {
    const dependency = requireFromConsumer.resolve(name);
    assert.ok(
      realpathSync(dependency).startsWith(
        `${realpathSync(installedRoot)}${path.sep}`,
      ),
    );
  }
  const dataExport = requireFromConsumer.resolve(
    "@universal/playwright-framework/data-references/v1",
  );
  assert.ok(
    realpathSync(dataExport).startsWith(
      `${realpathSync(installedRoot)}${path.sep}`,
    ),
  );
  const dataReferences = requireFromConsumer(
    "@universal/playwright-framework/data-references/v1",
  ) as typeof import("../src/input-preparation/data-references");
  const catalogue = {
    datasets: [{ id: "owned-demo", revision: "v1", rows: ["row-a", "row-b"] }],
    secrets: [{ id: "synthetic-account", revision: "v1" }],
  };
  const selection = {
    version: 1,
    rows: ["row-a", "row-b"].map((rowId) => ({
      scenarioId: `outline/${rowId}`,
      dataset: { id: "owned-demo", revision: "v1" },
      rowId,
      secret: { id: "synthetic-account", revision: "v1" },
    })),
  };
  const reviewed = dataReferences.reviewDataReferences(selection, catalogue);
  assert.deepEqual(
    reviewed.rows.map((row) => row.rowId),
    ["row-a", "row-b"],
  );
  assert.deepEqual(
    dataReferences.verifyDataReferenceBinding(
      selection,
      catalogue,
      reviewed.binding,
    ),
    reviewed,
  );
  assert.throws(
    () =>
      dataReferences.reviewDataReferences(
        { ...selection, secretValue: "SYNTHETIC_PRIVATE_VALUE_83" },
        catalogue,
      ),
    { message: "Data references are missing, invalid or unapproved" },
  );
  catalogue.datasets[0].revision = "v2";
  selection.rows.forEach((row) => {
    row.dataset.revision = "v2";
  });
  assert.throws(
    () =>
      dataReferences.verifyDataReferenceBinding(
        selection,
        catalogue,
        reviewed.binding,
      ),
    /Data reference review is stale/,
  );
  const runnerRequire = createRequire(
    requireFromConsumer.resolve("@cucumber/cucumber"),
  );
  assert.equal(
    runnerRequire.resolve("@cucumber/cucumber-expressions"),
    requireFromConsumer.resolve("@cucumber/cucumber-expressions"),
  );
  const framework = requireFromConsumer("@universal/playwright-framework") as {
    executeAdapter: typeof executeAdapter;
    InMemoryRuntimeSecretProvider: typeof import("../src/input-preparation/runtime-login").InMemoryRuntimeSecretProvider;
    consumeRuntimeLoginInputs: typeof import("../src/input-preparation/runtime-login").consumeRuntimeLoginInputs;
    withOperatorLoginInputs: typeof import("../src/input-preparation/operator-prompt").withOperatorLoginInputs;
    TestDataFactory: {
      generateUser: typeof import("../fixtures/test-data-factory").TestDataFactory.generateUser;
    };
  };
  assert.equal(typeof framework.consumeRuntimeLoginInputs, "function");
  assert.equal(typeof framework.withOperatorLoginInputs, "function");
  const runtimeScope = {
    projectId: "owned-project",
    runId: "owned-run",
    scenarioId: "outline/row-a",
    dataBinding: reviewed.binding,
    environment: {
      id: "owned-environment",
      revision: "environment-v1",
      approvedOrigin: "https://owned.example.test",
    },
  };
  const accountReference = { id: "owned-account", revision: "account-v1" };
  const runtimeProvider = new framework.InMemoryRuntimeSecretProvider(
    {
      scope: runtimeScope,
      account: accountReference,
      expiresAt: Date.now() + 60_000,
    },
    {
      username: "SYNTHETIC_INSTALLED_ACCOUNT",
      password: "SYNTHETIC_INSTALLED_PASSWORD",
    },
  );
  try {
    assert.equal(
      await runtimeProvider.resolve(
        { ...accountReference, field: "password" },
        runtimeScope,
      ),
      "SYNTHETIC_INSTALLED_PASSWORD",
    );
    assert.doesNotMatch(JSON.stringify(runtimeProvider), /SYNTHETIC_INSTALLED/);
  } finally {
    runtimeProvider.dispose();
  }
  const user = framework.TestDataFactory.generateUser("band");
  assert.equal(user.userType, "band");
  assert.ok(user.bandMembers && user.bandMembers.length > 0);
  assert.ok(user.firstName && user.lastName && user.email);
  const adapter = requireFromConsumer(
    "@universal/playwright-framework/adapter/v1",
  ) as { executeAdapter: typeof executeAdapter };
  assert.equal(framework.executeAdapter, adapter.executeAdapter);
  const { request, context } = examples();
  const rejected = await adapter.executeAdapter(rejectedExample, context);
  assert.equal(rejected.accepted, false);
  const result = await adapter.executeAdapter(request, context);
  assert.ok(result.accepted, JSON.stringify(result));
  assert.equal(result.report.status, "passed");
  assert.equal(result.report.scenarios[0].scenarioId, "browser-flow");
  assert.equal(result.report.scenarios[0].steps.length, 3);
  assert.equal(result.lifecycle.resourceCleanup.browserProcessStopped, true);
  assert.deepEqual(result.run, request.run);
  assert.equal(result.callerId, context.callerId);
  assert.notEqual(result.report.runReference, request.run.id);
  assert.deepEqual(result.approval, request.approval);
  assert.deepEqual(result.inputs, request.inputs);

  const failedExample = examples(["assertion-failure"]);
  failedExample.request.limits.retryCount = 0;
  const failed = await adapter.executeAdapter(
    failedExample.request,
    failedExample.context,
  );
  assert.ok(failed.accepted, JSON.stringify(failed));
  if (!failed.accepted) throw new Error("Expected an admitted synthetic run");
  assert.equal(failed.report.status, "failed");
  assert.equal(failed.report.attempts.length, 1);
  assert.equal(failed.report.attempts[0].status, "failed");
  assert.equal(failed.lifecycle.attempts.length, 1);
  assert.equal(failed.lifecycle.resourceCleanup.status, "confirmed");
  assert.equal(failed.lifecycle.dataRestoration.status, "unknown");
  assert.deepEqual(failed.run, failedExample.request.run);
  assert.equal(failed.callerId, failedExample.context.callerId);
  assert.deepEqual(failed.approval, failedExample.request.approval);
  assert.deepEqual(failed.inputs, failedExample.request.inputs);

  const adapterRequire = createRequire(
    requireFromConsumer.resolve("@universal/playwright-framework/adapter/v1"),
  );
  const execution = adapterRequire(
    "../execution",
  ) as typeof import("../src/execution");
  const uncertainExample = examples();
  const executionFailure = mock.method(
    execution,
    "executeReviewedScenarios",
    async () => {
      throw new Error("SYNTHETIC_PRIVATE_ENGINE_DIAGNOSTIC");
    },
  );
  try {
    const uncertain = await adapter.executeAdapter(
      uncertainExample.request,
      uncertainExample.context,
    );
    assert.ok(uncertain.accepted, JSON.stringify(uncertain));
    if (!uncertain.accepted)
      throw new Error("Expected an admitted synthetic run");
    assert.equal(uncertain.report.status, "incomplete");
    assert.equal(uncertain.report.attempts.length, 0);
    assert.equal(uncertain.lifecycle.resourceCleanup.status, "unknown");
    assert.equal(
      uncertain.lifecycle.resourceCleanup.browserProcessStopped,
      null,
    );
    assert.equal(uncertain.lifecycle.attempts.length, 0);
    assert.equal(uncertain.lifecycle.dataRestoration.status, "unknown");
    assert.deepEqual(uncertain.run, uncertainExample.request.run);
    assert.equal(uncertain.callerId, uncertainExample.context.callerId);
    assert.deepEqual(uncertain.approval, uncertainExample.request.approval);
    assert.deepEqual(uncertain.inputs, uncertainExample.request.inputs);
    assert.equal(executionFailure.mock.callCount(), 1);
    assert.doesNotMatch(
      JSON.stringify(uncertain),
      /SYNTHETIC_PRIVATE_ENGINE_DIAGNOSTIC|Error:|node_modules/,
    );
  } finally {
    executionFailure.mock.restore();
  }

  // Tampering with the installed worker must invalidate approval, not self-approve.
  const worker = path.join(path.dirname(exportPath), "../execution/index.js");
  const original = readFileSync(worker);
  try {
    writeFileSync(worker, Buffer.concat([original, Buffer.from("\n")]));
    const stale = await adapter.executeAdapter(request, context);
    assert.equal(stale.accepted, false);
    if (!stale.accepted) assert.equal(stale.error.code, "STALE_REVIEW");
  } finally {
    writeFileSync(worker, original);
  }
  process.stdout.write(JSON.stringify(result));
}
void main();
