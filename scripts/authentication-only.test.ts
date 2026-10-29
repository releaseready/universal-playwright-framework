import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  guardLoginRequests,
  withFreshLoginPage,
} from "../src/execution/runtime-login-browser";
import { createAuthenticationOnlyPolicy } from "../src/customer-login/authentication-only";

async function fixture(
  run: (url: string, hits: string[]) => Promise<void>,
  status = 200,
  meStatus = status,
) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<div id="overlay"><input id="password" autocomplete="current-password"><div id="authUp" hidden></div><button id="authGo">Sign in</button></div><div id="onboard" hidden></div>',
      );
    } else {
      const responseStatus = req.url === "/me" ? meStatus : status;
      res.writeHead(
        responseStatus,
        responseStatus === 302 ? { Location: "/forbidden" } : {},
      );
      res.end('{"private":"SYNTHETIC_RESPONSE_CANARY"}');
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

test("Given an explicit authentication policy, only one login POST then one me GET reach the destination", async () => {
  await fixture(async (url, hits) => {
    await withFreshLoginPage(async (page) => {
      const policy = createAuthenticationOnlyPolicy(page, url);
      await guardLoginRequests(
        page.context(),
        new URL(url).origin,
        url,
        policy,
      );
      await page.goto(url);
      await policy.armSubmission();
      await page.evaluate(async () => {
        await fetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "SYNTHETIC_INPUT_CANARY",
        });
        await fetch("/me");
        for (const path of [
          "/groups",
          "/agent/greeting",
          "/me/notifications",
          "/dm",
          "/connections/requests",
          "/events",
        ])
          await fetch(path).catch(() => undefined);
      });
      policy.assertComplete();
      const evidence = JSON.stringify(policy.snapshot());
      assert.equal(policy.snapshot().excludedBackgroundRequests, 6);
      assert.ok(!evidence.includes("CANARY"));
      assert.ok(!evidence.includes("private"));
    });
    assert.deepEqual(hits, ["GET /", "POST /auth/login", "GET /me"]);
  });
});

for (const activity of [
  "pre-auth-background",
  "me-before-login",
  "retry",
  "wrong-method",
  "query",
  "unknown",
  "registration",
  "onboarding",
  "health-budget",
  "wrong-content-type",
  "concurrent-retry",
]) {
  test(`Given ${activity}, fail closed and never dispatch the prohibited request`, async () => {
    await fixture(async (url, hits) => {
      await assert.rejects(
        withFreshLoginPage(async (page) => {
          const policy = createAuthenticationOnlyPolicy(page, url);
          await guardLoginRequests(
            page.context(),
            new URL(url).origin,
            url,
            policy,
          );
          await page.goto(url);
          await policy.armSubmission();
          await page.evaluate(async (activity) => {
            const send = (path: string, method = "GET") =>
              fetch(path, {
                method,
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              }).catch(() => undefined);
            if (activity === "wrong-content-type")
              return void (await fetch("/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              }).catch(() => undefined));
            if (activity === "concurrent-retry")
              return void (await Promise.all([
                send("/auth/login", "POST"),
                send("/auth/login", "POST"),
              ]));
            if (activity === "pre-auth-background")
              return void (await send("/groups"));
            if (activity === "me-before-login") return void (await send("/me"));
            if (activity === "registration")
              document.getElementById("authGo")!.textContent = "Create account";
            if (activity === "wrong-method")
              return void (await send("/auth/login"));
            if (activity === "query")
              return void (await send("/auth/login?x=1", "POST"));
            await send("/auth/login", "POST");
            await send("/me");
            if (activity === "retry") await send("/auth/login", "POST");
            if (activity === "unknown") await send("/me/location", "PUT");
            if (activity === "onboarding") await send("/agent/characters");
            if (activity === "health-budget") {
              await send("/health");
              await send("/health");
              await send("/health");
            }
          }, activity);
          policy.assertComplete();
        }),
      );
      assert.ok(!hits.includes("GET /groups"));
      assert.ok(!hits.includes("PUT /me/location"));
      assert.ok(!hits.includes("GET /agent/characters"));
      assert.ok(!hits.some((hit) => hit.includes("?")));
      assert.ok(
        hits.filter((hit) => hit === "POST /auth/login").length <=
          (activity === "registration" ? 0 : 1),
      );
      assert.ok(hits.filter((hit) => hit === "GET /me").length <= 1);
      assert.ok(hits.filter((hit) => hit === "GET /health").length <= 2);
    });
  });
}

for (const status of [302, 401, 428, 500]) {
  test(`Given authentication HTTP ${status}, no me or redirect destination is reached and no success is reported`, async () => {
    await fixture(async (url, hits) => {
      await assert.rejects(
        withFreshLoginPage(async (page) => {
          const policy = createAuthenticationOnlyPolicy(page, url);
          await guardLoginRequests(
            page.context(),
            new URL(url).origin,
            url,
            policy,
          );
          await page.goto(url);
          await policy.armSubmission();
          await page.evaluate(async () => {
            await fetch("/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            }).catch(() => undefined);
            await fetch("/me").catch(() => undefined);
          });
          policy.assertComplete();
        }),
      );
      assert.deepEqual(hits, ["GET /", "POST /auth/login"]);
    }, status);
  });
}

for (const destination of [
  "external",
  "websocket",
  "document",
  "wrong-resource",
]) {
  test(`Given ${destination} activity, no forbidden destination is contacted`, async () => {
    await fixture(async (external, externalHits) =>
      fixture(async (url, hits) => {
        await assert.rejects(
          withFreshLoginPage(async (page) => {
            const policy = createAuthenticationOnlyPolicy(page, url);
            await guardLoginRequests(
              page.context(),
              new URL(url).origin,
              url,
              policy,
            );
            await page.goto(url);
            await page.evaluate(
              async ({ destination, external }) => {
                if (destination === "external")
                  await fetch(external).catch(() => undefined);
                if (destination === "websocket")
                  await new Promise<void>((resolve) => {
                    const socket = new WebSocket(
                      external.replace("http:", "ws:"),
                    );
                    socket.onclose = socket.onerror = () => resolve();
                  });
                if (destination === "document") location.href = "/forbidden";
                if (destination === "wrong-resource")
                  await new Promise<void>((resolve) => {
                    const image = new Image();
                    image.onload = image.onerror = () => resolve();
                    image.src = "/health";
                  });
              },
              { destination, external },
            );
            policy.assertComplete();
          }),
        );
        assert.deepEqual(externalHits, []);
        assert.deepEqual(hits, ["GET /"]);
      }),
    );
  });
}

for (const pending of ["delayed", "never-settles", "cancelled"]) {
  test(`Given a ${pending} approved request, teardown drains within the deadline and never invents success`, async () => {
    await fixture(async (url) => {
      const controller = new AbortController();
      let transportStarted: () => void = () => undefined;
      const enteredTransport = new Promise<void>((resolve) => {
        transportStarted = resolve;
      });
      const started = Date.now();
      const operation = withFreshLoginPage(
        async (page) => {
          const context = page.context();
          const register = context.route.bind(context);
          context.route = async (matcher, handler) =>
            register(matcher, async (route, request) => {
              if (new URL(request.url()).pathname === "/health") {
                const fetch = route.fetch.bind(route);
                route.fetch = async (options) => {
                  transportStarted();
                  if (pending !== "delayed")
                    return new Promise(() => undefined);
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  return fetch(options);
                };
              }
              await handler(route, request);
            });
          const policy = createAuthenticationOnlyPolicy(page, url);
          await guardLoginRequests(context, new URL(url).origin, url, policy);
          await page.goto(url);
          await policy.armSubmission();
          await page.evaluate(async () => {
            await fetch("/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            await fetch("/me");
          });
          const seen = page.waitForRequest("**/health");
          await page.evaluate(() => {
            void fetch("/health").catch(() => undefined);
          });
          await seen;
          await enteredTransport;
          if (pending === "cancelled") controller.abort();
        },
        { timeoutMs: 1500, signal: controller.signal },
      );
      if (pending === "delayed") await operation;
      else await assert.rejects(operation);
      assert.ok(Date.now() - started < 4000);
    });
  });
}

test("Given me requires email verification, abort its 428 response and never follow a verification or retry path", async () => {
  await fixture(
    async (url, hits) => {
      await assert.rejects(
        withFreshLoginPage(async (page) => {
          const policy = createAuthenticationOnlyPolicy(page, url);
          await guardLoginRequests(
            page.context(),
            new URL(url).origin,
            url,
            policy,
          );
          await page.goto(url);
          await policy.armSubmission();
          await page.evaluate(async () => {
            await fetch("/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            await fetch("/me").catch(() => undefined);
            await fetch("/me").catch(() => undefined);
            await fetch("/agent/greeting").catch(() => undefined);
          });
          policy.assertComplete();
        }),
      );
      assert.deepEqual(hits, ["GET /", "POST /auth/login", "GET /me"]);
    },
    200,
    428,
  );
});

test("Given off-origin activity before sign-in, the failed policy never transmits a later login request", async () => {
  await fixture(async (external, externalHits) =>
    fixture(async (url, hits) => {
      await assert.rejects(
        withFreshLoginPage(async (page) => {
          const policy = createAuthenticationOnlyPolicy(page, url);
          await guardLoginRequests(
            page.context(),
            new URL(url).origin,
            url,
            policy,
          );
          await page.goto(url);
          await policy.armSubmission();
          await page.evaluate(async (external) => {
            await fetch(external).catch(() => undefined);
            await fetch("/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            }).catch(() => undefined);
          }, external);
        }),
      );
      assert.deepEqual(hits, ["GET /"]);
      assert.deepEqual(externalHits, []);
    }),
  );
});

test("Given forbidden activity races an admitted mode check, the pending login POST never reaches transport", async () => {
  await fixture(async (external, externalHits) =>
    fixture(async (url, hits) => {
      await assert.rejects(
        withFreshLoginPage(async (page) => {
          let entered: () => void = () => undefined;
          const admission = new Promise<void>((resolve) => {
            entered = resolve;
          });
          let forbiddenSettled: () => void = () => undefined;
          const forbidden = new Promise<void>((resolve) => {
            forbiddenSettled = resolve;
          });
          const context = page.context();
          const register = context.route.bind(context);
          context.route = async (matcher, handler) =>
            register(matcher, async (route, request) => {
              if (new URL(request.url()).pathname === "/auth/login") {
                const headerValue = request.headerValue.bind(request);
                request.headerValue = async (name) => {
                  entered();
                  await forbidden;
                  return headerValue(name);
                };
              }
              if (request.url() === external) await admission;
              await handler(route, request);
              if (request.url() === external) forbiddenSettled();
            });
          const policy = createAuthenticationOnlyPolicy(page, url);
          await guardLoginRequests(context, new URL(url).origin, url, policy);
          await page.goto(url);
          await policy.armSubmission();
          await page.evaluate(async (external) => {
            await Promise.all([
              fetch("/auth/login", {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              }).catch(() => undefined),
              fetch(external).catch(() => undefined),
            ]);
          }, external);
        }),
      );
      assert.deepEqual(externalHits, []);
      assert.deepEqual(hits, ["GET /"]);
    }),
  );
});

test("Given the five exact declared resources, abort each before transport and still verify authentication-only", async () => {
  const { DECLARED_BLOCKED_RESOURCES } = await import(
    "../src/customer-login/declared-resources"
  );
  const evidence = await import("../docs/partay-declared-resources.json");
  assert.deepEqual(DECLARED_BLOCKED_RESOURCES, evidence.resources);
  await fixture(async (url, hits) => {
    let externalTransports = 0;
    await withFreshLoginPage(async (page) => {
      const context = page.context();
      const register = context.route.bind(context);
      context.route = async (matcher, handler) =>
        register(matcher, async (route, request) => {
          if (new URL(request.url()).origin !== new URL(url).origin)
            route.fetch = async () => {
              externalTransports++;
              throw new Error("No external transport permitted in fixture");
            };
          await handler(route, request);
        });
      const policy = createAuthenticationOnlyPolicy(page, url);
      await guardLoginRequests(context, new URL(url).origin, url, policy);
      await page.goto(url);
      await page.evaluate(async (resources) => {
        for (const resource of resources)
          await new Promise<void>((resolve) => {
            if (resource.resourceType === "script") {
              const script = document.createElement("script");
              script.type = "module";
              script.onload = script.onerror = () => resolve();
              script.src = resource.url;
              document.head.append(script);
            } else {
              const link = document.createElement("link");
              link.rel = "stylesheet";
              link.onload = link.onerror = () => resolve();
              link.href = resource.url;
              document.head.append(link);
            }
          });
      }, DECLARED_BLOCKED_RESOURCES);
      await policy.armSubmission();
      await page.evaluate(async () => {
        await fetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        await fetch("/me");
      });
      policy.assertComplete();
      assert.equal(policy.snapshot().knownBlockedResources.total, 5);
      assert.equal(policy.snapshot().excludedBackgroundRequests, 0);
    });
    assert.equal(externalTransports, 0);
    assert.deepEqual(hits, ["GET /", "POST /auth/login", "GET /me"]);
  });
});

for (const variant of [
  "before-document",
  "wrong-method",
  "wrong-type",
  "navigation",
  "query-variant",
  "excess",
  "abort-failure",
] as const) {
  test(`Given a declared-resource ${variant}, fail closed with zero external transport and no subsequent login POST`, async () => {
    const { DECLARED_BLOCKED_RESOURCES } = await import(
      "../src/customer-login/declared-resources"
    );
    await fixture(async (url, hits) => {
      let externalTransports = 0;
      let denials = 0;
      await assert.rejects(
        withFreshLoginPage(async (page) => {
          const context = page.context();
          const register = context.route.bind(context);
          let handle: Parameters<typeof context.route>[1] | undefined;
          context.route = async (matcher, handler) => {
            handle = handler;
            await register(matcher, handler);
          };
          const policy = createAuthenticationOnlyPolicy(page, url);
          await guardLoginRequests(context, new URL(url).origin, url, policy);
          if (variant !== "before-document") await page.goto(url);
          assert.ok(handle);
          const resource = DECLARED_BLOCKED_RESOURCES[0];
          const request = {
            url: () =>
              resource.url +
              (variant === "query-variant" ? "?unexpected=1" : ""),
            method: () => (variant === "wrong-method" ? "POST" : "GET"),
            resourceType: () =>
              variant === "wrong-type" ? "fetch" : resource.resourceType,
            isNavigationRequest: () => variant === "navigation",
          } as unknown as import("@playwright/test").Request;
          const route = {
            request: () => request,
            abort: async () => {
              denials++;
              if (variant === "abort-failure")
                throw new Error("SYNTHETIC_DENIAL_CANARY");
            },
            fetch: async () => {
              externalTransports++;
              throw new Error("Unexpected external transport");
            },
          } as unknown as import("@playwright/test").Route;
          await handle(route, request);
          if (variant === "excess") await handle(route, request);
          assert.equal(
            policy.snapshot().knownBlockedResources.total,
            variant === "excess" ? 1 : 0,
          );
          if (variant === "before-document") await page.goto(url);
          else {
            await policy.armSubmission();
            await page.evaluate(async () => {
              await fetch("/auth/login", {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              }).catch(() => undefined);
            });
          }
        }),
      );
      assert.equal(externalTransports, 0);
      assert.ok(denials > 0);
      assert.deepEqual(hits, variant === "before-document" ? [] : ["GET /"]);
    });
  });
}

test("Given a known denial starts after asynchronous admission, do not dispatch a credential POST until denial is confirmed", async () => {
  const { DECLARED_BLOCKED_RESOURCES } = await import(
    "../src/customer-login/declared-resources"
  );
  await fixture(async (url, hits) => {
    await assert.rejects(
      withFreshLoginPage(async (page) => {
        const context = page.context();
        const register = context.route.bind(context);
        let handle: Parameters<typeof context.route>[1] | undefined;
        context.route = async (matcher, handler) => {
          handle = handler;
          await register(matcher, handler);
        };
        const policy = createAuthenticationOnlyPolicy(page, url);
        let release: () => void = () => undefined;
        const blocked = new Promise<void>((resolve) => {
          release = resolve;
        });
        let entered: () => void = () => undefined;
        const denialEntered = new Promise<void>((resolve) => {
          entered = resolve;
        });
        let denial: Promise<void> | undefined;
        const allow = policy.allow.bind(policy);
        policy.allow = async (request) => {
          const admitted = await allow(request);
          if (request.method() === "POST") {
            assert.ok(handle);
            const resource = DECLARED_BLOCKED_RESOURCES[0];
            const deniedRequest = {
              url: () => resource.url,
              method: () => "GET",
              resourceType: () => resource.resourceType,
              isNavigationRequest: () => false,
            } as unknown as import("@playwright/test").Request;
            const deniedRoute = {
              request: () => deniedRequest,
              abort: async () => {
                entered();
                await blocked;
              },
              fetch: async () => {
                throw new Error("Forbidden transport");
              },
            } as unknown as import("@playwright/test").Route;
            denial = Promise.resolve(handle(deniedRoute, deniedRequest));
            await denialEntered;
          }
          return admitted;
        };
        await guardLoginRequests(context, new URL(url).origin, url, policy);
        await page.goto(url);
        await policy.armSubmission();
        try {
          await page.evaluate(async () => {
            await fetch("/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            }).catch(() => undefined);
          });
        } finally {
          release();
          await denial;
        }
        policy.assertComplete();
      }),
    );
    assert.deepEqual(hits, ["GET /"]);
  });
});
