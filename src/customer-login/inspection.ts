import type { BrowserContext, Page } from "@playwright/test";
import {
  withFreshLoginPage,
  type RuntimeLoginBrowserOptions,
} from "../execution/runtime-login-browser";
import { RuntimeLoginFailure } from "../input-preparation/runtime-login";
import { PARTAY_LOGIN_URL } from "./partay";

const FETCH_PATHS = new Set([
  "/agent/avatar-config",
  "/meta/taxonomies",
  "/health",
]);
// No exact static-asset paths were retained as reviewed evidence. Deny them.

/** Internal browser seam; the operator entry point supplies the fixed Partay URL. */
export async function guardInspectionRequests(
  context: BrowserContext,
  page: Page,
  targetUrl: string,
) {
  const target = new URL(targetUrl);
  if (
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !(
      targetUrl === PARTAY_LOGIN_URL ||
      (target.protocol === "http:" &&
        target.hostname === "127.0.0.1" &&
        target.pathname === "/")
    )
  ) {
    throw new Error("Inspection target unavailable");
  }
  let documentRequested = false;
  let pending = 0;
  let blockedRequests = 0;
  let redirectsBlocked = 0;
  let transportFailed = false;
  let active = true;
  let drainFailed = false;
  let drained: (() => void) | undefined;
  let stopPromise: Promise<void> | undefined;
  await context.routeWebSocket("**/*", (socket) => {
    blockedRequests++;
    socket.close();
  });
  await context.route("**/*", async (route) => {
    pending++;
    try {
      const request = route.request();
      const url = new URL(request.url());
      const sameOrigin =
        url.origin === target.origin &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.href === `${url.origin}${url.pathname}`;
      const document = request.isNavigationRequest();
      const allowedDocument =
        document &&
        !documentRequested &&
        request.url() === targetUrl &&
        request.frame() === page.mainFrame();
      const allowedResource =
        !document &&
        request.resourceType() === "fetch" &&
        FETCH_PATHS.has(url.pathname);
      if (
        !active ||
        request.method() !== "GET" ||
        !sameOrigin ||
        !(allowedDocument || allowedResource)
      ) {
        blockedRequests++;
        await route.abort("blockedbyclient");
        return;
      }
      if (allowedDocument) documentRequested = true;
      const headers = { ...request.headers() };
      delete headers.cookie;
      delete headers.authorization;
      // Empty Cookie prevents the request context cookie jar being applied.
      headers.cookie = "";
      const response = await route.fetch({
        headers,
        maxRedirects: 0,
        maxRetries: 0,
        timeout: 10_000,
      });
      try {
        if (response.status() >= 300 && response.status() < 400) {
          redirectsBlocked++;
          await route.abort("blockedbyclient");
          return;
        }
        const responseHeaders = { ...response.headers() };
        delete responseHeaders["set-cookie"];
        await route.fulfill({ response, headers: responseHeaders });
      } finally {
        await response.dispose();
      }
    } catch {
      transportFailed = true;
      await route.abort("blockedbyclient").catch(() => undefined);
    } finally {
      pending--;
      if (pending === 0) drained?.();
    }
  });
  return {
    stop: (signal?: AbortSignal): Promise<void> => {
      active = false;
      stopPromise ??=
        pending === 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              const finish = (): void => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", interrupted);
                drained = undefined;
                resolve();
              };
              const interrupted = (): void => {
                drainFailed = true;
                finish();
              };
              const timer = setTimeout(interrupted, 2_000);
              drained = finish;
              signal?.addEventListener("abort", interrupted, { once: true });
              if (signal?.aborted) interrupted();
            });
      return stopPromise;
    },
    assertComplete: () => {
      if (pending || drainFailed || redirectsBlocked || transportFailed)
        throw new Error("Inspection transport incomplete");
    },
    snapshot: () => ({ blockedRequests, redirectsBlocked }),
  };
}

async function presence(page: Page, selector: string) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count > 1) throw new Error("Inspection binding ambiguous");
  return {
    present: count === 1,
    visible: count === 1 && (await locator.isVisible()),
  };
}

/** Records fixed facts only: no DOM dump, field values, freeform text or URLs. */
export async function observeLoginControls(page: Page) {
  const overlay = await presence(page, "#overlay");
  const logo = await presence(page, "#brandLogo");
  const brandLogo = {
    ...logo,
    text: logo.present
      ? (await page.locator("#brandLogo").innerText()) === "Partay"
        ? "Partay"
        : "other"
      : "absent",
  };
  const password = await presence(page, "#overlay #password");
  const eye = await presence(page, "#overlay button.pw-eye");
  const type = password.present
    ? await page.locator("#overlay #password").getAttribute("type")
    : null;
  const label = eye.present
    ? await page.locator("#overlay button.pw-eye").getAttribute("aria-label")
    : null;
  // Observation only: do not focus, hover, dispatch events, read values or click.
  return {
    overlay,
    brandLogo,
    password: {
      ...password,
      type: !password.present
        ? "absent"
        : type === "password" || type === "text"
          ? type
          : "other",
    },
    eye: {
      ...eye,
      label: !eye.present
        ? "absent"
        : label === "Show password" || label === "Hide password"
          ? label
          : "other",
      behavior: "unverified" as const,
      activations: 0 as const,
    },
  };
}

export async function inspectPartayLogin(
  options: RuntimeLoginBrowserOptions = {},
) {
  let evidence: Awaited<ReturnType<typeof observeLoginControls>> | undefined;
  let policy: Awaited<ReturnType<typeof guardInspectionRequests>> | undefined;
  await withFreshLoginPage(async (page, setStage) => {
    policy = await guardInspectionRequests(
      page.context(),
      page,
      PARTAY_LOGIN_URL,
    );
    setStage("navigation");
    await page.goto(PARTAY_LOGIN_URL, { waitUntil: "load" });
    if (page.url() !== PARTAY_LOGIN_URL)
      throw new Error("Inspection destination changed");
    setStage("form-visible");
    evidence = await observeLoginControls(page);
    await policy.stop(options.signal);
  }, options);
  try {
    policy?.assertComplete();
  } catch {
    throw new RuntimeLoginFailure(
      "request-policy",
      "confirmed",
      "transport-error",
      "request-policy",
    );
  }
  if (!evidence || !policy) throw new Error("Inspection unavailable");
  return {
    status: "observed" as const,
    ...evidence,
    requests: policy.snapshot(),
    cleanupStatus: "confirmed" as const,
    automaticRetryAttempted: false as const,
  };
}
