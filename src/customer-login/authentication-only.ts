import { DECLARED_BLOCKED_RESOURCES } from "./declared-resources";
import type { Page, Request } from "@playwright/test";
import type { LoginRequestPolicy } from "../execution/runtime-login-browser";
import { RuntimeLoginFailure } from "../input-preparation/runtime-login";

/** A trusted composition choice, never a replacement for per-run authorization. */
export const PARTAY_AUTHENTICATION_ONLY_POLICY = Object.freeze({
  id: "partay-authentication-only",
  revision: "v1",
} as const);
export type AuthenticationOnlyBinding =
  typeof PARTAY_AUTHENTICATION_ONLY_POLICY;

const BACKGROUND_PATHS = Object.freeze([
  "/groups",
  "/agent/greeting",
  "/me/notifications",
  "/dm",
  "/connections/requests",
  "/events",
]);
const BACKGROUND_CATEGORIES = [
  "communities",
  "greeting",
  "notifications",
  "direct-messages",
  "connection-requests",
  "events",
] as const;
const INITIAL_PATHS = new Set(["/agent/avatar-config", "/meta/taxonomies"]);

export async function assertSignInMode(page: Page): Promise<void> {
  const button = page.locator("#overlay #authGo");
  const password = page.locator("#overlay #password");
  const registration = page.locator("#authUp");
  if (
    (await button.count()) !== 1 ||
    !(await button.isVisible()) ||
    (await button.innerText()).trim() !== "Sign in" ||
    (await password.count()) !== 1 ||
    (await password.getAttribute("autocomplete")) !== "current-password" ||
    (await registration.count()) !== 1 ||
    (await registration.isVisible())
  ) {
    throw new RuntimeLoginFailure(
      "form-visible",
      "unconfirmed",
      undefined,
      "operational",
    );
  }
}

/** No profile, response body, token, input value or arbitrary URL is retained. */
export function createAuthenticationOnlyPolicy(page: Page, targetUrl: string) {
  const target = new URL(targetUrl);
  const used = new Map<string, number>();
  const excluded = Object.fromEntries(
    BACKGROUND_CATEGORIES.map((category) => [category, 0]),
  );
  const blockedResources = Object.fromEntries(
    DECLARED_BLOCKED_RESOURCES.map((resource) => [resource.category, 0]),
  );
  let pendingDenials = 0;
  let armed = false;
  let authenticated = false;
  let identityConfirmed = false;
  let failed = false;
  const fail = (): never => {
    failed = true;
    throw new RuntimeLoginFailure(
      "request-policy",
      "unconfirmed",
      undefined,
      "request-policy",
    );
  };
  const take = (key: string, budget = 1): void => {
    const count = used.get(key) ?? 0;
    if (count >= budget) fail();
    // Reserve synchronously before any await or transport; concurrent repeats cannot pass.
    used.set(key, count + 1);
  };
  const policy: LoginRequestPolicy = {
    denyKnownResource(request) {
      if (
        failed ||
        !used.has("document") ||
        request.isNavigationRequest() ||
        request.method() !== "GET"
      )
        return undefined;
      const resource = DECLARED_BLOCKED_RESOURCES.find(
        (entry) =>
          entry.url === request.url() &&
          entry.resourceType === request.resourceType(),
      );
      if (!resource) return undefined;
      take(`denied:${resource.category}`);
      pendingDenials++;
      return () => {
        pendingDenials--;
        blockedResources[resource.category]++;
      };
    },
    async allow(request: Request) {
      if (failed) return fail();
      const url = new URL(request.url());
      if (
        url.origin !== target.origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.href !== `${url.origin}${url.pathname}`
      )
        return fail();
      if (request.isNavigationRequest()) {
        if (
          request.url() !== targetUrl ||
          request.method() !== "GET" ||
          request.frame() !== page.mainFrame()
        )
          return fail();
        take("document");
        return true;
      }
      if (request.resourceType() !== "fetch") return fail();
      const path = url.pathname;
      if (request.method() === "GET" && INITIAL_PATHS.has(path)) {
        if (authenticated) return fail();
        take(path);
        return true;
      }
      if (path === "/health" && request.method() === "GET") {
        // Source has one initial auth-provider read and one post-login feature read.
        take(authenticated ? "post-login-health" : "initial-health");
        return true;
      }
      if (path === "/auth/login" && request.method() === "POST") {
        if (!armed || pendingDenials || !used.has("document")) return fail();
        take("login");
        const contentType = await request.headerValue("content-type");
        if (
          !contentType ||
          !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(
            contentType,
          )
        )
          return fail();
        // Recheck observable mode at transport admission, after click handlers have run.
        try {
          await assertSignInMode(page);
        } catch {
          return fail();
        }
        if (failed || pendingDenials) return fail();
        return true;
      }
      if (path === "/me" && request.method() === "GET") {
        if (!authenticated) return fail();
        take("me");
        return true;
      }
      const index = BACKGROUND_PATHS.indexOf(path);
      if (index >= 0 && request.method() === "GET" && identityConfirmed) {
        excluded[BACKGROUND_CATEGORIES[index]]++;
        return false; // abort, never fulfill a fabricated application response
      }
      return fail();
    },
    assertDispatchable(request) {
      if (failed || (request.method() === "POST" && pendingDenials)) fail();
    },
    response(request, status) {
      if (failed) return fail();
      if (status < 200 || status >= 300) return fail();
      const path = new URL(request.url()).pathname;
      if (path === "/auth/login") authenticated = true;
      if (path === "/me") identityConfirmed = true;
    },
    assertComplete() {
      if (failed || pendingDenials || !authenticated || !identityConfirmed)
        fail();
    },
  };
  return {
    ...policy,
    async armSubmission() {
      await assertSignInMode(page);
      if (armed || failed || pendingDenials) return fail();
      armed = true;
    },
    snapshot() {
      return {
        scope: "authentication-only" as const,
        policy: PARTAY_AUTHENTICATION_ONLY_POLICY,
        downstream: "untested-blocked" as const,
        productDefectEvidence: false as const,
        criticalRequests: {
          loginSucceeded: authenticated,
          identityReadSucceeded: identityConfirmed,
        },
        knownBlockedResources: {
          total: Object.values(blockedResources).reduce((a, b) => a + b, 0),
          categories: { ...blockedResources },
        },
        excludedBackgroundRequests: Object.values(excluded).reduce(
          (a, b) => a + b,
          0,
        ),
        exclusions: { ...excluded },
      };
    },
  };
}

export async function assertNoAdditionalInteraction(page: Page): Promise<void> {
  const onboarding = page.locator("#onboard");
  const navigation = page.locator("#bottomnav");
  // Both branches hide the overlay. Only the normal branch shows bottomnav.
  if (
    (await onboarding.count()) !== 1 ||
    (await onboarding.isVisible()) ||
    (await navigation.count()) !== 1 ||
    !(await navigation.isVisible())
  ) {
    throw new RuntimeLoginFailure(
      "overlay-dismissal",
      "unconfirmed",
      undefined,
      "operational",
    );
  }
}
