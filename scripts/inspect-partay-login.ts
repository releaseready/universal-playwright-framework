import { inspectPartayLogin } from "../src/customer-login/inspection";
import { runLoginCommand } from "./login-command";

async function main(): Promise<void> {
  if (process.argv.slice(2).join(" ") !== "--approved-one-inspection") {
    process.stderr.write(
      "Requires --approved-one-inspection and separate operator authorization. No login or credential input supported.\n",
    );
    process.exitCode = 1;
    return;
  }
  await runLoginCommand(async (signal) => {
    process.stdout.write(
      `${JSON.stringify(await inspectPartayLogin({ signal }))}\n`,
    );
  });
}
void main();
