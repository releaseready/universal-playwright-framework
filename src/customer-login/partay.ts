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
} from "../input-preparation/runtime-login";
import { withOperatorLoginInputs } from "../input-preparation/operator-prompt";
import {
  withFreshLoginPage,
  guardLoginRequests,
  type RuntimeLoginBrowserOptions,
} from "../execution/runtime-login-browser";

export const PARTAY_LOGIN_URL = "https://partay.staging.noutify.app/";

export async function verifyPartayLogin(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  provider: RuntimeSecretProvider,
  options: RuntimeLoginBrowserOptions = {},
): Promise<RuntimeLoginResult> {
  return withSafeFailure(() =>
    consumeRuntimeLoginInputs(
      descriptor,
      request,
      provider,
      loginConsumer(descriptor, request, options),
    ),
  );
}

export async function promptAndVerifyPartayLogin(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  options: RuntimeLoginBrowserOptions = {},
): Promise<RuntimeLoginResult> {
  return withSafeFailure(() => {
    validateTarget(descriptor, request);
    return withOperatorLoginInputs(
      descriptor,
      request,
      loginConsumer(descriptor, request, options),
      { signal: options.signal },
    );
  });
}

async function withSafeFailure(
  run: () => Promise<RuntimeLoginResult>,
): Promise<RuntimeLoginResult> {
  try {
    return await run();
  } catch (error) {
    throw (
      RuntimeLoginFailure.fromUnknown(error) ??
      new RuntimeLoginFailure("input-validation", "not-acquired")
    );
  }
}

export function partayLoginFailureReport(error: unknown) {
  const safe =
    RuntimeLoginFailure.fromUnknown(error) ??
    new RuntimeLoginFailure("unclassified", "unconfirmed");
  return {
    status: "not-verified" as const,
    failureStage: safe.failureStage,
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
  options: RuntimeLoginBrowserOptions,
): (account: RuntimeLoginAccount) => Promise<void> {
  return async (account) => {
    validateTarget(descriptor, request);
    await withFreshLoginPage(
      async (page, setStage) => {
        setStage("navigation");
        const assertRequestsAllowed = await guardLoginRequests(
          page.context(),
          request.scope.environment.approvedOrigin,
          PARTAY_LOGIN_URL,
        );
        await page.goto(PARTAY_LOGIN_URL);
        await expect(page).toHaveURL(PARTAY_LOGIN_URL);
        setStage("form-visible");
        const overlay = page.locator("#overlay");
        await expect(overlay).toBeVisible();
        setStage("username-fill");
        await overlay.locator("#username").fill(account.username);
        setStage("password-fill");
        await overlay.locator("#password").fill(account.password);
        setStage("submit-click");
        await overlay.locator("#authGo").click();
        setStage("overlay-dismissal");
        await expect(overlay).toBeHidden();
        setStage("final-url");
        await expect(page).toHaveURL(PARTAY_LOGIN_URL);
        const logo = page.locator("#brandLogo");
        setStage("brand-visible");
        await expect(logo).toBeVisible();
        setStage("brand-text");
        expect(await logo.innerText()).toBe("Partay");
        setStage("request-policy");
        assertRequestsAllowed();
      },
      {
        ...options,
        timeoutMs: Math.min(
          options.timeoutMs ?? 30_000,
          request.expiresAt - Date.now(),
        ),
      },
    );
  };
}
