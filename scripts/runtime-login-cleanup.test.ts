import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "@playwright/test";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";
import {
  LOGIN_CLEANUP_TIMEOUT_MS,
  withFreshLoginPage,
} from "../src/execution/runtime-login-browser";

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function fixture(offline: () => Promise<void>, browserClose = async () => {}) {
  const events: string[] = [];
  const browser = {
    newContext: async () => ({
      setOffline: async (value: boolean) => {
        assert.equal(value, true);
        events.push("offline-start");
        await offline();
        events.push("offline-confirmed");
      },
      close: async () => {
        events.push("context-close");
      },
      newPage: async () => ({
        setDefaultTimeout() {},
        setDefaultNavigationTimeout() {},
      }),
    }),
    close: async () => {
      events.push("browser-close");
      await browserClose();
      events.push("browser-closed");
    },
  } as unknown as Browser;
  return { events, launchBrowser: async () => browser };
}

test("Given completed work, browser transport is disabled before context teardown can disable interception", async () => {
  const owned = fixture(async () => {
    await delay(10);
  });
  await withFreshLoginPage(async () => {}, owned);
  assert.deepEqual(owned.events, [
    "offline-start",
    "offline-confirmed",
    "context-close",
    "browser-close",
    "browser-closed",
  ]);
});

for (const fault of ["rejected", "never-settles"] as const) {
  test(`Given ${fault} network isolation during cleanup, context teardown is withheld and browser shutdown is attempted without reporting success`, async () => {
    const owned = fixture(async () => {
      if (fault === "rejected") throw new Error("owned isolation failure");
      await new Promise<void>(() => undefined);
    });
    const started = Date.now();
    await assert.rejects(
      withFreshLoginPage(async () => {}, owned),
      (error) => {
        assert.ok(error instanceof RuntimeLoginFailure);
        assert.equal(error.failureStage, "cleanup");
        assert.equal(error.cleanupStatus, "unconfirmed");
        return true;
      },
    );
    assert.ok(Date.now() - started < LOGIN_CLEANUP_TIMEOUT_MS + 400);
    assert.equal(owned.events.includes("context-close"), false);
    assert.equal(owned.events.includes("browser-closed"), true);
  });
}

test("Given cancellation with pending network isolation, browser shutdown waits for isolation and preserves the interrupted outcome", async () => {
  const controller = new AbortController();
  const owned = fixture(async () => {
    await delay(10);
  });
  await assert.rejects(
    withFreshLoginPage(
      async () => {
        controller.abort();
      },
      {
        ...owned,
        signal: controller.signal,
      },
    ),
    (error) => {
      assert.ok(error instanceof RuntimeLoginFailure);
      assert.equal(error.failureClassification, "interrupted");
      assert.equal(error.cleanupStatus, "confirmed");
      return true;
    },
  );
  assert.deepEqual(owned.events, [
    "offline-start",
    "offline-confirmed",
    "context-close",
    "browser-close",
    "browser-closed",
  ]);
});

test("Given immediate context shutdown, two-second browser shutdown completes within the approved five-second cleanup budget", async () => {
  const owned = fixture(
    async () => {},
    async () => {
      await delay(2000);
    },
  );
  await withFreshLoginPage(async () => {}, owned);
  assert.equal(owned.events.at(-1), "browser-closed");
});

test("Given browser disconnection before slow process cleanup completes, the deadline still reports unconfirmed cleanup", async () => {
  let disconnected = false;
  let cleanupComplete = false;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const owned = fixture(
    async () => {},
    async () => {
      disconnected = true;
      await delay(LOGIN_CLEANUP_TIMEOUT_MS + 200);
      cleanupComplete = true;
      finish();
    },
  );
  await assert.rejects(
    withFreshLoginPage(async () => {}, owned),
    (error) => {
      assert.ok(error instanceof RuntimeLoginFailure);
      assert.equal(error.failureStage, "cleanup");
      assert.equal(error.cleanupStatus, "unconfirmed");
      assert.equal(disconnected, true);
      assert.equal(cleanupComplete, false);
      return true;
    },
  );
  await finished;
  assert.equal(cleanupComplete, true);
});
