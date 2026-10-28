import { randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { REPOSITORY_ROOT } from "../execution/reviewed-scenarios";
import {
  renderExecutionReport,
  renderExecutionReportJson,
  type ExecutionReport,
} from "./index";

export interface SavedReportFiles {
  readonly text: string;
  readonly json: string;
}

function ownedReportDirectory(): string {
  const directory = path.join(realpathSync(REPOSITORY_ROOT), "reports");
  try {
    lstatSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("Local report output is unavailable");
    }
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch {
      throw new Error("Local report output is unavailable");
    }
  }
  try {
    const details = lstatSync(directory);
    if (
      !details.isDirectory() ||
      details.isSymbolicLink() ||
      realpathSync(directory) !== directory
    ) {
      throw new Error("Local report output is unavailable");
    }
  } catch {
    throw new Error("Local report output is unavailable");
  }
  return directory;
}

function createExclusiveFile(filePath: string, content: string): void {
  const descriptor = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(descriptor, content, "utf8");
    closeSync(descriptor);
  } catch {
    try {
      closeSync(descriptor);
    } catch {
      // The descriptor may already be closed.
    }
    try {
      unlinkSync(filePath);
    } catch {
      // The partially written file is not safe to retain.
    }
    throw new Error("Local report output is unavailable");
  }
}

export function saveExecutionReport(report: ExecutionReport): SavedReportFiles {
  const directory = ownedReportDirectory();
  const outputId = randomUUID();
  const textName = `local-report-${outputId}.txt`;
  const jsonName = `local-report-${outputId}.json`;
  const textPath = path.join(directory, textName);
  const jsonPath = path.join(directory, jsonName);
  const createdFiles: string[] = [];
  try {
    createExclusiveFile(textPath, renderExecutionReport(report));
    createdFiles.push(textPath);
    createExclusiveFile(jsonPath, renderExecutionReportJson(report));
    createdFiles.push(jsonPath);
  } catch {
    for (const file of createdFiles) {
      try {
        unlinkSync(file);
      } catch {
        continue;
      }
    }
    throw new Error("Local report output is unavailable");
  }
  return {
    text: `reports/${textName}`,
    json: `reports/${jsonName}`,
  };
}
