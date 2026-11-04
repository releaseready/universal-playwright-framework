import { partayLoginFailureReport } from "../src/customer-login/partay";

export async function runLoginCommand(
  run: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    await run(controller.signal);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(partayLoginFailureReport(error))}\n`,
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
