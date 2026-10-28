import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  consumeRuntimeLoginInputs,
  InMemoryRuntimeSecretProvider,
  RuntimeLoginFailure,
  validateRuntimeLoginRequest,
  type RuntimeLoginAccount,
  type RuntimeLoginRequest,
  type RuntimeLoginResult,
} from "./runtime-login";
import type { PreparedInputDescriptor } from ".";

/** Explicit local opt-in. The caller supplies its trusted repository boundary. */
export async function withPrivateFileLoginInputs(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  filePath: string,
  repositoryRoot: string,
  consume: (account: RuntimeLoginAccount) => Promise<void>,
): Promise<RuntimeLoginResult> {
  let provider: InMemoryRuntimeSecretProvider | undefined;
  try {
    validateRuntimeLoginRequest(descriptor, request);
    if (
      process.platform === "win32" ||
      !process.getuid ||
      !isAbsolute(filePath)
    ) {
      throw new RuntimeLoginFailure("input-validation", "not-acquired");
    }
    const root = await realpath(repositoryRoot);
    const parent = await realpath(dirname(filePath));
    const resolved = resolve(
      parent,
      filePath.slice(filePath.lastIndexOf(sep) + 1),
    );
    const within = relative(root, resolved);
    if (
      within === "" ||
      (!within.startsWith(`..${sep}`) && within !== ".." && !isAbsolute(within))
    ) {
      throw new RuntimeLoginFailure("input-validation", "not-acquired");
    }
    const directory = await lstat(parent);
    const uid = process.getuid();
    if (
      !directory.isDirectory() ||
      directory.uid !== uid ||
      (directory.mode & 0o777) !== 0o700
    ) {
      throw new RuntimeLoginFailure("input-validation", "not-acquired");
    }
    const handle = await open(
      resolved,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let bytes: Buffer | undefined;
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.uid !== uid ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.nlink !== 1 ||
        stat.size > 8192
      ) {
        throw new RuntimeLoginFailure("input-validation", "not-acquired");
      }
      const current = await lstat(resolved);
      if (current.dev !== stat.dev || current.ino !== stat.ino) {
        throw new RuntimeLoginFailure("input-validation", "not-acquired");
      }
      // Remove the validated directory entry before parsing or any browser work.
      await unlink(resolved);
      bytes = Buffer.alloc(8193);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 8192) {
        throw new RuntimeLoginFailure("input-validation", "not-acquired");
      }
      const account: unknown = JSON.parse(
        bytes.subarray(0, bytesRead).toString("utf8"),
      );
      // The provider validates the strict account shape without echoing values.
      provider = new InMemoryRuntimeSecretProvider(request, account);
    } finally {
      bytes?.fill(0);
      await handle.close();
    }
    return await consumeRuntimeLoginInputs(
      descriptor,
      request,
      provider,
      consume,
    );
  } catch (error) {
    throw (
      RuntimeLoginFailure.fromUnknown(error) ??
      new RuntimeLoginFailure("input-validation", "not-acquired")
    );
  } finally {
    provider?.dispose();
  }
}
