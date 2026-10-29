import { expect } from "@playwright/test";
import type {
  PreparedInputDescriptor,
  RuntimeSecretProvider,
} from "../input-preparation";
import {
  consumeRuntimeLoginInputs,
  RuntimeLoginError,
  RuntimeLoginFailure,
  type RuntimeLoginAccount,
  type RuntimeLoginRequest,
  type RuntimeLoginResult,
  type RuntimeLoginFailureReport,
} from "../input-preparation/runtime-login";
import { withOperatorLoginInputs } from "../input-preparation/operator-prompt";
import { PrivateFileLoginDeferredError } from "../input-preparation/private-login-file";
import {
  withFreshLoginPage,
  guardLoginRequests,
  type RuntimeLoginBrowserOptions,
} from "../execution/runtime-login-browser";

import {
  PARTAY_AUTHENTICATION_ONLY_POLICY,
  createAuthenticationOnlyPolicy,
  assertSignInMode,
  assertNoAdditionalInteraction,
  type AuthenticationOnlyBinding,
} from "./authentication-only";

export interface PartayLoginOptions extends RuntimeLoginBrowserOptions {
  /** Trusted reviewed composition only. Does not authorize a run or transmission. */
  readonly authenticationOnlyPolicy?: AuthenticationOnlyBinding;
}
export interface PartayLoginResult extends RuntimeLoginResult {
  readonly authenticationOnly?: ReturnType<
    ReturnType<typeof createAuthenticationOnlyPolicy>["snapshot"]
  > & { readonly cleanupStatus: "confirmed" };
}

function validatePolicy(options: PartayLoginOptions): PartayLoginOptions {
  const binding = options.authenticationOnlyPolicy;
  if (
    binding !== undefined &&
    (binding?.id !== PARTAY_AUTHENTICATION_ONLY_POLICY.id ||
      binding?.revision !== PARTAY_AUTHENTICATION_ONLY_POLICY.revision)
  ) {
    throw new RuntimeLoginError("runtime-scope-mismatch");
  }
  return {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    launchBrowser: options.launchBrowser,
    ...(binding
      ? { authenticationOnlyPolicy: PARTAY_AUTHENTICATION_ONLY_POLICY }
      : {}),
  };
}

export const PARTAY_LOGIN_URL = "https://partay.staging.noutify.app/";

export async function verifyPartayLogin(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  provider: RuntimeSecretProvider,
  options: PartayLoginOptions = {},
): Promise<PartayLoginResult> {
  return withSafeFailure(async () => {
    let selected: PartayLoginOptions;
    try {
      selected = validatePolicy(options);
    } catch (error) {
      provider.dispose?.();
      throw error;
    }
    let evidence: PartayLoginResult["authenticationOnly"];
    const result = await consumeRuntimeLoginInputs(
      descriptor,
      request,
      provider,
      loginConsumer(descriptor, request, selected, (value) => {
        evidence = value;
      }),
    );
    return { ...result, ...(evidence ? { authenticationOnly: evidence } : {}) };
  });
}

export async function promptAndVerifyPartayLogin(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  options: PartayLoginOptions = {},
): Promise<PartayLoginResult> {
  return withSafeFailure(async () => {
    const selected = validatePolicy(options);
    let evidence: PartayLoginResult["authenticationOnly"];
    validateTarget(descriptor, request);
    const result = await withOperatorLoginInputs(
      descriptor,
      request,
      loginConsumer(descriptor, request, selected, (value) => {
        evidence = value;
      }),
      { signal: selected.signal },
    );
    return { ...result, ...(evidence ? { authenticationOnly: evidence } : {}) };
  });
}

export async function privateFileAndVerifyPartayLogin(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  filePath: string,
  repositoryRoot: string,
  options: PartayLoginOptions = {},
): Promise<PartayLoginResult> {
  void descriptor;
  void request;
  void filePath;
  void repositoryRoot;
  void options;
  throw new PrivateFileLoginDeferredError();
}

async function withSafeFailure(
  run: () => Promise<PartayLoginResult>,
): Promise<PartayLoginResult> {
  try {
    return await run();
  } catch (error) {
    throw (
      RuntimeLoginFailure.fromUnknown(error) ??
      new RuntimeLoginFailure(
        "input-validation",
        "not-acquired",
        undefined,
        "input",
      )
    );
  }
}

export function partayLoginFailureReport(
  error: unknown,
): RuntimeLoginFailureReport {
  const safe =
    RuntimeLoginFailure.fromUnknown(error) ??
    new RuntimeLoginFailure("unclassified", "unconfirmed");
  return {
    status: "not-verified" as const,
    failureStage: safe.failureStage,
    failureClassification: safe.failureClassification,
    cleanupStatus: safe.cleanupStatus,
    ...(safe.policyReason ? { policyReason: safe.policyReason } : {}),
    automaticRetryAttempted: false as const,
  };
}

function validateTarget(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
): void {
  if (
    descriptor?.environment?.initialTargetUrl !== PARTAY_LOGIN_URL ||
    request?.scope?.environment?.approvedOrigin !==
      new URL(PARTAY_LOGIN_URL).origin
  ) {
    throw new RuntimeLoginError("runtime-scope-mismatch");
  }
}

function loginConsumer(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  options: PartayLoginOptions,
  record: (
    evidence: NonNullable<PartayLoginResult["authenticationOnly"]>,
  ) => void,
): (account: RuntimeLoginAccount) => Promise<void> {
  return async (account) => {
    validateTarget(descriptor, request);
    let policy: ReturnType<typeof createAuthenticationOnlyPolicy> | undefined;
    await withFreshLoginPage(
      async (page, setStage) => {
        setStage("navigation");
        policy = options.authenticationOnlyPolicy
          ? createAuthenticationOnlyPolicy(page, PARTAY_LOGIN_URL)
          : undefined;
        const assertRequestsAllowed = await guardLoginRequests(
          page.context(),
          request.scope.environment.approvedOrigin,
          PARTAY_LOGIN_URL,
          policy,
        );
        await page.goto(PARTAY_LOGIN_URL);
        await expect(page).toHaveURL(PARTAY_LOGIN_URL);
        setStage("form-visible");
        const overlay = page.locator("#overlay");
        await expect(overlay).toBeVisible();
        if (policy) {
          assertRequestsAllowed();
          await assertSignInMode(page);
        }
        setStage("username-fill");
        await overlay.locator("#username").fill(account.username);
        setStage("password-fill");
        await overlay.locator("#password").fill(account.password);
        setStage("submit-click");
        if (policy) {
          assertRequestsAllowed();
          await policy.armSubmission();
        }
        await overlay.locator("#authGo").click();
        setStage("overlay-dismissal");
        await expect(overlay).toBeHidden();
        if (policy) await assertNoAdditionalInteraction(page);
        setStage("final-url");
        await expect(page).toHaveURL(PARTAY_LOGIN_URL);
        const logo = page.locator("#brandLogo");
        setStage("brand-visible");
        await expect(logo).toBeVisible();
        setStage("brand-text");
        // Separate reading from comparison: a failed/unfinished read is operational.
        const brandText = await logo.innerText();
        if (brandText !== "Partay") {
          throw new RuntimeLoginFailure(
            "brand-text",
            "unconfirmed",
            undefined,
            policy ? "operational" : "assertion-failed",
          );
        }
        setStage("request-policy");
        assertRequestsAllowed();
        policy?.assertComplete();
      },
      {
        ...options,
        timeoutMs: Math.min(
          options.timeoutMs ?? 30_000,
          request.expiresAt - Date.now(),
        ),
      },
    );
    if (policy) record({ ...policy.snapshot(), cleanupStatus: "confirmed" });
  };
}
