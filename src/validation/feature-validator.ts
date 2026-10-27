import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
  compile,
} from "@cucumber/gherkin";
import {
  CucumberExpression,
  ParameterTypeRegistry,
} from "@cucumber/cucumber-expressions";

export const MAX_FEATURE_BYTES = 256 * 1024;
const SCENARIO_ID_TAG = "@scenario-id=";
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface ReviewedStep {
  readonly id: string;
  readonly expression: string;
}

export interface ReviewedStepManifest {
  readonly implementationRevision: string;
  readonly steps: readonly ReviewedStep[];
}

export interface ValidatedStep {
  readonly index: number;
  readonly text: string;
  readonly type: string;
  readonly implementationId?: string;
  readonly issue?: "undefined" | "ambiguous";
}

export interface ExampleRow {
  readonly caseId: string | null;
  readonly values: Readonly<Record<string, string>>;
}

export interface ValidatedScenario {
  readonly id: string | null;
  readonly name: string;
  readonly tags: readonly string[];
  readonly exampleRow?: ExampleRow;
  readonly steps: readonly ValidatedStep[];
  readonly issues: readonly string[];
  readonly runnable: boolean;
}

export type FeatureValidation =
  | {
      readonly valid: false;
      readonly reason: string;
    }
  | {
      readonly valid: true;
      readonly featurePath: string;
      readonly sourceRevision: string;
      readonly featureRevision: string;
      readonly implementationRevision: string;
      readonly scenarios: readonly ValidatedScenario[];
    };

export interface ValidateFeatureInput {
  readonly workspaceRoot: string;
  readonly featurePath: string;
  readonly sourceRevision: string;
  readonly manifest: ReviewedStepManifest;
}

interface CompiledReviewedStep {
  readonly id: string;
  readonly expression: CucumberExpression;
}

interface ExampleRowMetadata extends ExampleRow {
  readonly scenarioNodeId: string;
  readonly duplicateCaseId: boolean;
}

interface ScenarioMetadata {
  readonly id: string | null;
  readonly identityIssue?: string;
  readonly isOutline: boolean;
}

type FileReadResult =
  | {
      readonly bytes: Buffer;
      readonly canonicalPath: string;
      readonly workspacePath: string;
    }
  | { readonly reason: string };

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relativePath = path.relative(directory, candidate);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

async function readFeatureFile(
  input: ValidateFeatureInput,
): Promise<FileReadResult> {
  if (
    typeof input.workspaceRoot !== "string" ||
    input.workspaceRoot.trim() === ""
  ) {
    return { reason: "A workspace root is required" };
  }
  if (
    typeof input.featurePath !== "string" ||
    input.featurePath.trim() === ""
  ) {
    return { reason: "A workspace-relative feature path is required" };
  }
  if (
    path.isAbsolute(input.featurePath) ||
    path.win32.isAbsolute(input.featurePath)
  ) {
    return { reason: "Feature path must be relative to the workspace" };
  }
  if (!input.featurePath.endsWith(".feature")) {
    return { reason: "Feature path must have the .feature extension" };
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const workspacePath = await realpath(input.workspaceRoot);
    const unresolvedPath = path.resolve(workspacePath, input.featurePath);
    if (!isWithinDirectory(workspacePath, unresolvedPath)) {
      return { reason: "Feature path must stay within the workspace" };
    }

    const canonicalPath = await realpath(unresolvedPath);
    if (!isWithinDirectory(workspacePath, canonicalPath)) {
      return { reason: "Feature path must stay within the workspace" };
    }

    handle = await open(canonicalPath, "r");
    const fileStats = await handle.stat();
    if (!fileStats.isFile()) {
      return { reason: "Feature path must identify a regular file" };
    }
    if (fileStats.size > MAX_FEATURE_BYTES) {
      return {
        reason: `Feature file exceeds the ${MAX_FEATURE_BYTES}-byte limit`,
      };
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= MAX_FEATURE_BYTES) {
      const chunk = Buffer.alloc(
        Math.min(64 * 1024, MAX_FEATURE_BYTES + 1 - totalBytes),
      );
      const { bytesRead } = await handle.read(
        chunk,
        0,
        chunk.length,
        totalBytes,
      );
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      if (totalBytes > MAX_FEATURE_BYTES) {
        return {
          reason: `Feature file exceeds the ${MAX_FEATURE_BYTES}-byte limit`,
        };
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }

    return {
      bytes: Buffer.concat(chunks, totalBytes),
      canonicalPath,
      workspacePath,
    };
  } catch {
    return { reason: "Feature file could not be read safely" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function makeIdGenerator(): () => string {
  let nextId = 0;
  return () => String(++nextId);
}

function getParseLocation(error: unknown): { line?: number; column?: number } {
  if (typeof error !== "object" || error === null || !("errors" in error)) {
    return {};
  }
  const errors = error.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return {};
  }
  const firstError: unknown = errors[0];
  if (
    typeof firstError !== "object" ||
    firstError === null ||
    !("location" in firstError)
  ) {
    return {};
  }
  const location = firstError.location;
  if (typeof location !== "object" || location === null) {
    return {};
  }
  const line = "line" in location ? location.line : undefined;
  const column = "column" in location ? location.column : undefined;
  return {
    ...(typeof line === "number" ? { line } : {}),
    ...(typeof column === "number" ? { column } : {}),
  };
}

function parseErrorMessage(error: unknown): string {
  const location = getParseLocation(error);
  if (location.line === undefined) {
    return "Feature contains invalid Gherkin";
  }
  const column = location.column === undefined ? "" : `:${location.column}`;
  return `Feature contains invalid Gherkin at line ${location.line}${column}`;
}

function compileManifest(
  manifest: ReviewedStepManifest,
): { steps: readonly CompiledReviewedStep[] } | { reason: string } {
  if (typeof manifest !== "object" || manifest === null) {
    return { reason: "A reviewed step manifest is required" };
  }
  if (
    typeof manifest.implementationRevision !== "string" ||
    manifest.implementationRevision.trim() === ""
  ) {
    return {
      reason: "Reviewed step manifest needs an implementation revision",
    };
  }
  if (!Array.isArray(manifest.steps)) {
    return { reason: "Reviewed step manifest needs a step list" };
  }

  const ids = new Set<string>();
  const registry = new ParameterTypeRegistry();
  const steps: CompiledReviewedStep[] = [];
  for (const step of manifest.steps) {
    if (
      typeof step !== "object" ||
      step === null ||
      typeof step.id !== "string" ||
      step.id.trim() === "" ||
      typeof step.expression !== "string" ||
      step.expression.trim() === ""
    ) {
      return { reason: "Reviewed step manifest contains an invalid entry" };
    }
    if (ids.has(step.id)) {
      return { reason: "Reviewed step manifest contains a duplicate step ID" };
    }
    ids.add(step.id);
    try {
      steps.push({
        id: step.id,
        expression: new CucumberExpression(step.expression, registry),
      });
    } catch {
      return {
        reason: `Reviewed step manifest contains an invalid expression for ${step.id}`,
      };
    }
  }
  return { steps };
}

function stableScenarioId(tags: readonly { name: string }[]): {
  id: string | null;
  issue?: string;
} {
  const ids = tags
    .map((tag) => tag.name)
    .filter((name) => name.startsWith(SCENARIO_ID_TAG))
    .map((name) => name.slice(SCENARIO_ID_TAG.length));
  if (ids.length !== 1 || !STABLE_ID_PATTERN.test(ids[0] ?? "")) {
    return {
      id: null,
      issue: "Scenario needs exactly one valid @scenario-id=<stable-id> tag",
    };
  }
  return { id: ids[0] };
}

export async function validateFeatureFile(
  input: ValidateFeatureInput,
): Promise<FeatureValidation> {
  if (
    typeof input.sourceRevision !== "string" ||
    input.sourceRevision.trim() === ""
  ) {
    return { valid: false, reason: "A source revision is required" };
  }

  const compiledManifest = compileManifest(input.manifest);
  if ("reason" in compiledManifest) {
    return { valid: false, reason: compiledManifest.reason };
  }

  const file = await readFeatureFile(input);
  if ("reason" in file) {
    return { valid: false, reason: file.reason };
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    return { valid: false, reason: "Feature file is not valid UTF-8" };
  }

  const featurePath = path
    .relative(file.workspacePath, file.canonicalPath)
    .split(path.sep)
    .join("/");
  const parserIds = makeIdGenerator();
  let document;
  let pickles;
  try {
    const parser = new Parser(
      new AstBuilder(parserIds),
      new GherkinClassicTokenMatcher(),
    );
    document = parser.parse(source);
    if (!document.feature) {
      return {
        valid: false,
        reason: "Feature file does not contain a Feature",
      };
    }
    pickles = compile(document, featurePath, makeIdGenerator());
  } catch (error) {
    return { valid: false, reason: parseErrorMessage(error) };
  }

  if (!document.feature) {
    return { valid: false, reason: "Feature file does not contain a Feature" };
  }

  type FeatureChild = (typeof document.feature.children)[number];
  type ScenarioNode = NonNullable<FeatureChild["scenario"]>;
  const scenarioMetadataByNodeId = new Map<string, ScenarioMetadata>();
  const exampleRowsByNodeId = new Map<string, ExampleRowMetadata>();
  const scenarioIdCounts = new Map<string, number>();
  const rowIdCounts = new Map<string, number>();

  const inspectScenario = (scenario: ScenarioNode): void => {
    const identity = stableScenarioId(scenario.tags);
    const metadata: ScenarioMetadata = {
      id: identity.id,
      ...(identity.issue ? { identityIssue: identity.issue } : {}),
      isOutline: scenario.examples.length > 0,
    };
    scenarioMetadataByNodeId.set(scenario.id, metadata);
    if (identity.id) {
      scenarioIdCounts.set(
        identity.id,
        (scenarioIdCounts.get(identity.id) ?? 0) + 1,
      );
    }

    for (const examples of scenario.examples) {
      const headers =
        examples.tableHeader?.cells.map((cell) => cell.value) ?? [];
      const caseIdIndexes = headers.flatMap((header, index) =>
        header === "case_id" ? [index] : [],
      );
      const caseIdIndex = caseIdIndexes.length === 1 ? caseIdIndexes[0] : -1;
      for (const row of examples.tableBody) {
        const values = Object.fromEntries(
          headers.map((header, index) => [
            header,
            row.cells[index]?.value ?? "",
          ]),
        );
        const caseId =
          caseIdIndex >= 0 ? (row.cells[caseIdIndex]?.value ?? null) : null;
        const rowMetadata: ExampleRowMetadata = {
          caseId,
          values,
          scenarioNodeId: scenario.id,
          duplicateCaseId: false,
        };
        exampleRowsByNodeId.set(row.id, rowMetadata);
        if (identity.id && caseId && STABLE_ID_PATTERN.test(caseId)) {
          const rowIdentity = `${identity.id}/${caseId}`;
          rowIdCounts.set(rowIdentity, (rowIdCounts.get(rowIdentity) ?? 0) + 1);
        }
      }
    }
  };

  const inspectRuleChildren = (
    children: readonly NonNullable<FeatureChild["rule"]>["children"][number][],
  ): void => {
    for (const child of children) {
      if (child.scenario) {
        inspectScenario(child.scenario);
      }
    }
  };

  for (const child of document.feature.children) {
    if (child.scenario) {
      inspectScenario(child.scenario);
    }
    if (child.rule) {
      inspectRuleChildren(child.rule.children);
    }
  }

  for (const [nodeId, row] of exampleRowsByNodeId) {
    const scenarioId = scenarioMetadataByNodeId.get(row.scenarioNodeId)?.id;
    const rowIdentity =
      scenarioId && row.caseId ? `${scenarioId}/${row.caseId}` : null;
    exampleRowsByNodeId.set(nodeId, {
      ...row,
      duplicateCaseId:
        rowIdentity !== null && (rowIdCounts.get(rowIdentity) ?? 0) > 1,
    });
  }

  const scenarios: ValidatedScenario[] = pickles.map((pickle) => {
    const scenarioNodeId = pickle.astNodeIds.find((id) =>
      scenarioMetadataByNodeId.has(id),
    );
    const metadata = scenarioNodeId
      ? scenarioMetadataByNodeId.get(scenarioNodeId)
      : undefined;
    const exampleRowNodeId = pickle.astNodeIds.find((id) => {
      const row = exampleRowsByNodeId.get(id);
      return row?.scenarioNodeId === scenarioNodeId;
    });
    const rowMetadata = exampleRowNodeId
      ? exampleRowsByNodeId.get(exampleRowNodeId)
      : undefined;
    const id =
      metadata?.id && metadata.isOutline && rowMetadata?.caseId
        ? `${metadata.id}/${rowMetadata.caseId}`
        : metadata?.id && !metadata.isOutline
          ? metadata.id
          : null;
    const issues: string[] = [];

    if (metadata?.identityIssue) {
      issues.push(metadata.identityIssue);
    }
    if (metadata?.id && (scenarioIdCounts.get(metadata.id) ?? 0) > 1) {
      issues.push("Scenario identifier is not unique in this feature");
    }
    if (metadata?.isOutline) {
      if (!rowMetadata?.caseId || !STABLE_ID_PATTERN.test(rowMetadata.caseId)) {
        issues.push("Scenario Outline row needs a valid case_id value");
      } else if (rowMetadata.duplicateCaseId) {
        issues.push("Scenario Outline row case_id is not unique");
      }
    }

    const steps: ValidatedStep[] = pickle.steps.map((step, index) => {
      const matches = compiledManifest.steps.filter((reviewedStep) =>
        reviewedStep.expression.match(step.text),
      );
      if (matches.length === 1) {
        return {
          index,
          text: step.text,
          type: step.type ?? "Unknown",
          implementationId: matches[0].id,
        };
      }
      if (matches.length === 0) {
        issues.push(
          `Step ${index + 1} has no reviewed implementation: ${step.text}`,
        );
        return {
          index,
          text: step.text,
          type: step.type ?? "Unknown",
          issue: "undefined",
        };
      }
      issues.push(
        `Step ${index + 1} has ambiguous reviewed implementations: ${step.text}`,
      );
      return {
        index,
        text: step.text,
        type: step.type ?? "Unknown",
        issue: "ambiguous",
      };
    });

    return {
      id,
      name: pickle.name,
      tags: pickle.tags.map((tag) => tag.name),
      ...(rowMetadata
        ? {
            exampleRow: {
              caseId: rowMetadata.caseId,
              values: rowMetadata.values,
            },
          }
        : {}),
      steps,
      issues,
      runnable: issues.length === 0,
    };
  });

  return {
    valid: true,
    featurePath,
    sourceRevision: input.sourceRevision,
    featureRevision: createHash("sha256").update(file.bytes).digest("hex"),
    implementationRevision: input.manifest.implementationRevision,
    scenarios,
  };
}
