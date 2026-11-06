import { runtimePackagePath } from "../src/execution/reviewed-scenarios";
import childProcess, { type SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright-core";
import {
  executeOwnedLocalAdapter,
  getOwnedLocalReview,
  validateOwnedLocalEvidence,
  type OwnedLocalRequest,
} from "../src/adapter/v2";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, mock } from "node:test";
import {
  parseOwnedEvidence,
  readOwnedEvidence,
} from "../src/execution/owned-evidence";

const root = path.resolve(__dirname, "../../..");
const formatter = path.join(
  root,
  "dist/cucumber/src/execution/owned-evidence-formatter.js",
);
const names = [
  "the synthetic reviewed page is open",
  "I explore the owned local demo",
  "the owned local demo shows its synthetic workspace and project",
  "I return from the owned local demo to sign in",
  "the owned local sign in page is visible",
];
function configureFixture(directory: string, mode: string) {
  const support = path.join(directory, "steps.cjs");
  writeFileSync(
    support,
    `
      const {Given} = require(${JSON.stringify(require.resolve("@cucumber/cucumber"))});
      const names = ${JSON.stringify(names)};
      names.forEach((name, index) => Given(name, function () {
        if (${JSON.stringify(mode)} === "interrupted" && index === 2) process.exit(23);
        if (${JSON.stringify(mode)} === "business-failure" && index === 2) throw Error("SYNTHETIC_PRIVATE_CANARY");
      }));
      const Module = require("node:module");
      const originalLoad = Module._load;
      const browser = {
        newContext: async () => ({
          routeWebSocket: async () => {}, addInitScript: async () => {}, route: async () => {},
          newPage: async () => ({ setDefaultTimeout() {}, setDefaultNavigationTimeout() {} }),
          close: async () => { throw Error("SYNTHETIC_PRIVATE_CANARY"); },
        }),
        close: async () => {},
      };
      try {
        Module._load = function (name, ...args) {
          if(name === "@playwright/test") return {chromium: {connect: async () => browser}};
          return originalLoad.call(this, name, ...args);
        };
        require(${JSON.stringify(path.join(root, "dist/cucumber/features/execution/support/hooks.js"))});
      } finally { Module._load = originalLoad; }
    `,
  );
  const config = path.join(directory, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      default: {
        paths: ["fixtures/execution/reviewed-scenarios.feature"],
        require: [support],
        tags: "@scenario-id=local-demo-navigation",
      },
    }),
  );
  return config;
}
function runFixture(mode: string) {
  const directory = mkdtempSync(
    path.join(tmpdir(), "rr139-teardown-evidence-"),
  );
  const snapshot = path.join(directory, "safe.json");
  const report = path.join(directory, "cucumber.json");
  const marker = path.join(directory, "cleanup.json");
  try {
    const config = configureFixture(directory, mode);
    // Keep this fixture usable against the parent tree for a real red baseline.
    const formats = existsSync(formatter)
      ? ["--format", `${formatter}:${snapshot}`]
      : [];
    const child = spawnSync(
      process.execPath,
      [
        path.join(
          path.dirname(runtimePackagePath("@cucumber/cucumber")),
          "bin/cucumber.js",
        ),
        "--config",
        path.relative(root, config),
        "--format",
        `json:${report}`,
        ...formats,
      ],
      {
        cwd: root,
        timeout: 10000,
        stdio: "ignore",
        env: {
          ...process.env,
          WEB_EXECUTION_PAYLOAD: JSON.stringify({
            scenario: {
              id: "local-demo-navigation",
              values: { displayName: "Synthetic" },
            },
            environment: {
              initialTargetUrl: "http://127.0.0.1:3001/",
              approvedOrigin: "http://127.0.0.1:3001",
            },
            redirectTargetUrl: "http://127.0.0.1:3002/",
          }),
          WEB_EXECUTION_BROWSER_ENDPOINT: "ws://127.0.0.1:3003",
          WEB_EXECUTION_CLEANUP_PATH: marker,
        },
      },
    );
    assert.equal(child.error, undefined);

    if (mode !== "interrupted")
      assert.deepEqual(JSON.parse(readFileSync(marker, "utf8")), {
        status: "unknown",
        failures: ["context-close"],
        injectedFailure: false,
      });
    assert.equal(
      child.status,
      mode === "interrupted" ? 23 : 1,
      "original worker failure is preserved",
    );
    assert.throws(
      () => JSON.parse(readFileSync(report, "utf8")),
      "AfterAll failure prevents normal JSON finalization",
    );
    return existsSync(snapshot) ? readFileSync(snapshot, "utf8") : "";
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("completed business evidence survives a failing After and AfterAll without raw errors", () => {
  const raw = runFixture("cleanup-failure");
  const snapshot = JSON.parse(raw);
  assert.deepEqual(
    snapshot.steps,
    names.map(() => "passed"),
  );
  assert.equal(raw.includes("SYNTHETIC_PRIVATE_CANARY"), false);
  assert.ok(Buffer.byteLength(raw) <= 1024);
});

test("failed business steps remain failed while later steps stay skipped", () => {
  const raw = runFixture("business-failure");
  assert.deepEqual(
    parseOwnedEvidence(raw, "local-demo-navigation")?.steps.map(
      (step) => step.status,
    ),
    ["passed", "passed", "failed", "skipped", "skipped"],
  );
  assert.equal(raw.includes("SYNTHETIC_PRIVATE_CANARY"), false);
});

test("interruption before testCaseFinished supplies no completed-case evidence", () => {
  assert.equal(
    parseOwnedEvidence(runFixture("interrupted"), "local-demo-navigation"),
    undefined,
  );
});

test("partial, repeated, mismatched and oversized snapshots fail closed", () => {
  const valid = JSON.stringify({
    schemaVersion: 1,
    scenarioId: "local-demo-navigation",
    steps: names.map(() => "passed"),
  });
  assert.equal(parseOwnedEvidence(valid, "browser-flow"), undefined);
  for (const raw of [
    "",
    "{",
    valid + valid,
    valid.replace('"passed"', '"forged"'),
    valid.replace("schemaVersion", "unexpected"),
    JSON.stringify({
      schemaVersion: 1,
      scenarioId: "local-demo-navigation",
      steps: ["passed"],
    }),
    " ".repeat(1025) + valid,
  ]) {
    assert.equal(parseOwnedEvidence(raw, "local-demo-navigation"), undefined);
  }
});

test("snapshot reader rejects unsafe filesystem types and size before reading", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rr139-evidence-input-"));
  try {
    const file = path.join(directory, "evidence"),
      link = path.join(directory, "link"),
      fifo = path.join(directory, "fifo");
    writeFileSync(file, "x".repeat(1025));
    symlinkSync(file, link);
    assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
    // Bound any accidental FIFO blocking in a subprocess rather than the test runner.
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const assert=require("node:assert/strict");
      const {readOwnedEvidence}=require(${JSON.stringify(path.join(root, "dist/cucumber/src/execution/owned-evidence.js"))});
      for(const file of ${JSON.stringify([file, link, fifo, directory])}) assert.equal(readOwnedEvidence(file,"local-demo-navigation"),undefined);
    `,
      ],
      { timeout: 3000, stdio: "ignore" },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0);
    assert.equal(
      readOwnedEvidence(
        path.join(directory, "missing"),
        "local-demo-navigation",
      ),
      undefined,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v2 runner retains completed steps and operational failure after actual hooks reject", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rr139-runner-evidence-"));
  const config = configureFixture(directory, "cleanup-failure");
  const originalSpawn = childProcess.spawn;
  // Owned inert child stands in for the browser process; no browser is launched.
  const browserChild = originalSpawn(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { stdio: "ignore" },
  );
  const exited = once(browserChild, "exit");
  const launch = mock.method(
    chromium,
    "launchServer",
    async () =>
      ({
        process: () => browserChild,
        wsEndpoint: () => "ws://127.0.0.1:3003",
        close: async () => {
          browserChild.kill();
          await exited;
        },
        kill: async () => {
          browserChild.kill("SIGKILL");
          await exited;
        },
      }) as never,
  );
  const worker = mock.method(
    childProcess,
    "spawn",
    (command: string, args: readonly string[], options: SpawnOptions) => {
      const argv = [...args];
      const index = argv.indexOf("--config");
      assert.ok(index > 0, "only the Cucumber worker is substituted");
      argv[index + 1] = path.relative(root, config);
      return originalSpawn(command, argv, options);
    },
  );
  try {
    const review = await getOwnedLocalReview();
    const request: OwnedLocalRequest = {
      version: 2,
      run: { id: "synthetic-run", gitRevision: "a".repeat(40) },
      target: {
        kind: "owned-local",
        id: "synthetic-target",
        origin: "http://127.0.0.1:34567",
      },
      scenarioIds: ["local-demo-navigation"],
      binding: {
        tenantId: "synthetic-tenant",
        projectId: "synthetic-project",
        environmentId: "synthetic-dev",
        caseId: "synthetic-case",
        caseRevision: 1,
        caseSourceHash: "b".repeat(64),
        dataRevision: "c".repeat(64),
        configurationRevision: "d".repeat(64),
        implementationRevision: review.approval.implementationRevision,
        approvalId: "synthetic-approval",
        attempt: 1,
      },
      ...review,
      limits: {
        runTimeoutMs: 20000,
        scenarioTimeoutMs: 15000,
        maxConcurrentScenarios: 1,
        retryCount: 0,
      },
    };
    let admissions = 0;
    const result = await executeOwnedLocalAdapter(
      request,
      {
        version: 2,
        authorization: "owned-local",
        callerId: "synthetic-owner",
        request,
        approval: { active: true, expiresAt: Date.now() + 60000 },
      },
      undefined,
      async () => {
        admissions++;
      },
    );
    assert.equal(admissions, 1);
    assert.equal(result.accepted, true);
    if (!result.accepted) throw new Error("Expected accepted execution");
    assert.equal(validateOwnedLocalEvidence(request, result), true);
    assert.equal(result.report.status, "incomplete");
    assert.equal(result.report.scenarios[0].status, "incomplete");
    assert.equal(result.report.scenarios[0].evidenceStatus, "available");
    assert.equal(result.report.scenarios[0].executionState, "executed");
    assert.deepEqual(
      result.report.scenarios[0].steps.map((step) => step.status),
      names.map(() => "passed"),
    );
    assert.deepEqual(
      result.lifecycle.attempts[0].scenarios[0].cleanupFailures,
      ["context-close"],
    );
    assert.equal(result.lifecycle.attempts[0].scenarios[0].workerStopped, true);
    // Existing engine behavior: process termination confirms resource cleanup,
    // while the earlier context-close failure and incomplete outcome stay visible.
    assert.equal(result.lifecycle.resourceCleanup.status, "confirmed");
    assert.equal(result.lifecycle.resourceCleanup.browserProcessStopped, true);
    assert.equal(
      JSON.stringify(result).includes("SYNTHETIC_PRIVATE_CANARY"),
      false,
    );
  } finally {
    worker.mock.restore();
    launch.mock.restore();
    if (browserChild.exitCode === null && browserChild.signalCode === null)
      browserChild.kill("SIGKILL");
    await exited;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("formatter refuses identity mismatch, incomplete results and retries; emits once", async () => {
  const { EventEmitter } = await import("node:events");
  const { default: OwnedEvidenceFormatter } = await import(
    "../src/execution/owned-evidence-formatter"
  );
  const base = {
    attempt: 0,
    willBeRetried: false,
    pickle: {
      uri: "fixtures/execution/reviewed-scenarios.feature",
      name: "A visitor explores the owned local demo and returns to sign in",
      tags: [{ name: "@scenario-id=local-demo-navigation" }],
      steps: names.map((text, i) => ({ id: String(i), text })),
    },
    gherkinDocument: {
      feature: { name: "Execute reviewed synthetic scenarios" },
    },
    testCase: {
      testSteps: names.map((_, i) => ({
        id: String(i),
        pickleStepId: String(i),
      })),
    },
    stepResults: Object.fromEntries(
      names.map((_, i) => [
        String(i),
        { status: "PASSED", message: "SYNTHETIC_PRIVATE_CANARY" },
      ]),
    ),
  };
  const variants = [
    { ...base, willBeRetried: true },
    { ...base, attempt: 1 },
    { ...base, pickle: { ...base.pickle, uri: "unapproved" } },
    { ...base, pickle: { ...base.pickle, name: "SYNTHETIC_PRIVATE_CANARY" } },
    { ...base, pickle: { ...base.pickle, steps: base.pickle.steps.slice(1) } },
    { ...base, stepResults: {} },
  ];
  for (const attempt of [...variants, base]) {
    const events = new EventEmitter(),
      output: string[] = [];
    new OwnedEvidenceFormatter({
      parsedArgvOptions: {},
      eventBroadcaster: events,
      eventDataCollector: { getTestCaseAttempt: () => attempt },
      log: (line: string) => output.push(line),
    } as never);
    events.emit("envelope", {
      testCaseFinished: { testCaseStartedId: "synthetic" },
    });
    events.emit("envelope", {
      testCaseFinished: { testCaseStartedId: "synthetic" },
    });
    assert.equal(output.length, attempt === base ? 1 : 0);
    assert.equal(output.join("").includes("SYNTHETIC_PRIVATE_CANARY"), false);
  }
});

test("new source and runtime helpers are fingerprinted; changed artifacts reject stale review", async () => {
  const { calculateReviewedImplementationRevision, loadReviewedScenarios } =
    await import("../src/execution/reviewed-scenarios");
  await loadReviewedScenarios();
  const baseline = calculateReviewedImplementationRevision();
  for (const file of [
    "src/execution/owned-evidence.ts",
    "src/execution/owned-evidence-formatter.ts",
    "dist/cucumber/src/execution/owned-evidence.js",
    "dist/cucumber/src/execution/owned-evidence-formatter.js",
  ]) {
    const full = path.join(root, file),
      original = readFileSync(full);
    try {
      writeFileSync(
        full,
        Buffer.concat([
          original,
          Buffer.from("\n// synthetic identity mutation\n"),
        ]),
      );
      assert.notEqual(calculateReviewedImplementationRevision(), baseline);
      await assert.rejects(loadReviewedScenarios(), /review is stale/);
    } finally {
      writeFileSync(full, original);
    }
    assert.equal(calculateReviewedImplementationRevision(), baseline);
  }
});
