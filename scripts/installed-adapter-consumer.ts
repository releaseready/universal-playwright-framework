import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
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
  const runnerRequire = createRequire(
    requireFromConsumer.resolve("@cucumber/cucumber"),
  );
  assert.equal(
    runnerRequire.resolve("@cucumber/cucumber-expressions"),
    requireFromConsumer.resolve("@cucumber/cucumber-expressions"),
  );
  const framework = requireFromConsumer("@universal/playwright-framework") as {
    executeAdapter: typeof executeAdapter;
    TestDataFactory: {
      generateUser: typeof import("../fixtures/test-data-factory").TestDataFactory.generateUser;
    };
  };
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
