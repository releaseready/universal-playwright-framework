import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium } from "@playwright/test";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";
import { withFreshLoginPage } from "../src/execution/runtime-login-browser";
import {
  guardInspectionRequests,
  observeLoginControls,
  inspectPartayLogin,
} from "../src/customer-login/inspection";

async function fixture(
  run: (url: string, hits: string[]) => Promise<void>,
  redirect = 0,
): Promise<void> {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<div id="brandLogo">Partay</div><form id="overlay"><input id="username"><input id="password" type="password"><button class="pw-eye" type="button" aria-label="Show password">Eye</button><button id="authGo">Sign in</button></form>',
      );
    } else if (redirect) {
      response.writeHead(redirect, { Location: "/forbidden" });
      response.end();
    } else {
      response.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}/`, hits);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("Given an owned page, only the exact GET fetch paths reach the server", async () => {
  await fixture(async (url, hits) => {
    await withFreshLoginPage(async (page) => {
      const policy = await guardInspectionRequests(page.context(), page, url);
      await page.goto(url);
      await page.evaluate(async () => {
        for (const path of [
          "/agent/avatar-config",
          "/meta/taxonomies",
          "/health",
        ])
          await fetch(path);
        for (const [path, method] of [
          ["/auth", "POST"],
          ["/health", "POST"],
          ["/health?x=1", "GET"],
          ["/health?", "GET"],
          ["/other", "GET"],
        ])
          await fetch(path, { method }).catch(() => undefined);
      });
      policy.assertComplete();
      assert.equal(policy.snapshot().blockedRequests, 5);
    });
    assert.deepEqual(hits, [
      "GET /",
      "GET /agent/avatar-config",
      "GET /meta/taxonomies",
      "GET /health",
    ]);
  });
});

for (const status of [301, 302, 303, 307, 308]) {
  for (const path of ["/agent/avatar-config", "/meta/taxonomies", "/health"]) {
    test(`Given a permitted ${path} fetch returning ${status}, no redirect destination is contacted`, async () => {
      await fixture(async (url, hits) => {
        await withFreshLoginPage(async (page) => {
          const policy = await guardInspectionRequests(
            page.context(),
            page,
            url,
          );
          await page.goto(url);
          await page.evaluate(async (path) => {
            await fetch(path).catch(() => undefined);
          }, path);
          assert.throws(() => policy.assertComplete());
        });
        assert.deepEqual(hits, ["GET /", `GET ${path}`]);
      }, status);
    });
  }
}

test("Given login controls, observation records initial facts and leaves eye behavior unverified", async () => {
  await fixture(async (url, hits) => {
    await withFreshLoginPage(async (page) => {
      await guardInspectionRequests(page.context(), page, url);
      await page.goto(url);
      const evidence = await observeLoginControls(page);
      assert.deepEqual(evidence.password, {
        present: true,
        visible: true,
        type: "password",
      });
      assert.deepEqual(evidence.eye, {
        present: true,
        visible: true,
        label: "Show password",
        behavior: "unverified",
        activations: 0,
      });
      assert.deepEqual(evidence.overlay, { present: true, visible: true });
      assert.deepEqual(evidence.brandLogo, {
        present: true,
        visible: true,
        text: "Partay",
      });
    });
    assert.deepEqual(hits, ["GET /"]);
  });
});

test("Given forbidden origins, resource types and forms, none reach a destination", async () => {
  await fixture(async (external, externalHits) =>
    fixture(async (url, hits) => {
      await withFreshLoginPage(async (page) => {
        const policy = await guardInspectionRequests(page.context(), page, url);
        await page.goto(url);
        const formBlocked = page.waitForEvent("requestfailed", {
          predicate: (request) =>
            request.isNavigationRequest() &&
            new URL(request.url()).pathname === "/health",
        });
        await page.evaluate(async (externalUrl) => {
          await fetch(externalUrl).catch(() => undefined);
          await fetch("/auth", {
            method: "POST",
            body: "SYNTHETIC_PRIVATE",
          }).catch(() => undefined);
          await new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = image.onerror = () => resolve();
            image.src = "/health";
          });
          await new Promise<void>((resolve) => {
            const socket = new WebSocket(externalUrl.replace("http:", "ws:"));
            socket.onclose = socket.onerror = () => resolve();
          });
          const frame = document.createElement("iframe");
          frame.name = "target";
          document.body.append(frame);
          const form = document.createElement("form");
          form.action = "/health";
          form.target = "target";
          document.body.append(form);
          form.submit();
        }, external);
        await formBlocked;
        policy.assertComplete();
        assert.ok(policy.snapshot().blockedRequests >= 5);
      });
      assert.deepEqual(hits, ["GET /"]);
      assert.deepEqual(externalHits, []);
    }),
  );
});

test("Given private field values and unexpected labels, observation exposes only fixed categories", async () => {
  await fixture(async (url) => {
    await withFreshLoginPage(async (page) => {
      await guardInspectionRequests(page.context(), page, url);
      await page.goto(url);
      await page.locator("#password").fill("SYNTHETIC_PRIVATE");
      await page.evaluate(() => {
        document.querySelector("#brandLogo")!.textContent = "SYNTHETIC_PRIVATE";
        document
          .querySelector(".pw-eye")!
          .setAttribute("aria-label", "SYNTHETIC_PRIVATE");
      });
      const result = await observeLoginControls(page);
      assert.equal(result.brandLogo.text, "other");
      assert.equal(result.eye.label, "other");
      assert.equal(result.eye.behavior, "unverified");
      assert.equal(result.eye.activations, 0);
      assert.equal(
        await page.locator("#password").inputValue(),
        "SYNTHETIC_PRIVATE",
      );
      assert.ok(!JSON.stringify(result).includes("SYNTHETIC_PRIVATE"));
    });
  });
});

test("Given cancelled inspection, no browser is acquired and no raw error is exposed", async () => {
  let acquired = false;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    inspectPartayLogin({
      signal: controller.signal,
      launchBrowser: async () => {
        acquired = true;
        throw new Error("SYNTHETIC_PRIVATE");
      },
    }),
    (error) => {
      const failure = RuntimeLoginFailure.fromUnknown(error);
      assert.equal(failure?.cleanupStatus, "not-acquired");
      assert.equal(failure?.failureClassification, "interrupted");
      assert.ok(!JSON.stringify(error).includes("SYNTHETIC_PRIVATE"));
      return true;
    },
  );
  assert.equal(acquired, false);
});

test("Given inspection context cleanup never settles, browser closure is attempted independently and cleanup remains unconfirmed", async () => {
  let browserClosed = false;
  await fixture(async (url) => {
    await assert.rejects(
      withFreshLoginPage(
        async (page) => {
          await guardInspectionRequests(page.context(), page, url);
          await page.goto(url);
          await observeLoginControls(page);
        },
        {
          launchBrowser: async () => {
            const browser = await chromium.launch({ headless: true });
            const newContext = browser.newContext.bind(browser);
            browser.newContext = async (options) => {
              const context = await newContext(options);
              context.close = () => new Promise<void>(() => undefined);
              return context;
            };
            const close = browser.close.bind(browser);
            browser.close = async () => {
              browserClosed = true;
              await close();
            };
            return browser;
          },
        },
      ),
      (error) => {
        assert.equal(
          RuntimeLoginFailure.fromUnknown(error)?.cleanupStatus,
          "unconfirmed",
        );
        return true;
      },
    );
  });
  assert.equal(browserClosed, true);
});

test("Given the fixed inspection entry point with an owned transport, the receipt is released only after cleanup", async () => {
  await fixture(async (url, hits) => {
    let closed = false;
    const result = await inspectPartayLogin({
      launchBrowser: async () => {
        const browser = await chromium.launch({ headless: true });
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (options) => {
          assert.equal(options?.serviceWorkers, "block");
          const context = await newContext(options);
          const register = context.route.bind(context);
          context.route = async (pattern, handler, options) =>
            register(
              pattern,
              async (route, request) => {
                const fetch = route.fetch.bind(route);
                route.fetch = async (options) => {
                  assert.equal(
                    request.url(),
                    "https://partay.staging.noutify.app/",
                  );
                  return fetch({ ...options, url });
                };
                await handler(route, request);
              },
              options,
            );
          return context;
        };
        const close = browser.close.bind(browser);
        browser.close = async () => {
          await close();
          closed = true;
        };
        return browser;
      },
    });
    assert.equal(closed, true);
    assert.equal(result.cleanupStatus, "confirmed");
    assert.equal(result.status, "observed");
    assert.equal(result.eye.activations, 0);
    assert.equal(result.eye.behavior, "unverified");
    assert.deepEqual(hits, ["GET /"]);
    assert.ok(!JSON.stringify(result).includes(url));
  });
});

test("Given the login overlay is absent, no similarly named eye elsewhere is clicked", async () => {
  await fixture(async (url) => {
    await withFreshLoginPage(async (page) => {
      await guardInspectionRequests(page.context(), page, url);
      await page.goto(url);
      await page
        .locator("#overlay")
        .evaluate((element) => element.removeAttribute("id"));
      const result = await observeLoginControls(page);
      assert.deepEqual(result.overlay, { present: false, visible: false });
      assert.equal(result.eye.present, false);
      assert.equal(result.eye.behavior, "unverified");
      assert.equal(result.eye.activations, 0);
    });
  });
});

test("Given an unlisted static-looking endpoints, no stylesheet, script, image, font or fetch reaches them", async () => {
  await fixture(async (url, hits) => {
    await withFreshLoginPage(async (page) => {
      const policy = await guardInspectionRequests(page.context(), page, url);
      await page.goto(url);
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = "/owned.css";
          link.onload = link.onerror = () => resolve();
          document.head.append(link);
        });
        await new Promise<void>((resolve) => {
          const script = document.createElement("script");
          script.src = "/unreviewed.js";
          script.onload = script.onerror = () => resolve();
          document.head.append(script);
        });
        await new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = image.onerror = () => resolve();
          image.src = "/unreviewed.png";
        });
        await new FontFace("Owned", "url(/unreviewed.woff2)")
          .load()
          .catch(() => undefined);
        await fetch("/owned.css").catch(() => undefined);
      });
      policy.assertComplete();
      assert.equal(policy.snapshot().blockedRequests, 5);
    });
    assert.deepEqual(hits, ["GET /"]);
  });
});

for (const kind of ["cancel", "timeout"] as const) {
  test(`Given active inspection ${kind}, work stops and cleanup matches the actual close outcomes`, async () => {
    await fixture(async (url) => {
      const controller = new AbortController();
      const closeResults: boolean[] = [];
      const recordClose = async (close: () => Promise<void>): Promise<void> => {
        try {
          await close();
          closeResults.push(true);
        } catch (error) {
          closeResults.push(false);
          throw error;
        }
      };
      await assert.rejects(
        withFreshLoginPage(
          async (page) => {
            await guardInspectionRequests(page.context(), page, url);
            await page.goto(url);
            if (kind === "cancel") controller.abort();
            await new Promise<void>(() => undefined);
          },
          {
            signal: controller.signal,
            timeoutMs: 1500,
            launchBrowser: async () => {
              const browser = await chromium.launch({ headless: true });
              const newContext = browser.newContext.bind(browser);
              browser.newContext = async (options) => {
                const context = await newContext(options);
                const close = context.close.bind(context);
                context.close = () => recordClose(close);
                return context;
              };
              const close = browser.close.bind(browser);
              browser.close = () => recordClose(close);
              return browser;
            },
          },
        ),
        (error) => {
          const failure = RuntimeLoginFailure.fromUnknown(error);
          assert.equal(
            failure?.failureClassification,
            kind === "cancel" ? "interrupted" : "timed-out",
          );
          assert.equal(closeResults.length, 2);
          assert.equal(
            failure?.cleanupStatus,
            closeResults.every(Boolean) ? "confirmed" : "unconfirmed",
          );
          return true;
        },
      );
    });
  });
}

test("Given hostile capture handlers, observation never activates any control or submits", async () => {
  await fixture(async (url, hits) => {
    await withFreshLoginPage(async (page) => {
      await guardInspectionRequests(page.context(), page, url);
      await page.goto(url);
      await page.evaluate(() => {
        const eye = document.querySelector<HTMLButtonElement>(".pw-eye")!;
        document.addEventListener(
          "click",
          () => {
            document.querySelector<HTMLInputElement>("#password")!.value =
              "SYNTHETIC_PRIVATE";
          },
          true,
        );
        eye.addEventListener(
          "click",
          () => {
            document.body.dataset.activations = "1";
            document
              .querySelector<HTMLFormElement>("#overlay")!
              .requestSubmit();
          },
          true,
        );
        for (const name of [
          "mouseover",
          "pointerdown",
          "focus",
          "keydown",
          "submit",
        ]) {
          document.addEventListener(
            name,
            () => {
              document.body.dataset.interactions = "1";
            },
            true,
          );
        }
      });
      const result = await observeLoginControls(page).catch(() => undefined);
      assert.equal(
        await page.locator("body").getAttribute("data-activations"),
        null,
      );
      assert.equal(
        await page.locator("body").getAttribute("data-interactions"),
        null,
      );
      assert.ok(result);
      assert.equal(result.eye.activations, 0);
      assert.equal(result.eye.behavior, "unverified");
      assert.equal(await page.locator("#password").inputValue(), "");
    });
    assert.deepEqual(hits, ["GET /"]);
  });
});
