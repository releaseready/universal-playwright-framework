import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  RuntimeLoginFailure,
  type RuntimeLoginFailureStage,
  type RuntimeLoginCleanupStatus,
} from "../input-preparation/runtime-login";

export interface RuntimeLoginBrowserOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Trusted in-process test/launcher seam, never part of a serialized job. */
  readonly launchBrowser?: (timeoutMs: number) => Promise<Browser>;
}

export const LOGIN_CLEANUP_TIMEOUT_MS = 1_000;

/** Transport guard: never let the browser automatically follow an HTTP redirect. */
export async function guardLoginRequests(
  context: BrowserContext,
  approvedOrigin: string,
  loginUrl: string,
): Promise<() => void> {
  const target = new URL(loginUrl);
  if (
    target.origin !== approvedOrigin ||
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password
  ) {
    throw new Error("Invalid login destination policy");
  }
  let blocked = false;
  await context.routeWebSocket("**/*", (socket) => {
    blocked = true;
    socket.close();
  });
  await context.route("**/*", async (route) => {
    try {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.origin !== approvedOrigin ||
        url.username ||
        url.password ||
        (request.isNavigationRequest() && request.url() !== loginUrl)
      ) {
        blocked = true;
        await route.abort("blockedbyclient");
        return;
      }
      const response = await route.fetch({ maxRedirects: 0 });
      try {
        // Playwright routing does not intercept subsequent HTTP redirect hops.
        // Reject even same-origin redirects rather than handing a 30x to Chromium.
        if (response.status() >= 300 && response.status() < 400) {
          blocked = true;
          await route.abort("blockedbyclient");
          return;
        }
        await route.fulfill({ response });
      } finally {
        await response.dispose();
      }
    } catch {
      blocked = true;
      await route.abort("blockedbyclient").catch(() => undefined);
    }
  });
  return () => {
    if (blocked) throw new Error("Login request policy was not satisfied");
  };
}

export async function withFreshLoginPage(
  consume: (
    page: Page,
    setStage: (stage: "navigation" | "submission-assertion") => void,
  ) => Promise<void>,
  options: RuntimeLoginBrowserOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new RuntimeLoginFailure("input-validation", "not-acquired");
  }
  const controller = new AbortController();
  const closures = new Map<Browser | BrowserContext, Promise<boolean>>();
  const close = (resource: Browser | BrowserContext | undefined): void => {
    if (resource && !closures.has(resource)) {
      closures.set(
        resource,
        Promise.resolve()
          .then(() => resource.close())
          .then(
            () => true,
            () => false,
          ),
      );
    }
  };
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let pendingAcquisition = false;
  let acquisitionInterrupted = false;
  let stage: RuntimeLoginFailureStage = "browser-startup";
  let failureStage: RuntimeLoginFailureStage | undefined;
  let cleanupStatus: RuntimeLoginCleanupStatus = "unconfirmed";
  const abort = (): void => {
    controller.abort();
    close(context);
    close(browser);
  };
  const timer = setTimeout(abort, timeoutMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const deadline = Date.now() + timeoutMs;
  const checkActive = (): void => {
    if (controller.signal.aborted) {
      close(context);
      close(browser);
      throw new Error("Login browser operation interrupted");
    }
  };
  let rejectInterrupted: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    rejectInterrupted = () =>
      reject(new Error("Login browser operation interrupted"));
    controller.signal.addEventListener("abort", rejectInterrupted, {
      once: true,
    });
  });
  const work = async (): Promise<void> => {
    checkActive();
    pendingAcquisition = true;
    try {
      browser = await (options.launchBrowser
        ? options.launchBrowser(timeoutMs)
        : chromium.launch({ headless: true, timeout: timeoutMs }));
    } finally {
      pendingAcquisition = false;
    }
    checkActive();
    pendingAcquisition = true;
    try {
      context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
      });
    } finally {
      pendingAcquisition = false;
    }
    checkActive();
    const page = await context.newPage();
    checkActive();
    page.setDefaultTimeout(Math.max(1, deadline - Date.now()));
    page.setDefaultNavigationTimeout(Math.max(1, deadline - Date.now()));
    stage = "submission-assertion";
    await consume(page, (next) => {
      if (next === "navigation" || next === "submission-assertion")
        stage = next;
    });
    checkActive();
  };
  try {
    await Promise.race([work(), interrupted]);
  } catch {
    failureStage = stage;
    acquisitionInterrupted = pendingAcquisition;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    if (rejectInterrupted)
      controller.signal.removeEventListener("abort", rejectInterrupted);
    close(context);
    let cleanupTimer: NodeJS.Timeout | undefined;
    try {
      // Give normal context shutdown a head start, but never let it prevent
      // the independent browser-close attempt within the shared cleanup budget.
      if (context) {
        await Promise.race([
          closures.get(context),
          new Promise<void>((resolve) => {
            cleanupTimer = setTimeout(resolve, LOGIN_CLEANUP_TIMEOUT_MS / 2);
          }),
        ]);
        clearTimeout(cleanupTimer);
      }
      close(browser);
      const confirmed = await Promise.race([
        Promise.all(closures.values()).then((results) =>
          results.every(Boolean),
        ),
        new Promise<false>((resolve) => {
          cleanupTimer = setTimeout(
            () => resolve(false),
            LOGIN_CLEANUP_TIMEOUT_MS / 2,
          );
        }),
      ]);
      cleanupStatus =
        !confirmed || pendingAcquisition || acquisitionInterrupted
          ? "unconfirmed"
          : browser || context
            ? "confirmed"
            : "not-acquired";
    } finally {
      clearTimeout(cleanupTimer);
    }
  }
  if (failureStage || cleanupStatus === "unconfirmed") {
    throw new RuntimeLoginFailure(failureStage ?? "cleanup", cleanupStatus);
  }
}
