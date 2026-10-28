import type { PreparedInputDescriptor } from ".";
import type {
  RuntimeLoginAccount,
  RuntimeLoginRequest,
  RuntimeLoginResult,
} from "./runtime-login";

export const PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE =
  "Private account-file input is deferred and excluded from the MVP.";

export class PrivateFileLoginDeferredError extends Error {
  constructor() {
    super(PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE);
    this.name = "PrivateFileLoginDeferredError";
  }
}

export async function withPrivateFileLoginInputs(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  filePath: string,
  repositoryRoot: string,
  consume: (account: RuntimeLoginAccount) => Promise<void>,
): Promise<RuntimeLoginResult> {
  void descriptor;
  void request;
  void filePath;
  void repositoryRoot;
  void consume;
  throw new PrivateFileLoginDeferredError();
}
