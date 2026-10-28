import { z } from "zod";
import type {
  PreparedInputDescriptor,
  RuntimeSecretProvider,
  RuntimeSecretScope,
  SecretReference,
} from ".";

const identifier = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const referenceIdentifier = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
const scopeSchema = z
  .object({
    projectId: identifier,
    runId: identifier,
    scenarioId: referenceIdentifier,
    dataBinding: z.string().regex(/^[a-f0-9]{64}$/),
    environment: z
      .object({
        id: identifier,
        revision: identifier,
        approvedOrigin: z.string().max(2048),
      })
      .strict(),
  })
  .strict();
const requestSchema = z
  .object({
    scope: scopeSchema,
    account: z
      .object({ id: referenceIdentifier, revision: referenceIdentifier })
      .strict(),
    expiresAt: z.number().int().positive(),
  })
  .strict();
const accountSchema = z
  .object({
    username: z.string().min(1).max(1024),
    password: z.string().min(1).max(1024),
  })
  .strict();
const secretReferenceSchema = z
  .object({
    id: referenceIdentifier,
    revision: referenceIdentifier,
    field: z.enum(["username", "password"]),
  })
  .strict();

export interface RuntimeLoginRequest {
  readonly scope: RuntimeSecretScope;
  readonly account: { readonly id: string; readonly revision: string };
  readonly expiresAt: number;
}

export interface RuntimeLoginAccount {
  readonly username: string;
  readonly password: string;
}

export type RuntimeLoginErrorCode =
  | "invalid-runtime-input"
  | "expired-runtime-input"
  | "runtime-scope-mismatch"
  | "runtime-input-unavailable"
  | "runtime-login-failed";

const messages: Record<RuntimeLoginErrorCode, string> = {
  "invalid-runtime-input":
    "Runtime login input is missing or invalid; review the account references",
  "expired-runtime-input":
    "Runtime login input expired; collect a new account for this run",
  "runtime-scope-mismatch":
    "Runtime login scope or review changed; review this run before continuing",
  "runtime-input-unavailable":
    "Runtime login input is unavailable; collect the account again",
  "runtime-login-failed":
    "Runtime login consumer failed; inspect the reviewed implementation without publishing account values",
};

export class RuntimeLoginError extends Error {
  constructor(readonly code: RuntimeLoginErrorCode) {
    super(messages[code]);
    this.name = "RuntimeLoginError";
  }
}

export const RUNTIME_LOGIN_FAILURE_STAGES = Object.freeze([
  "input-validation",
  "browser-startup",
  "navigation",
  "submission-assertion",
  "cleanup",
  "input-disposal",
  "unclassified",
] as const);
export type RuntimeLoginFailureStage =
  (typeof RUNTIME_LOGIN_FAILURE_STAGES)[number];
export const RUNTIME_LOGIN_CLEANUP_STATUSES = Object.freeze([
  "not-acquired",
  "confirmed",
  "unconfirmed",
] as const);
export type RuntimeLoginCleanupStatus =
  (typeof RUNTIME_LOGIN_CLEANUP_STATUSES)[number];

/** Reconstruct only allowlisted metadata; never retain an exception or cause. */
export class RuntimeLoginFailure extends RuntimeLoginError {
  readonly failureStage: RuntimeLoginFailureStage;
  readonly cleanupStatus: RuntimeLoginCleanupStatus;

  constructor(failureStage: unknown, cleanupStatus: unknown) {
    super("runtime-login-failed");
    this.failureStage =
      RUNTIME_LOGIN_FAILURE_STAGES.find((stage) => stage === failureStage) ??
      "unclassified";
    this.cleanupStatus =
      RUNTIME_LOGIN_CLEANUP_STATUSES.find(
        (status) => status === cleanupStatus,
      ) ?? "unconfirmed";
  }
}

function fail(code: RuntimeLoginErrorCode): never {
  throw new RuntimeLoginError(code);
}

function validateAccount(candidate: unknown): RuntimeLoginAccount {
  const parsed = accountSchema.safeParse(candidate);
  if (
    !parsed.success ||
    parsed.data.username.trim().length === 0 ||
    parsed.data.password.trim().length === 0
  ) {
    return fail("invalid-runtime-input");
  }
  return parsed.data;
}

function validateRequest(candidate: RuntimeLoginRequest): RuntimeLoginRequest {
  const parsed = requestSchema.safeParse(candidate);
  if (!parsed.success) return fail("invalid-runtime-input");
  const request = parsed.data;
  const now = Date.now();
  if (request.expiresAt <= now) return fail("expired-runtime-input");
  if (request.expiresAt - now > 15 * 60 * 1000)
    return fail("invalid-runtime-input");
  let origin: URL;
  try {
    origin = new URL(request.scope.environment.approvedOrigin);
  } catch {
    return fail("invalid-runtime-input");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== request.scope.environment.approvedOrigin
  ) {
    return fail("invalid-runtime-input");
  }
  return request;
}

function sameScope(
  left: RuntimeSecretScope,
  right: RuntimeSecretScope,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.runId === right.runId &&
    left.scenarioId === right.scenarioId &&
    left.dataBinding === right.dataBinding &&
    left.environment.id === right.environment.id &&
    left.environment.revision === right.environment.revision &&
    left.environment.approvedOrigin === right.environment.approvedOrigin
  );
}

/** Call before prompting and again before the consumer can acquire a browser. */
export function validateRuntimeLoginRequest(
  descriptor: PreparedInputDescriptor,
  candidate: RuntimeLoginRequest,
): RuntimeLoginRequest {
  const request = validateRequest(candidate);
  if (
    !descriptor ||
    !Array.isArray(descriptor.scenarios) ||
    descriptor.scenarios.length !== 1 ||
    !Array.isArray(descriptor.dataReferences?.rows) ||
    descriptor.dataReferences.rows.length !== 1 ||
    !descriptor.environment
  ) {
    return fail("invalid-runtime-input");
  }
  const scenario = descriptor.scenarios.find(
    (item) => item?.id === request.scope.scenarioId,
  );
  const reference = descriptor.dataReferences?.rows.find(
    (item) => item?.scenarioId === request.scope.scenarioId,
  );
  if (
    descriptor.dataReferences.binding !== request.scope.dataBinding ||
    !scenario ||
    !reference?.secret ||
    !reference.dataset ||
    !scenario.dataReference?.dataset ||
    reference.secret.id !== request.account.id ||
    reference.secret.revision !== request.account.revision ||
    scenario.dataReference?.dataset?.id !== reference.dataset?.id ||
    scenario.dataReference?.dataset?.revision !== reference.dataset?.revision ||
    scenario.dataReference.rowId !== reference.rowId ||
    scenario.dataReference.secret?.id !== reference.secret.id ||
    scenario.dataReference.secret.revision !== reference.secret.revision ||
    scenario.account?.secretReference?.id !== reference.secret.id ||
    (scenario.account.secretReference.revision !== undefined &&
      scenario.account.secretReference.revision !==
        reference.secret.revision) ||
    descriptor.environment.id !== request.scope.environment.id ||
    descriptor.environment.revision !== request.scope.environment.revision ||
    descriptor.environment.approvedOrigin !==
      request.scope.environment.approvedOrigin
  ) {
    return fail("runtime-scope-mismatch");
  }
  return request;
}

export class InMemoryRuntimeSecretProvider implements RuntimeSecretProvider {
  #request: RuntimeLoginRequest;
  #account: RuntimeLoginAccount | undefined;
  #expiry?: NodeJS.Timeout;

  constructor(request: RuntimeLoginRequest, account: RuntimeLoginAccount) {
    this.#request = validateRequest(request);
    this.#account = validateAccount(account);
    this.#expiry = setTimeout(
      () => this.dispose(),
      this.#request.expiresAt - Date.now(),
    );
    this.#expiry.unref();
  }

  async resolve(
    reference: SecretReference,
    scope?: RuntimeSecretScope,
  ): Promise<string> {
    validateRequest(this.#request);
    if (!this.#account) return fail("runtime-input-unavailable");
    const parsedScope = scopeSchema.safeParse(scope);
    const parsedReference = secretReferenceSchema.safeParse(reference);
    if (
      !parsedScope.success ||
      !parsedReference.success ||
      !sameScope(this.#request.scope, parsedScope.data) ||
      parsedReference.data.id !== this.#request.account.id ||
      parsedReference.data.revision !== this.#request.account.revision
    ) {
      return fail("runtime-scope-mismatch");
    }
    return parsedReference.data.field === "username"
      ? this.#account.username
      : this.#account.password;
  }

  dispose(): void {
    this.#account = undefined;
    clearTimeout(this.#expiry);
  }

  toJSON(): { account: RuntimeLoginRequest["account"] } {
    return { account: { ...this.#request.account } };
  }
}

export interface RuntimeLoginResult {
  readonly status: "completed";
  readonly scope: RuntimeSecretScope;
  readonly account: RuntimeLoginRequest["account"];
}

class RuntimeLoginValues implements RuntimeLoginAccount {
  #values: RuntimeLoginAccount | undefined;
  #reference: RuntimeLoginRequest["account"];

  constructor(
    values: RuntimeLoginAccount,
    reference: RuntimeLoginRequest["account"],
  ) {
    this.#values = values;
    this.#reference = { ...reference };
  }

  get username(): string {
    if (!this.#values) return fail("runtime-input-unavailable");
    return this.#values.username;
  }

  get password(): string {
    if (!this.#values) return fail("runtime-input-unavailable");
    return this.#values.password;
  }

  dispose(): void {
    this.#values = undefined;
  }

  toJSON(): { account: RuntimeLoginRequest["account"] } {
    return { account: { ...this.#reference } };
  }
}

/** The consumer is trusted reviewed code, not uploaded code or a job serializer. */
export async function consumeRuntimeLoginInputs(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  provider: RuntimeSecretProvider,
  consume: (account: RuntimeLoginAccount) => Promise<void>,
): Promise<RuntimeLoginResult> {
  let consumerFailure: RuntimeLoginFailure | undefined;
  try {
    const reviewed = validateRuntimeLoginRequest(descriptor, request);
    let account: RuntimeLoginValues | undefined;
    try {
      const username = await provider.resolve(
        { ...reviewed.account, field: "username" },
        reviewed.scope,
      );
      const password = await provider.resolve(
        { ...reviewed.account, field: "password" },
        reviewed.scope,
      );
      account = new RuntimeLoginValues(
        validateAccount({ username, password }),
        reviewed.account,
      );
    } catch (error) {
      if (error instanceof RuntimeLoginError)
        throw new RuntimeLoginError(error.code);
      return fail("runtime-input-unavailable");
    }
    try {
      validateRuntimeLoginRequest(descriptor, reviewed);
      try {
        await consume(account);
      } catch (error) {
        // Never propagate a browser exception that may embed credentials.
        if (error instanceof RuntimeLoginFailure) {
          consumerFailure = new RuntimeLoginFailure(
            error.failureStage,
            error.cleanupStatus,
          );
          throw consumerFailure;
        }
        return fail("runtime-login-failed");
      }
    } finally {
      account?.dispose();
      account = undefined;
    }
    return {
      status: "completed",
      scope: reviewed.scope,
      account: reviewed.account,
    };
  } finally {
    try {
      provider.dispose?.();
    } catch {
      throw (
        consumerFailure ??
        new RuntimeLoginFailure("input-disposal", "unconfirmed")
      );
    }
  }
}
