import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

export interface RuntimeLoginBrowserOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Trusted in-process test/launcher seam, never part of a serialized job. */
  readonly launchBrowser?: (timeoutMs: number) => Promise<Browser>;
}

export async function withFreshLoginPage(
  consume: (page: Page) => Promise<void>,
  options: RuntimeLoginBrowserOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error("Login browser timeout is invalid");
  }
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let closing: Promise<void> | undefined;
  let closeFailed = false;
  const closeBrowser = (): void => {
    if (browser && !closing) {
      closing = browser.close().catch(() => {
        closeFailed = true;
      });
    }
  };
  controller.signal.addEventListener("abort", closeBrowser, { once: true });
  const deadline = Date.now() + timeoutMs;
  try {
    controller.signal.throwIfAborted();
    browser = await (options.launchBrowser
      ? options.launchBrowser(timeoutMs)
      : chromium.launch({ headless: true, timeout: timeoutMs }));
    controller.signal.throwIfAborted();
    context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    controller.signal.throwIfAborted();
    const page = await context.newPage();
    controller.signal.throwIfAborted();
    page.setDefaultTimeout(Math.max(1, deadline - Date.now()));
    page.setDefaultNavigationTimeout(Math.max(1, deadline - Date.now()));
    await consume(page);
    controller.signal.throwIfAborted();
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", closeBrowser);
    try {
      await context?.close();
    } finally {
      closeBrowser();
      await closing;
      if (closeFailed) throw new Error("Login browser cleanup failed");
    }
  }
}
