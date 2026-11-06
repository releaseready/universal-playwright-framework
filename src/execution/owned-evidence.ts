import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import type { CucumberScenarioEvidence, CucumberStepStatus } from "./index";

// Fixed reviewed journey only: never serialize runtime values or error messages.
export const OWNED_EVIDENCE_ID = "local-demo-navigation";
export const OWNED_EVIDENCE_FEATURE = "Execute reviewed synthetic scenarios";
export const OWNED_EVIDENCE_SCENARIO =
  "A visitor explores the owned local demo and returns to sign in";
export const OWNED_EVIDENCE_STEPS = [
  "the synthetic reviewed page is open",
  "I explore the owned local demo",
  "the owned local demo shows its synthetic workspace and project",
  "I return from the owned local demo to sign in",
  "the owned local sign in page is visible",
] as const;
export const OWNED_EVIDENCE_STATUSES: readonly CucumberStepStatus[] = [
  "passed",
  "failed",
  "skipped",
  "pending",
  "undefined",
  "ambiguous",
  "unknown",
];
export const MAX_OWNED_EVIDENCE_BYTES = 1024;

export function parseOwnedEvidence(
  raw: string,
  scenarioId: string,
): CucumberScenarioEvidence | undefined {
  if (
    scenarioId !== OWNED_EVIDENCE_ID ||
    Buffer.byteLength(raw) > MAX_OWNED_EVIDENCE_BYTES
  )
    return undefined;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      Object.keys(value).sort().join(",") !==
        "scenarioId,schemaVersion,steps" ||
      value.schemaVersion !== 1 ||
      value.scenarioId !== OWNED_EVIDENCE_ID ||
      !Array.isArray(value.steps) ||
      value.steps.length !== OWNED_EVIDENCE_STEPS.length ||
      !value.steps.every(
        (status: unknown) =>
          typeof status === "string" &&
          OWNED_EVIDENCE_STATUSES.includes(status as CucumberStepStatus),
      )
    )
      return undefined;
    return {
      featureName: OWNED_EVIDENCE_FEATURE,
      scenarioName: OWNED_EVIDENCE_SCENARIO,
      steps: OWNED_EVIDENCE_STEPS.map((name, index) => ({
        name,
        status: value.steps[index],
      })),
    };
  } catch {
    return undefined;
  }
}

export function readOwnedEvidence(
  file: string,
  scenarioId: string,
): CucumberScenarioEvidence | undefined {
  let fd: number | undefined;
  try {
    const before = lstatSync(file);
    if (!before.isFile() || before.size > MAX_OWNED_EVIDENCE_BYTES)
      return undefined;
    fd = openSync(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const after = fstatSync(fd);
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      after.size > MAX_OWNED_EVIDENCE_BYTES
    )
      return undefined;
    const bytes = Buffer.alloc(MAX_OWNED_EVIDENCE_BYTES + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, null);
      if (count === 0) break;
      used += count;
    }
    return parseOwnedEvidence(
      bytes.subarray(0, used).toString("utf8"),
      scenarioId,
    );
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* Evidence stays unavailable on I/O failure. */
      }
    }
  }
}
