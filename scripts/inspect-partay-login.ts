import { inspectPartayLogin } from "../src/customer-login/inspection";
import { partayLoginFailureReport } from "../src/customer-login/partay";

async function main(): Promise<void> {
  if (process.argv.slice(2).join(" ") !== "--approved-one-inspection") {
    process.stderr.write(
      "Requires --approved-one-inspection and separate operator authorization. No login or credential input supported.\n",
    );
    process.exitCode = 1;
    return;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    process.stdout.write(
      `${JSON.stringify(await inspectPartayLogin({ signal: controller.signal }))}\n`,
    );
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
void main();
