import { expect } from "@playwright/test";
import type {
  PreparedInputDescriptor,
  RuntimeSecretProvider,
} from "../input-preparation";
import {
  consumeRuntimeLoginInputs,
  RuntimeLoginError,
  type RuntimeLoginAccount,
  type RuntimeLoginRequest,
  type RuntimeLoginResult,
} from "../input-preparation/runtime-login";
import { withOperatorLoginInputs } from "../input-preparation/operator-prompt";
import {
  withFreshLoginPage,
  type RuntimeLoginBrowserOptions,
} from "../execution/runtime-login-browser";

export const PARTAY_LOGIN_URL = "https://partay.staging.noutify.app/";

export function verifyPartayLogin(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  provider: RuntimeSecretProvider,
  options: RuntimeLoginBrowserOptions = {},
): Promise<RuntimeLoginResult> {
  return consumeRuntimeLoginInputs(
    descriptor,
    request,
    provider,
    loginConsumer(descriptor, request, options),
  );
}

export function promptAndVerifyPartayLogin(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  options: RuntimeLoginBrowserOptions = {},
): Promise<RuntimeLoginResult> {
  validateTarget(descriptor, request);
  return withOperatorLoginInputs(
    descriptor,
    request,
    loginConsumer(descriptor, request, options),
    { signal: options.signal },
  );
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
      async (page) => {
        let blockedNavigation = false;
        await page.context().route("**/*", async (route) => {
          const navigation = route.request();
          if (
            navigation.isNavigationRequest() &&
            navigation.url() !== PARTAY_LOGIN_URL
          ) {
            blockedNavigation = true;
            await route.abort("blockedbyclient");
            return;
          }
          await route.fallback();
        });
        await page.goto(PARTAY_LOGIN_URL);
        await expect(page).toHaveURL(PARTAY_LOGIN_URL);
        const overlay = page.locator("#overlay");
        await expect(overlay).toBeVisible();
        await overlay.locator("#username").fill(account.username);
        await overlay.locator("#password").fill(account.password);
        await overlay.locator("#authGo").click();
        await expect(overlay).toBeHidden();
        await expect(page).toHaveURL(PARTAY_LOGIN_URL);
        const logo = page.locator("#brandLogo");
        await expect(logo).toBeVisible();
        expect(await logo.innerText()).toBe("Partay");
        if (blockedNavigation) {
          throw new Error("Login attempted an unapproved document destination");
        }
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
