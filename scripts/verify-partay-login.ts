import { readFileSync } from "node:fs";
import type { PreparedInputDescriptor } from "../src/input-preparation";
import {
  RuntimeLoginFailure,
  type RuntimeLoginRequest,
} from "../src/input-preparation/runtime-login";
import {
  partayLoginFailureReport,
  promptAndVerifyPartayLogin,
} from "../src/customer-login/partay";

async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    let descriptor: PreparedInputDescriptor;
    let request: RuntimeLoginRequest;
    try {
      const [descriptorPath, requestPath, ...extra] = process.argv.slice(2);
      if (!descriptorPath || !requestPath || extra.length > 0)
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
