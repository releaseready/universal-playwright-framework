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
const STATIC_TYPES: Readonly<Record<string, RegExp>> = {
  stylesheet: /\.css$/i,
  script: /\.(?:js|mjs)$/i,
  image: /\.(?:png|jpg|jpeg|gif|svg|webp|ico)$/i,
  font: /\.(?:woff2?|ttf|otf)$/i,
};

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
        (request.resourceType() === "fetch"
          ? FETCH_PATHS.has(url.pathname)
          : STATIC_TYPES[request.resourceType()]?.test(url.pathname) === true);
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
    }
  });
  return {
    stop: () => {
      active = false;
    },
    assertComplete: () => {
      if (pending || redirectsBlocked || transportFailed)
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
  const password = page.locator("#overlay #password");
  const username = page.locator("#overlay #username");
  const eye = page.locator("#overlay button.pw-eye");
  if (
    !overlay.visible ||
    (await password.count()) !== 1 ||
    (await username.count()) !== 1 ||
    (await eye.count()) !== 1 ||
    !(await password.isVisible()) ||
    !(await eye.isVisible()) ||
    (await password.inputValue()) !== "" ||
    (await username.inputValue()) !== "" ||
    (await eye.getAttribute("type")) !== "button" ||
    (await eye.getAttribute("aria-label")) !== "Show password" ||
    (await password.getAttribute("type")) !== "password"
  ) {
    throw new Error("Inspection binding unavailable");
  }
  // Defense in depth: no form submission is part of this observation.
  await page.evaluate(() =>
    document.addEventListener(
      "submit",
      (event) => event.preventDefault(),
      true,
    ),
  );
  const before = { type: "password", label: "Show password" };
  await eye.click({ noWaitAfter: true });
  const type = await password.getAttribute("type");
  const label = await eye.getAttribute("aria-label");
  if (
    (await password.inputValue()) !== "" ||
    (await username.inputValue()) !== ""
  )
    throw new Error("Inspection field state changed");
  return {
    overlay,
    brandLogo,
    password: {
      before,
      after: {
        type: type === "password" || type === "text" ? type : "other",
        label:
          label === "Show password" || label === "Hide password"
            ? label
            : "other",
      },
      empty: true,
      eyeClicks: 1,
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
    policy.stop();
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
