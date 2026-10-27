import { executeReviewedScenarios } from ".";

async function main(): Promise<void> {
  const result = await executeReviewedScenarios();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "passed") {
    process.exitCode = 1;
  }
}

void main();
