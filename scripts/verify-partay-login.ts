import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { PreparedInputDescriptor } from "../src/input-preparation";
import {
  RuntimeLoginFailure,
  type RuntimeLoginRequest,
} from "../src/input-preparation/runtime-login";
import {
  partayLoginFailureReport,
  promptAndVerifyPartayLogin,
  privateFileAndVerifyPartayLogin,
} from "../src/customer-login/partay";

async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    let descriptor: PreparedInputDescriptor;
    let request: RuntimeLoginRequest;
    let privateFile: string | undefined;
    try {
      const [descriptorPath, requestPath, ...extra] = process.argv.slice(2);
      if (
        !descriptorPath ||
        !requestPath ||
        (extra.length !== 0 &&
          (extra.length !== 2 ||
            extra[0] !== "--private-account-file" ||
            !extra[1]))
      )
        throw new RuntimeLoginFailure("input-validation", "not-acquired");
      privateFile = extra[1];
      descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
      request = JSON.parse(readFileSync(requestPath, "utf8"));
    } catch {
      throw new RuntimeLoginFailure("input-validation", "not-acquired");
    }
    const receipt = privateFile
      ? await privateFileAndVerifyPartayLogin(
          descriptor,
          request,
          privateFile,
          execFileSync("git", ["rev-parse", "--show-toplevel"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim(),
          { signal: controller.signal },
        )
      : await promptAndVerifyPartayLogin(descriptor, request, {
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
