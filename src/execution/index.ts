import { randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { execFile, spawn, type ChildProcess } from "node:child_process";
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

export type ExecutionStatus =
  | "passed"
  | "failed"
  | "incomplete"
  | "timed_out"
  | "cancelled";
export type ResourceCleanupStatus = "confirmed" | "failed" | "unknown";

export interface ScenarioExecutionResult {
  readonly scenarioId: string;
  readonly status: ExecutionStatus;
  readonly cleanupStatus: ResourceCleanupStatus;
  readonly cleanupFailures: readonly string[];
  readonly cleanupFaultInjected: boolean;
}

export interface ExecutionSummary {
  readonly diagnosticReference: string;
  readonly status: ExecutionStatus;
  readonly resourceCleanup: {
    readonly status: ResourceCleanupStatus;
    readonly failures: readonly string[];
  };
  readonly dataRestoration: {
    readonly status: "unknown";
    readonly operationPerformed: false;
  };
  readonly scenarios: readonly ScenarioExecutionResult[];
}

export interface ExecutionOptions {
  readonly scenarioIds?: readonly string[];
  readonly runTimeoutMs?: number;
  readonly scenarioTimeoutMs?: number;
  readonly maxConcurrentScenarios?: number;
  readonly signal?: AbortSignal;
  readonly testCleanupFailure?: "context";
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
}

interface CleanupReport {
  readonly status: ResourceCleanupStatus;
  readonly failures: readonly string[];
  readonly injectedFailure: boolean;
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
} {
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const scenarioTimeoutMs =
    options.scenarioTimeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS;
  const concurrency = options.maxConcurrentScenarios ?? 1;
  if (
    !Number.isSafeInteger(runTimeoutMs) ||
    runTimeoutMs < 50 ||
    runTimeoutMs > MAX_RUN_TIMEOUT_MS ||
    !Number.isSafeInteger(scenarioTimeoutMs) ||
    scenarioTimeoutMs < 50 ||
    scenarioTimeoutMs > MAX_SCENARIO_TIMEOUT_MS ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_CONCURRENT_SCENARIOS
  ) {
    throw new RangeError("Synthetic execution limits are outside their bounds");
  }
  return { runTimeoutMs, scenarioTimeoutMs, concurrency };
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
}> {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "http://192.0.2.1/" }).end();
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
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Owned synthetic server did not start");
  }
  return { server, sockets, origin: `http://127.0.0.1:${address.port}` };
}

function closeServer(
  server: Server | undefined,
  sockets: ReadonlySet<Socket>,
): Promise<void> {
  if (!server) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let destroyTimer: ReturnType<typeof setTimeout> | undefined;
    let failureTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (destroyTimer) {
        clearTimeout(destroyTimer);
      }
      if (failureTimer) {
        clearTimeout(failureTimer);
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    if (!server.listening) {
      for (const socket of sockets) {
        socket.destroy();
      }
      void (async () => {
        const deadline = Date.now() + 1_000;
        while (sockets.size > 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        finish(
          sockets.size === 0
            ? undefined
            : new Error("Owned synthetic server shutdown is unknown"),
        );
      })();
      return;
    }
    server.close((error) => finish(error));
    destroyTimer = setTimeout(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
      failureTimer = setTimeout(
        () => finish(new Error("Owned synthetic server shutdown is unknown")),
        1_000,
      );
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
      return true;
    }
  }
  if (await waitForGroupExit(pid, 300)) {
    return true;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return true;
    }
  }
  return waitForGroupExit(pid, 1_000);
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
  if (testCleanupFailure) {
    env.WEB_EXECUTION_TEST_CLEANUP_FAILURE = testCleanupFailure;
  }
  return env;
}

async function executeScenario(
  scenarioId: string,
  payload: WorkerPayload,
  temporaryDirectory: string,
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
      env: workerEnvironment(payload, cleanupPath, testCleanupFailure),
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
    return {
      scenarioId,
      status:
        stopReason === "scenario-timeout" || stopReason === "run-timeout"
          ? "timed_out"
          : stopReason === "cancelled"
            ? "cancelled"
            : "failed",
      cleanupStatus: "unknown",
      cleanupFailures: [
        outcome.terminated
          ? "owned-process-terminated"
          : "owned-process-state-unknown",
      ],
      cleanupFaultInjected: false,
    };
  }
  const completion = outcome.completion;
  const terminated = termination ? await termination : true;

  if (stopReason) {
    return {
      scenarioId,
      status:
        stopReason === "scenario-timeout" || stopReason === "run-timeout"
          ? "timed_out"
          : "cancelled",
      cleanupStatus: "unknown",
      cleanupFailures: [
        terminated ? "owned-process-terminated" : "owned-process-state-unknown",
      ],
      cleanupFaultInjected: false,
    };
  }
  if (completion.spawnFailed) {
    return {
      scenarioId,
      status: "incomplete",
      cleanupStatus: "unknown",
      cleanupFailures: ["worker-start"],
      cleanupFaultInjected: false,
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
  };
}

function aggregateCleanup(
  results: readonly ScenarioExecutionResult[],
  runFailures: readonly string[],
): ResourceCleanupStatus {
  if (
    results.some((result) => result.cleanupStatus === "failed") ||
    runFailures.length > 0
  ) {
    return "failed";
  }
  if (results.some((result) => result.cleanupStatus === "unknown")) {
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
): ExecutionSummary {
  return {
    diagnosticReference,
    status,
    resourceCleanup: { status: cleanupStatus, failures: cleanupFailures },
    dataRestoration: { status: "unknown", operationPerformed: false },
    scenarios,
  };
}

export async function executeReviewedScenarios(
  options: ExecutionOptions = {},
): Promise<ExecutionSummary> {
  const { runTimeoutMs, scenarioTimeoutMs, concurrency } =
    validateOptions(options);
  const diagnosticReference = randomUUID();
  const runController = new AbortController();
  const runTimer = setTimeout(
    () => runController.abort("run-timeout"),
    runTimeoutMs,
  );
  const onAbort = (): void => runController.abort("cancelled");
  options.signal?.addEventListener("abort", onAbort);
  if (options.signal?.aborted) {
    onAbort();
  }

  const results: ScenarioExecutionResult[] = [];
  const runFailures: string[] = [];
  let server: Server | undefined;
  let serverSockets: Set<Socket> = new Set();
  let temporaryDirectory: string | undefined;
  let status: ExecutionStatus = "incomplete";
  try {
    if (runController.signal.aborted) {
      status = "cancelled";
      return summary(diagnosticReference, status, results, "unknown");
    }
    const { approval, validation } = await loadReviewedScenarios();
    const filters = options.scenarioIds
      ? { scenarioIds: options.scenarioIds }
      : { tags: ["@web-safe-execution-S01"] };
    const selection = selectApprovedScenarios(validation, approval, filters);
    if (!selection.runnable) {
      return summary(diagnosticReference, "incomplete", results, "confirmed");
    }
    if (selection.scenarios.length > MAX_EXECUTION_SCENARIOS) {
      return summary(diagnosticReference, "incomplete", results, "confirmed");
    }
    if (runController.signal.aborted) {
      return summary(
        diagnosticReference,
        runController.signal.reason === "run-timeout"
          ? "timed_out"
          : "cancelled",
        results,
        "unknown",
      );
    }

    const localRuntime = await startFixtureServer();
    server = localRuntime.server;
    serverSockets = localRuntime.sockets;
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
            };
            continue;
          }
          const payload: WorkerPayload = {
            scenario: {
              id: prepared.id,
              values: prepared.values,
            },
            environment: descriptor.environment,
          };
          results[index] = await executeScenario(
            scenario.id as string,
            payload,
            temporaryDirectory!,
            scenarioTimeoutMs,
            runController.signal,
            options.testCleanupFailure,
          );
          if (
            results[index].cleanupStatus !== "confirmed" &&
            !runController.signal.aborted
          ) {
            runController.abort("cleanup-unknown");
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
    status = runController.signal.aborted
      ? runController.signal.reason === "run-timeout"
        ? "timed_out"
        : "cancelled"
      : "incomplete";
    runFailures.push("execution-or-cleanup-failed");
  } finally {
    clearTimeout(runTimer);
    options.signal?.removeEventListener("abort", onAbort);
    try {
      await closeServer(server, serverSockets);
    } catch {
      runFailures.push("owned-server-close");
    }
    if (temporaryDirectory) {
      try {
        rmSync(temporaryDirectory, { recursive: true });
      } catch {
        runFailures.push("temporary-report-cleanup");
      }
    }
  }
  const cleanupStatus = aggregateCleanup(results, runFailures);
  if (cleanupStatus !== "confirmed" && status === "passed") {
    status = "failed";
  }
  return summary(
    diagnosticReference,
    status,
    results,
    cleanupStatus,
    runFailures,
  );
}
