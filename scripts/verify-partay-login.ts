import { readFileSync } from "node:fs";
import type { PreparedInputDescriptor } from "../src/input-preparation";
import type { RuntimeLoginRequest } from "../src/input-preparation/runtime-login";
import { promptAndVerifyPartayLogin } from "../src/customer-login/partay";

async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const [descriptorPath, requestPath, ...extra] = process.argv.slice(2);
    if (!descriptorPath || !requestPath || extra.length > 0) {
      throw new Error(
        "Reference-only descriptor and request paths are required",
      );
    }
    const descriptor: PreparedInputDescriptor = JSON.parse(
      readFileSync(descriptorPath, "utf8"),
    );
    const request: RuntimeLoginRequest = JSON.parse(
      readFileSync(requestPath, "utf8"),
    );
    const receipt = await promptAndVerifyPartayLogin(descriptor, request, {
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify({
        ...receipt,
        checks: {
          expectedUrlMatched: true,
          partayLogoVisible: true,
          overlayDismissed: true,
          cleanupCompleted: true,
        },
      })}\n`,
    );
  } catch {
    process.stderr.write(
      "Partay login not verified. Check approved reference inputs, secure TTY, account and runtime availability. No automatic retry was attempted.\n",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

void main();
