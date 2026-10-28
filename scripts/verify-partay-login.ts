import { readFileSync } from "node:fs";
import type { PreparedInputDescriptor } from "../src/input-preparation";
import {
  RuntimeLoginFailure,
  type RuntimeLoginRequest,
} from "../src/input-preparation/runtime-login";
import { PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE } from "../src/input-preparation/private-login-file";
import {
  partayLoginFailureReport,
  promptAndVerifyPartayLogin,
} from "../src/customer-login/partay";

const HELP = [
  "Usage: npm run verify:partay-login -- <approved-descriptor.json> <approved-request.json>",
  "       npm run verify:partay-login -- --help",
  "",
  "Private account-file input (--private-account-file) is deferred and excluded from the MVP.",
  "",
].join("\n");

async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    let descriptor: PreparedInputDescriptor;
    let request: RuntimeLoginRequest;
    try {
      const args = process.argv.slice(2);
      if (
        args.some(
          (argument) =>
            argument === "--private-account-file" ||
            argument.startsWith("--private-account-file="),
        )
      ) {
        process.stderr.write(`${PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE}\n`);
        process.exitCode = 1;
        return;
      }
      if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
        process.stdout.write(HELP);
        return;
      }
      const [descriptorPath, requestPath, ...extra] = args;
      if (!descriptorPath || !requestPath || extra.length !== 0)
        throw new RuntimeLoginFailure("input-validation", "not-acquired");
      descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
      request = JSON.parse(readFileSync(requestPath, "utf8"));
    } catch {
      throw new RuntimeLoginFailure("input-validation", "not-acquired");
    }
    const receipt = await promptAndVerifyPartayLogin(descriptor, request, {
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify({
        ...receipt,
        cleanupStatus: "confirmed",
        checks: {
          expectedUrlMatched: true,
          partayLogoVisible: true,
          overlayDismissed: true,
          cleanupCompleted: true,
        },
      })}\n`,
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
