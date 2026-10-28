import { executeReviewedScenarios } from ".";
import {
  createExecutionReport,
  renderExecutionReport,
  renderExecutionReportJson,
} from "../reporting";
import { saveExecutionReport } from "../reporting/output";

async function main(): Promise<void> {
  const summary = await executeReviewedScenarios();
  const report = createExecutionReport(summary);
  try {
    const files = saveExecutionReport(report);
    process.stderr.write(
      `${renderExecutionReport(report)}Saved local reports: ${files.text} and ${files.json}\n`,
    );
  } catch {
    process.stderr.write(
      `${renderExecutionReport(report)}Local report files are unavailable; the execution outcome is unchanged.\n`,
    );
  }
  process.stdout.write(renderExecutionReportJson(report));
  if (summary.status !== "passed") {
    process.exitCode = 1;
  }
}

void main();
