import { randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";
import { chromium, type BrowserServer } from "@playwright/test";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  prepareScenarioInputs,
  type PreparedInputDescriptor,
} from "../input-preparation";
import { selectApprovedScenarios } from "../validation/scenario-selector";
import {
  INPUT_FIXTURE_PATH,
  loadReviewedScenarios,
  REPOSITORY_ROOT,
  reviewedFixturePolicy,
} from "./reviewed-scenarios";

export const MAX_EXECUTION_SCENARIOS = 6;
export const MAX_CONCURRENT_SCENARIOS = 2;
export const MAX_SCENARIO_TIMEOUT_MS = 60_000;
export const MAX_RUN_TIMEOUT_MS = 120_000;
export const MAX_EXECUTION_RETRIES = 2;

export type ExecutionStatus =
  | "passed"
  | "passed_after_retry"
  | "failed"
  | "incomplete"
  | "timed_out"
  | "cancelled";
export type ResourceCleanupStatus =
  | "not_required"
  | "confirmed"
  | "failed"
  | "unknown";
type WorkerStopReason =
  | "scenario-timeout"
  | "run-timeout"
  | "cancelled"
  | "cleanup-unknown";

export interface ScenarioExecutionResult {
  readonly scenarioId: string;
  readonly status: ExecutionStatus;
  readonly cleanupStatus: ResourceCleanupStatus;
  readonly cleanupFailures: readonly string[];
  readonly cleanupFaultInjected: boolean;
  readonly workerStopped: boolean;
  readonly workerStallInjected: boolean;
}

export interface ExecutionSummary {
  readonly diagnosticReference: string;
  readonly status: ExecutionStatus;
  readonly resourceCleanup: {
    readonly status: ResourceCleanupStatus;
    readonly failures: readonly string[];
    readonly browserProcessStopped: boolean | null;
    readonly blockedTargetRequestCount: number;
    readonly injectedPendingCleanup: boolean;
  };
  readonly dataRestoration: {
    readonly status: "unknown";
    readonly operationPerformed: false;
  };
  readonly scenarios: readonly ScenarioExecutionResult[];
  readonly attemptCount: number;
  readonly attempts: readonly ExecutionAttemptSummary[];
}

export interface ExecutionAttemptSummary {
  readonly attemptNumber: number;
  readonly diagnosticReference: string;
  readonly status: ExecutionStatus;
  readonly resourceCleanup: ExecutionSummary["resourceCleanup"];
  readonly dataRestoration: ExecutionSummary["dataRestoration"];
  readonly scenarios: readonly ScenarioExecutionResult[];
  readonly injectedFailure: boolean;
}

export interface ExecutionOptions {
  readonly scenarioIds?: readonly string[];
  readonly runTimeoutMs?: number;
  readonly scenarioTimeoutMs?: number;
  readonly maxConcurrentScenarios?: number;
  readonly retryCount?: number;
  readonly signal?: AbortSignal;
  readonly testCleanupFailure?: "context" | "server-pending" | "worker-stall";
  readonly testFailAttempts?: readonly number[];
  readonly onBrowserProcessStarted?: (pid: number) => void;
}

interface SingleExecutionSummary {
  readonly diagnosticReference: string;
  readonly status: ExecutionStatus;
  readonly resourceCleanup: ExecutionSummary["resourceCleanup"];
  readonly dataRestoration: ExecutionSummary["dataRestoration"];
  readonly scenarios: readonly ScenarioExecutionResult[];
}

interface FixtureDocument {
  readonly environment: {
    approvedOrigin: string;
    initialTargetUrl: string;
  };
  accounts: { reference: string }[];
  scenarios: { id: string; accountReference: string }[];
}

interface WorkerPayload {
  readonly scenario: {
    readonly id: string;
    readonly values: PreparedInputDescriptor["scenarios"][number]["values"];
  };
  readonly environment: PreparedInputDescriptor["environment"];
  readonly redirectTargetUrl: string;
}

interface CleanupReport {
  readonly status: ResourceCleanupStatus;
  readonly failures: readonly string[];
  readonly injectedFailure: boolean;
}

interface BrowserStopResult {
  readonly stopped: boolean;
  readonly injectedPendingClose: boolean;
}

const CUCUMBER_BIN = path.join(
  REPOSITORY_ROOT,
  "node_modules/@cucumber/cucumber/bin/cucumber.js",
);
const CUCUMBER_CONFIG = "cucumber-execution.json";
const DEFAULT_RUN_TIMEOUT_MS = 90_000;
const DEFAULT_SCENARIO_TIMEOUT_MS = 30_000;

function validateOptions(options: ExecutionOptions): {
  readonly runTimeoutMs: number;
  readonly scenarioTimeoutMs: number;
  readonly concurrency: number;
  readonly retryCount: number;
} {
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const scenarioTimeoutMs =
    options.scenarioTimeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS;
  const concurrency = options.maxConcurrentScenarios ?? 1;
  const retryCount = options.retryCount ?? 0;
  const testFailAttempts = options.testFailAttempts ?? [];
  if (
    !Number.isSafeInteger(runTimeoutMs) ||
    runTimeoutMs < 50 ||
    runTimeoutMs > MAX_RUN_TIMEOUT_MS ||
    !Number.isSafeInteger(scenarioTimeoutMs) ||
    scenarioTimeoutMs < 50 ||
    scenarioTimeoutMs > MAX_SCENARIO_TIMEOUT_MS ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_CONCURRENT_SCENARIOS ||
    !Number.isSafeInteger(retryCount) ||
    retryCount < 0 ||
    retryCount > MAX_EXECUTION_RETRIES ||
    !Array.isArray(testFailAttempts) ||
    testFailAttempts.some(
      (attempt) =>
        !Number.isSafeInteger(attempt) ||
        attempt < 1 ||
        attempt > retryCount + 1,
    )
  ) {
    throw new RangeError("Synthetic execution limits are outside their bounds");
  }
  return { runTimeoutMs, scenarioTimeoutMs, concurrency, retryCount };
}

function makeFixtureInput(
  selectedIds: readonly string[],
  approvedOrigin: string,
): string {
  const input = JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, INPUT_FIXTURE_PATH), "utf8"),
  ) as FixtureDocument & Record<string, unknown>;
  input.environment.approvedOrigin = approvedOrigin;
  input.environment.initialTargetUrl = `${approvedOrigin}/demo`;
  const selected = new Set(selectedIds);
  const selectedScenarios = input.scenarios.filter((scenario) =>
    selected.has(scenario.id),
  );
  const accountReferences = new Set(
    selectedScenarios.map((scenario) => scenario.accountReference),
  );
  input.scenarios = selectedScenarios;
  input.accounts = input.accounts.filter((account) =>
    accountReferences.has(account.reference),
  );
  return JSON.stringify(input);
}

async function startFixtureServer(): Promise<{
  readonly server: Server;
  readonly sockets: Set<Socket>;
  readonly origin: string;
  readonly redirectServer: Server;
  readonly redirectSockets: Set<Socket>;
  readonly redirectTargetUrl: string;
  readonly blockedTargetRequestCount: () => number;
}> {
  let blockedTargetRequestCount = 0;
  const redirectServer = createServer((_request, response) => {
    blockedTargetRequestCount += 1;
    response.writeHead(200).end();
  });
  const redirectSockets = new Set<Socket>();
  redirectServer.on("connection", (socket) => {
    redirectSockets.add(socket);
    socket.once("close", () => redirectSockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    redirectServer.once("error", reject);
    redirectServer.listen(0, "127.0.0.1", resolve);
  });
  const redirectAddress = redirectServer.address();
  if (!redirectAddress || typeof redirectAddress === "string") {
    throw new Error("Owned redirect-destination server did not start");
  }
  const redirectTargetUrl = `http://127.0.0.1:${redirectAddress.port}/blocked`;
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: redirectTargetUrl }).end();
      return;
    }
    if (request.url !== "/demo") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html lang="en">
        <head><title>Reviewed synthetic page</title></head>
        <body>
          <label>Display name <input aria-label="Display name"></label>
          <button type="button">Continue</button>
          <p role="status">Waiting</p>
          <script>
            document.querySelector('button').addEventListener('click', () => {
              const name = document.querySelector('input').value;
              document.querySelector('[role="status"]').textContent = 'Welcome, ' + name;
            });
          </script>
        </body>
      </html>`);
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Owned synthetic server did not start");
    }
    return {
      server,
      sockets,
      origin: `http://127.0.0.1:${address.port}`,
      redirectServer,
      redirectSockets,
      redirectTargetUrl,
      blockedTargetRequestCount: () => blockedTargetRequestCount,
    };
  } catch (error) {
    await closeServer(redirectServer, redirectSockets);
    throw error;
  }
}

function closeServer(
  server: Server | undefined,
  sockets: ReadonlySet<Socket>,
  ignoreCallback = false,
): Promise<{ readonly closed: boolean; readonly injectedPending: boolean }> {
  if (!server) {
    return Promise.resolve({ closed: true, injectedPending: false });
  }
  return new Promise((resolve) => {
    let settled = false;
    let injectedTimer: ReturnType<typeof setTimeout> | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (closed: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const timer of [injectedTimer, forceTimer, finalTimer]) {
        if (timer) {
          clearTimeout(timer);
        }
      }
      resolve({ closed, injectedPending: ignoreCallback });
    };
    const verifyStopped = (): boolean =>
      !server.listening && sockets.size === 0;
    const initiateClose = (observeCallback: boolean): void => {
      if (!server.listening) {
        if (verifyStopped()) {
          finish(true);
        }
        return;
      }
      server.close((error) => {
        if (observeCallback) {
          if (!error && verifyStopped()) {
            finish(true);
          }
        }
      });
    };
    if (ignoreCallback) {
      initiateClose(false);
      injectedTimer = setTimeout(() => {
        if (verifyStopped()) {
          finish(true);
        }
      }, 200);
    } else {
      initiateClose(true);
    }
    forceTimer = setTimeout(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
      if (server.listening) {
        initiateClose(true);
      }
      finalTimer = setTimeout(() => finish(verifyStopped()), 500);
    }, 1_000);
  });
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForGroupExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupExists(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !groupExists(pid);
}

async function terminateOwnedProcess(child: ChildProcess): Promise<boolean> {
  const pid = child.pid;
  if (!pid) {
    return true;
  }
  if (process.platform === "win32") {
    const treeTerminated = await new Promise<boolean>((resolve) => {
      execFile(
        "taskkill.exe",
        ["/PID", String(pid), "/T", "/F"],
        { timeout: 3_000, windowsHide: true },
        (error) => resolve(!error),
      );
    });
    if (treeTerminated) {
      return waitForChildExit(child, 1_000);
    }
    child.kill("SIGTERM");
    const exited = await waitForChildExit(child, 300);
    if (!exited) {
      child.kill("SIGKILL");
      await waitForChildExit(child, 1_000);
    }
    return false;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return waitForChildExit(child, 500);
    }
  }
  if (await waitForGroupExit(pid, 300)) {
    return waitForChildExit(child, 500);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return waitForChildExit(child, 500);
    }
  }
  return (
    (await waitForGroupExit(pid, 1_000)) && (await waitForChildExit(child, 500))
  );
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (
    child.exitCode === null &&
    child.signalCode === null &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return child.exitCode !== null || child.signalCode !== null;
}

async function stopBrowserServer(
  browserServer: BrowserServer,
  testPendingClose = false,
): Promise<BrowserStopResult> {
  const browserProcess = browserServer.process();
  const close = testPendingClose
    ? new Promise<void>(() => {})
    : browserServer.close();
  void close.catch(() => {});
  if (await waitForChildExit(browserProcess, testPendingClose ? 200 : 1_500)) {
    return { stopped: true, injectedPendingClose: testPendingClose };
  }

  const kill = browserServer.kill();
  void kill.catch(() => {});
  if (await waitForChildExit(browserProcess, 1_000)) {
    return { stopped: true, injectedPendingClose: testPendingClose };
  }
  browserProcess.kill("SIGTERM");
  if (await waitForChildExit(browserProcess, 500)) {
    return { stopped: true, injectedPendingClose: testPendingClose };
  }
  browserProcess.kill("SIGKILL");
  return {
    stopped: await waitForChildExit(browserProcess, 1_000),
    injectedPendingClose: testPendingClose,
  };
}

function safeCleanupReport(reportPath: string): CleanupReport | undefined {
  try {
    const report = JSON.parse(
      readFileSync(reportPath, "utf8"),
    ) as Partial<CleanupReport>;
    if (
      !["confirmed", "failed", "unknown"].includes(String(report.status)) ||
      !Array.isArray(report.failures) ||
      report.failures.some(
        (failure) =>
          typeof failure !== "string" || !/^[a-z-]{1,48}$/.test(failure),
      ) ||
      typeof report.injectedFailure !== "boolean"
    ) {
      return undefined;
    }
    return report as CleanupReport;
  } catch {
    return undefined;
  }
}

function cucumberScenarioPassed(reportPath: string): boolean | undefined {
  try {
    const features = JSON.parse(readFileSync(reportPath, "utf8")) as {
      elements?: {
        type?: string;
        steps?: { result?: { status?: string } }[];
      }[];
    }[];
    const scenarios = features.flatMap((feature) =>
      (feature.elements ?? []).filter((element) => element.type === "scenario"),
    );
    if (scenarios.length !== 1 || !scenarios[0].steps?.length) {
      return undefined;
    }
    return scenarios[0].steps.every((step) => step.result?.status === "passed");
  } catch {
    return undefined;
  }
}

function workerEnvironment(
  payload: WorkerPayload,
  cleanupPath: string,
  testCleanupFailure: ExecutionOptions["testCleanupFailure"],
  browserEndpoint: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "WINDIR",
    "PLAYWRIGHT_BROWSERS_PATH",
    "LANG",
    "LC_ALL",
  ]) {
    if (process.env[name] !== undefined) {
      env[name] = process.env[name];
    }
  }
  env.CUCUMBER_STEP_TIMEOUT_MS = String(MAX_SCENARIO_TIMEOUT_MS);
  env.WEB_EXECUTION_PAYLOAD = JSON.stringify(payload);
  env.WEB_EXECUTION_CLEANUP_PATH = cleanupPath;
  env.WEB_EXECUTION_BROWSER_ENDPOINT = browserEndpoint;
  if (testCleanupFailure) {
    env.WEB_EXECUTION_TEST_CLEANUP_FAILURE = testCleanupFailure;
  }
  return env;
}

function stoppedStatus(
  reason: WorkerStopReason,
  workerStopped: boolean,
): ExecutionStatus {
  if (reason === "scenario-timeout" || reason === "run-timeout") {
    return "timed_out";
  }
  return reason === "cancelled" && workerStopped ? "cancelled" : "failed";
}

async function executeScenario(
  scenarioId: string,
  payload: WorkerPayload,
  temporaryDirectory: string,
  browserEndpoint: string,
  timeoutMs: number,
  runSignal: AbortSignal,
  testCleanupFailure: ExecutionOptions["testCleanupFailure"],
): Promise<ScenarioExecutionResult> {
  const reportPath = path.join(temporaryDirectory, `${scenarioId}.json`);
  const cleanupPath = path.join(
    temporaryDirectory,
    `${scenarioId}.cleanup.json`,
  );
  const child = spawn(
    process.execPath,
    [
      CUCUMBER_BIN,
      "--config",
      CUCUMBER_CONFIG,
      "--tags",
      `@scenario-id=${scenarioId}`,
      "--format",
      `json:${reportPath}`,
      "--strict",
    ],
    {
      cwd: REPOSITORY_ROOT,
      detached: process.platform !== "win32",
      stdio: "ignore",
      env: workerEnvironment(
        payload,
        cleanupPath,
        testCleanupFailure,
        browserEndpoint,
      ),
    },
  );
  const spawned = new Promise<boolean>((resolve) => {
    child.once("spawn", () => resolve(true));
    child.once("error", () => resolve(false));
  });
  let resolveTermination: ((terminated: boolean) => void) | undefined;
  const terminationCompleted = new Promise<boolean>((resolve) => {
    resolveTermination = resolve;
  });
  let stopReason:
    | "scenario-timeout"
    | "run-timeout"
    | "cancelled"
    | "cleanup-unknown"
    | undefined;
  let termination: Promise<boolean> | undefined;
  const requestStop = (
    reason:
      | "scenario-timeout"
      | "run-timeout"
      | "cancelled"
      | "cleanup-unknown",
  ): void => {
    if (stopReason || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    stopReason = reason;
    termination = spawned.then((didSpawn) =>
      didSpawn ? terminateOwnedProcess(child) : true,
    );
    void termination.then(
      (terminated) => resolveTermination?.(terminated),
      () => resolveTermination?.(false),
    );
  };
  const timeout = setTimeout(() => requestStop("scenario-timeout"), timeoutMs);
  const onRunAbort = (): void => {
    requestStop(
      runSignal.reason === "run-timeout"
        ? "run-timeout"
        : runSignal.reason === "cleanup-unknown"
          ? "cleanup-unknown"
          : "cancelled",
    );
  };
  runSignal.addEventListener("abort", onRunAbort);
  if (runSignal.aborted) {
    onRunAbort();
  }
  const completionPromise = new Promise<{
    readonly code: number | null;
    readonly spawnFailed: boolean;
  }>((resolve) => {
    child.once("error", () => resolve({ code: null, spawnFailed: true }));
    child.once("exit", (code) => resolve({ code, spawnFailed: false }));
  });
  const outcome = await Promise.race([
    completionPromise.then((completion) => ({ completion })),
    terminationCompleted.then((terminated) => ({ terminated })),
  ]);
  clearTimeout(timeout);
  runSignal.removeEventListener("abort", onRunAbort);
  if ("terminated" in outcome) {
    const workerStopped =
      outcome.terminated && (await waitForChildExit(child, 500));
    return {
      scenarioId,
      status: stoppedStatus(stopReason ?? "cleanup-unknown", workerStopped),
      cleanupStatus: "unknown",
      cleanupFailures: [
        workerStopped
          ? "owned-process-terminated"
          : "owned-process-state-unknown",
      ],
      cleanupFaultInjected: false,
      workerStopped,
      workerStallInjected: testCleanupFailure === "worker-stall",
    };
  }
  const completion = outcome.completion;
  const terminated = termination ? await termination : true;

  if (stopReason) {
    const workerStopped = terminated && (await waitForChildExit(child, 500));
    return {
      scenarioId,
      status: stoppedStatus(stopReason, workerStopped),
      cleanupStatus: "unknown",
      cleanupFailures: [
        workerStopped
          ? "owned-process-terminated"
          : "owned-process-state-unknown",
      ],
      cleanupFaultInjected: false,
      workerStopped,
      workerStallInjected: testCleanupFailure === "worker-stall",
    };
  }
  if (completion.spawnFailed) {
    return {
      scenarioId,
      status: "incomplete",
      cleanupStatus: "unknown",
      cleanupFailures: ["worker-start"],
      cleanupFaultInjected: false,
      workerStopped: true,
      workerStallInjected: testCleanupFailure === "worker-stall",
    };
  }

  const cleanup = safeCleanupReport(cleanupPath);
  const scenarioPassed = cucumberScenarioPassed(reportPath);
  const status =
    scenarioPassed === undefined
      ? "incomplete"
      : completion.code === 0 &&
          scenarioPassed &&
          cleanup?.status === "confirmed"
        ? "passed"
        : "failed";
  return {
    scenarioId,
    status,
    cleanupStatus: cleanup?.status ?? "unknown",
    cleanupFailures: cleanup?.failures ?? ["cleanup-evidence-missing"],
    cleanupFaultInjected: cleanup?.injectedFailure ?? false,
    workerStopped: true,
    workerStallInjected: testCleanupFailure === "worker-stall",
  };
}

function aggregateCleanup(
  results: readonly ScenarioExecutionResult[],
  runFailures: readonly string[],
): ResourceCleanupStatus {
  if (
    results.some((result) => result.cleanupStatus === "failed") ||
    runFailures.includes("temporary-report-cleanup")
  ) {
    return "failed";
  }
  if (
    results.some((result) => result.cleanupStatus === "unknown") ||
    runFailures.length > 0
  ) {
    return "unknown";
  }
  return "confirmed";
}

function summary(
  diagnosticReference: string,
  status: ExecutionStatus,
  scenarios: readonly ScenarioExecutionResult[],
  cleanupStatus: ResourceCleanupStatus,
  cleanupFailures: readonly string[] = [],
  browserProcessStopped: boolean | null = null,
  blockedTargetRequestCount = 0,
  injectedPendingCleanup = false,
): SingleExecutionSummary {
  return {
    diagnosticReference,
    status,
    resourceCleanup: {
      status: cleanupStatus,
      failures: cleanupFailures,
      browserProcessStopped,
      blockedTargetRequestCount,
      injectedPendingCleanup,
    },
    dataRestoration: { status: "unknown", operationPerformed: false },
    scenarios,
  };
}

async function executeReviewedScenarioAttempt(
  options: ExecutionOptions = {},
): Promise<SingleExecutionSummary> {
  const { runTimeoutMs, scenarioTimeoutMs, concurrency } =
    validateOptions(options);
  const diagnosticReference = randomUUID();
  const runController = new AbortController();
  const runTimer = setTimeout(
    () => runController.abort("run-timeout"),
    runTimeoutMs,
  );
  const onAbort = (): void =>
    runController.abort(
      options.signal?.reason === "run-timeout"
        ? "run-timeout"
        : options.signal?.reason === "cleanup-unknown"
          ? "cleanup-unknown"
          : "cancelled",
    );
  options.signal?.addEventListener("abort", onAbort);
  if (options.signal?.aborted) {
    onAbort();
  }

  const results: ScenarioExecutionResult[] = [];
  const cleanupFailures: string[] = [];
  let server: Server | undefined;
  let serverSockets: Set<Socket> = new Set();
  let redirectServer: Server | undefined;
  let redirectSockets: Set<Socket> = new Set();
  let blockedTargetRequestCount: (() => number) | undefined;
  let browserServer: BrowserServer | undefined;
  let browserProcessStopped: boolean | null = null;
  let browserLaunchUncertain = false;
  let serverPendingCloseInjected = false;
  let resourcesAcquired = false;
  let temporaryDirectory: string | undefined;
  let status: ExecutionStatus = "incomplete";
  try {
    if (runController.signal.aborted) {
      status =
        runController.signal.reason === "run-timeout"
          ? "timed_out"
          : "cancelled";
      return summary(diagnosticReference, status, results, "not_required");
    }
    const { approval, validation } = await loadReviewedScenarios();
    const filters = options.scenarioIds
      ? { scenarioIds: options.scenarioIds }
      : { tags: ["@web-safe-execution-S01"] };
    const selection = selectApprovedScenarios(validation, approval, filters);
    if (!selection.runnable) {
      return summary(
        diagnosticReference,
        "incomplete",
        results,
        "not_required",
      );
    }
    if (selection.scenarios.length > MAX_EXECUTION_SCENARIOS) {
      return summary(
        diagnosticReference,
        "incomplete",
        results,
        "not_required",
      );
    }
    if (runController.signal.aborted) {
      return summary(
        diagnosticReference,
        runController.signal.reason === "run-timeout"
          ? "timed_out"
          : "cancelled",
        results,
        "not_required",
      );
    }

    const localRuntime = await startFixtureServer();
    server = localRuntime.server;
    serverSockets = localRuntime.sockets;
    redirectServer = localRuntime.redirectServer;
    redirectSockets = localRuntime.redirectSockets;
    blockedTargetRequestCount = localRuntime.blockedTargetRequestCount;
    resourcesAcquired = true;
    const selectedIds = selection.scenarios.map(
      (scenario) => scenario.id as string,
    );
    const descriptor = prepareScenarioInputs(
      makeFixtureInput(selectedIds, localRuntime.origin),
      validation,
      approval,
      reviewedFixturePolicy,
      filters,
    );
    temporaryDirectory = mkdtempSync(
      path.join(tmpdir(), `rrdweb4-${diagnosticReference}-`),
    );
    try {
      browserServer = await chromium.launchServer({
        host: "127.0.0.1",
        headless: true,
        timeout: 10_000,
      });
      const browserProcessId = browserServer.process().pid;
      if (!browserProcessId) {
        browserLaunchUncertain = true;
        throw new Error("Owned browser process identity is unavailable");
      }
      options.onBrowserProcessStarted?.(browserProcessId);
    } catch (error) {
      browserLaunchUncertain = true;
      throw error;
    }
    let nextScenario = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, selection.scenarios.length) },
      async () => {
        while (
          nextScenario < selection.scenarios.length &&
          !runController.signal.aborted
        ) {
          const index = nextScenario++;
          const scenario = selection.scenarios[index];
          const prepared = descriptor.scenarios.find(
            (candidate) => candidate.id === scenario.id,
          );
          if (!prepared) {
            results[index] = {
              scenarioId: scenario.id ?? "unidentified",
              status: "incomplete",
              cleanupStatus: "unknown",
              cleanupFailures: ["prepared-input-missing"],
              cleanupFaultInjected: false,
              workerStopped: true,
              workerStallInjected: false,
            };
            continue;
          }
          const payload: WorkerPayload = {
            scenario: {
              id: prepared.id,
              values: prepared.values,
            },
            environment: descriptor.environment,
            redirectTargetUrl: localRuntime.redirectTargetUrl,
          };
          results[index] = await executeScenario(
            scenario.id as string,
            payload,
            temporaryDirectory!,
            browserServer!.wsEndpoint(),
            scenarioTimeoutMs,
            runController.signal,
            options.testCleanupFailure,
          );
          if (!runController.signal.aborted) {
            if (results[index].status === "timed_out") {
              runController.abort("run-timeout");
            } else if (results[index].cleanupStatus !== "confirmed") {
              runController.abort("cleanup-unknown");
            }
          }
        }
      },
    );
    await Promise.all(workers);
    for (let index = 0; index < selection.scenarios.length; index += 1) {
      if (!results[index]) {
        const stopReason = runController.signal.reason;
        results[index] = {
          scenarioId: selection.scenarios[index].id ?? "unidentified",
          status:
            stopReason === "run-timeout"
              ? "timed_out"
              : stopReason === "cancelled"
                ? "cancelled"
                : "incomplete",
          cleanupStatus: "unknown",
          cleanupFailures: ["scenario-not-started"],
          cleanupFaultInjected: false,
          workerStopped: true,
          workerStallInjected: false,
        };
      }
    }
    status = runController.signal.aborted
      ? runController.signal.reason === "run-timeout"
        ? "timed_out"
        : runController.signal.reason === "cancelled"
          ? "cancelled"
          : results.some((result) => result.status === "timed_out")
            ? "timed_out"
            : "failed"
      : results.every((result) => result.status === "passed")
        ? "passed"
        : results.some((result) => result.status === "timed_out")
          ? "timed_out"
          : "failed";
  } catch {
    status =
      runController.signal.reason === "run-timeout"
        ? "timed_out"
        : runController.signal.reason === "cancelled"
          ? "cancelled"
          : "incomplete";
  } finally {
    clearTimeout(runTimer);
    options.signal?.removeEventListener("abort", onAbort);
    if (browserServer) {
      try {
        const browserStop = await stopBrowserServer(
          browserServer,
          options.testCleanupFailure === "server-pending",
        );
        browserProcessStopped = browserStop.stopped;
        serverPendingCloseInjected = browserStop.injectedPendingClose;
        if (!browserStop.stopped) {
          cleanupFailures.push("browser-process-state-unknown");
        }
      } catch {
        browserProcessStopped = false;
        cleanupFailures.push("browser-process-state-unknown");
      }
    } else if (browserLaunchUncertain) {
      cleanupFailures.push("browser-launch-state-unknown");
    }
    try {
      const fixtureServer = await closeServer(
        server,
        serverSockets,
        options.testCleanupFailure === "server-pending",
      );
      serverPendingCloseInjected ||= fixtureServer.injectedPending;
      if (!fixtureServer.closed) {
        cleanupFailures.push("fixture-server-state-unknown");
      }
    } catch {
      cleanupFailures.push("fixture-server-close");
    }
    try {
      const redirectClose = await closeServer(redirectServer, redirectSockets);
      if (!redirectClose.closed) {
        cleanupFailures.push("redirect-server-state-unknown");
      }
    } catch {
      cleanupFailures.push("redirect-server-close");
    }
    if (temporaryDirectory) {
      try {
        rmSync(temporaryDirectory, { recursive: true });
      } catch {
        cleanupFailures.push("temporary-report-cleanup");
      }
    }
  }
  if (
    browserProcessStopped === true &&
    cleanupFailures.length === 0 &&
    !browserLaunchUncertain
  ) {
    for (const result of results) {
      if (result.workerStopped && result.cleanupStatus === "unknown") {
        (result as { cleanupStatus: ResourceCleanupStatus }).cleanupStatus =
          "confirmed";
      }
    }
  }
  const cleanupStatus = !resourcesAcquired
    ? "not_required"
    : browserLaunchUncertain || browserProcessStopped === false
      ? "unknown"
      : aggregateCleanup(results, cleanupFailures);
  for (const result of results) {
    if (result.status === "cancelled" && cleanupStatus !== "confirmed") {
      (result as { status: ExecutionStatus }).status = "failed";
    }
  }
  if (cleanupStatus !== "confirmed" && status === "passed") {
    status = "failed";
  }
  if (
    status === "cancelled" &&
    (cleanupStatus !== "confirmed" ||
      results.some((result) => !result.workerStopped))
  ) {
    status = "failed";
  }
  return summary(
    diagnosticReference,
    status,
    results,
    cleanupStatus,
    cleanupFailures,
    browserProcessStopped,
    blockedTargetRequestCount?.() ?? 0,
    serverPendingCloseInjected,
  );
}

export async function executeReviewedScenarios(
  options: ExecutionOptions = {},
): Promise<ExecutionSummary> {
  const { runTimeoutMs, retryCount } = validateOptions(options);
  const deadline = performance.now() + runTimeoutMs;
  const runController = new AbortController();
  const onAbort = (): void => runController.abort("cancelled");
  options.signal?.addEventListener("abort", onAbort);
  if (options.signal?.aborted) {
    onAbort();
  }
  const deadlineTimer = setTimeout(
    () => runController.abort("run-timeout"),
    runTimeoutMs,
  );
  const attempts: ExecutionAttemptSummary[] = [];
  let finalStatusOverride: ExecutionStatus | undefined;

  try {
    for (
      let attemptNumber = 1;
      attemptNumber <= retryCount + 1;
      attemptNumber += 1
    ) {
      if (attemptNumber > 1 && runController.signal.aborted) {
        finalStatusOverride =
          runController.signal.reason === "run-timeout"
            ? "timed_out"
            : "cancelled";
        break;
      }
      const remainingMs = Math.floor(deadline - performance.now());
      if (remainingMs < 50) {
        finalStatusOverride = "timed_out";
        break;
      }
      const result = await executeReviewedScenarioAttempt({
        ...options,
        runTimeoutMs: Math.min(runTimeoutMs, remainingMs),
        signal: runController.signal,
      });
      const injectedFailure =
        result.status === "passed" &&
        (options.testFailAttempts ?? []).includes(attemptNumber);
      const attemptStatus = injectedFailure ? "failed" : result.status;
      attempts.push({
        ...result,
        attemptNumber,
        status: attemptStatus,
        injectedFailure,
      });

      if (options.signal?.aborted) {
        finalStatusOverride = "cancelled";
        break;
      }
      if (performance.now() >= deadline) {
        finalStatusOverride = "timed_out";
        break;
      }
      const canRetry =
        attemptStatus === "failed" &&
        result.resourceCleanup.status === "confirmed" &&
        result.scenarios.every(
          (scenario) =>
            scenario.cleanupStatus === "confirmed" &&
            ["passed", "failed"].includes(scenario.status),
        ) &&
        !runController.signal.aborted &&
        attemptNumber <= retryCount;
      if (!canRetry) {
        break;
      }
    }
  } finally {
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", onAbort);
  }

  const lastAttempt = attempts.at(-1);
  const lastResult =
    lastAttempt ??
    summary(
      randomUUID(),
      finalStatusOverride ?? "timed_out",
      [],
      "not_required",
    );
  const status =
    finalStatusOverride ??
    (lastAttempt?.status === "passed" && attempts.length > 1
      ? "passed_after_retry"
      : (lastAttempt?.status ?? "timed_out"));
  const scenarios =
    status === "passed_after_retry"
      ? lastResult.scenarios.map((scenario) =>
          scenario.status === "passed"
            ? { ...scenario, status: "passed_after_retry" as const }
            : scenario,
        )
      : lastResult.scenarios;

  return {
    diagnosticReference: lastResult.diagnosticReference,
    status,
    resourceCleanup: lastResult.resourceCleanup,
    dataRestoration: lastResult.dataRestoration,
    scenarios,
    attemptCount: attempts.length,
    attempts,
  };
}
