import assert from "node:assert/strict";
import { Server } from "node:http";
import { mock } from "node:test";
import { chromium } from "@playwright/test";
import {
  Given,
  When,
  Then,
  World,
  setWorldConstructor,
  setDefaultTimeout,
} from "@cucumber/cucumber";
import { executeAdapter, type AdapterResult } from "../../src/adapter/v1";
import {
  executeReviewedScenarios,
  type ExecutionSummary,
} from "../../src/execution";
import { examples } from "./examples";
import { installedPackageSmoke } from "../../scripts/installed-adapter-smoke";

class AdapterWorld extends World {
  example = examples();
  result?: AdapterResult;
  direct?: ExecutionSummary;
  acquisitions = -1;
}
setWorldConstructor(AdapterWorld);
setDefaultTimeout(120000);

function executed(world: AdapterWorld) {
  const result = world.result;
  assert.ok(result?.accepted);
  return result;
}

Given(
  "the pinned compatible local adapter example",
  function (this: AdapterWorld) {
    this.example = examples();
  },
);
When("the owner runs the adapter", async function (this: AdapterWorld) {
  this.result = await executeAdapter(
    this.example.request,
    this.example.context,
  );
});
Then(
  "the synthetic visitor steps pass and retain the central run reference",
  function (this: AdapterWorld) {
    const result = executed(this);
    assert.equal(result.report.status, "passed");
    assert.deepEqual(result.run, this.example.request.run);
    assert.equal(result.callerId, this.example.context.callerId);
    assert.equal(result.report.scenarios[0].scenarioId, "browser-flow");
    assert.equal(result.report.scenarios[0].steps.length, 3);
    assert.ok(
      result.report.scenarios[0].steps.every(
        (step) => step.status === "passed",
      ),
    );
  },
);
When("an external target is requested", async function (this: AdapterWorld) {
  const browser = mock.method(chromium, "launchServer", () => {
    throw new Error("Unexpected browser");
  });
  const server = mock.method(Server.prototype, "listen", () => {
    throw new Error("Unexpected server");
  });
  try {
    this.result = await executeAdapter(
      { ...this.example.request, target: "https://external.invalid" },
      this.example.context,
    );
    this.acquisitions = browser.mock.callCount() + server.mock.callCount();
  } finally {
    browser.mock.restore();
    server.mock.restore();
  }
});
Then(
  "the request is rejected without acquiring a server or browser",
  function (this: AdapterWorld) {
    assert.equal(this.result?.accepted, false);
    assert.equal(this.acquisitions, 0);
  },
);
When(
  "the owned long action exceeds its boundary",
  async function (this: AdapterWorld) {
    this.example = examples(["timeout-flow"]);
    this.example.request.limits.scenarioTimeoutMs = 1500;
    this.result = await executeAdapter(
      this.example.request,
      this.example.context,
    );
  },
);
Then(
  "serialization retains the timeout attempt and honest restoration status",
  function (this: AdapterWorld) {
    const result = JSON.parse(JSON.stringify(executed(this))) as ReturnType<
      typeof executed
    >;
    assert.equal(result.report.status, "timed_out");
    assert.equal(result.report.attempts[0].status, "timed_out");
    assert.equal(result.lifecycle.resourceCleanup.status, "confirmed");
    assert.deepEqual(result.lifecycle.dataRestoration, {
      status: "unknown",
      operationPerformed: false,
    });
    assert.equal(
      result.lifecycle.attempts[0].resourceCleanup.browserProcessStopped,
      true,
    );
  },
);
When(
  "the tarball is installed outside the checkout",
  async function (this: AdapterWorld) {
    this.result = await installedPackageSmoke();
  },
);
Then(
  "its versioned export runs the synthetic visitor without a portal account",
  function (this: AdapterWorld) {
    assert.equal(executed(this).report.status, "passed");
    assert.deepEqual(executed(this).run, this.example.request.run);
  },
);
When(
  "the owner compares adapter and direct execution",
  async function (this: AdapterWorld) {
    this.result = await executeAdapter(
      this.example.request,
      this.example.context,
    );
    this.direct = await executeReviewedScenarios({
      scenarioIds: ["browser-flow"],
    });
  },
);
Then(
  "the business steps and cleanup match without claiming data restoration",
  function (this: AdapterWorld) {
    const result = executed(this);
    assert.equal(result.report.status, this.direct?.status);
    assert.deepEqual(
      result.report.scenarios[0].steps,
      this.direct?.scenarios[0].cucumber?.steps,
    );
    assert.deepEqual(
      result.lifecycle.resourceCleanup,
      this.direct?.resourceCleanup && {
        status: this.direct.resourceCleanup.status,
        failures: this.direct.resourceCleanup.failures,
        browserProcessStopped:
          this.direct.resourceCleanup.browserProcessStopped,
        blockedTargetRequestCount:
          this.direct.resourceCleanup.blockedTargetRequestCount,
      },
    );
    assert.deepEqual(
      result.lifecycle.dataRestoration,
      this.direct?.dataRestoration,
    );
  },
);
