import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import {
  request,
  type APIRequestContext,
  type FullConfig,
} from "@playwright/test";
import { ApiClient, type ApiResponse } from "../src/api/api-client";
import { TestUtils } from "../src/utils/test-utils";
import { Logger } from "../src/utils/logger";
import globalSetup from "../src/utils/global-setup";
import { withLoopbackServer } from "./fixtures/loopback-server";

// Compile-only examples of existing public consumers. Never invoke their I/O.
export async function existingPublicConsumer(
  client: ApiClient,
  config: FullConfig,
): Promise<void> {
  const responses: ApiResponse[] = [
    await client.get("/"),
    await client.post("/", Symbol("input")),
    await client.put("/", () => "input"),
    await client.patch("/", new Date()),
    await client.delete("/"),
    await client.uploadFile("/", "file", "file", { extra: () => "input" }),
  ];
  const unchecked: number = responses[0].data.nested.value;
  const typed = await client.get<{ value: number }>("/");
  const numbers: number[] = [
    unchecked,
    typed.data.value,
    (await TestUtils.loadFromFile("file")).nested.value,
  ];
  const metrics: { arbitraryExistingKey: string } =
    await TestUtils.getPerformanceMetrics(
      {} as Parameters<typeof TestUtils.getPerformanceMetrics>[0],
    );
  const setup: (configuration: FullConfig) => Promise<void> = globalSetup;
  await setup(config);
  await TestUtils.saveToFile("file", { numbers, metrics });
}

test("API options and response handling retain existing observable behavior", async (context) => {
  const captured: Array<{ method: string; url: string; options: unknown }> = [];
  const createContext = request.newContext.bind(request);
  context.mock.method(
    request,
    "newContext",
    async (options: Parameters<typeof request.newContext>[0]) => {
      const api = await createContext(options);
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        const original = api[method].bind(api);
        context.mock.method(
          api,
          method,
          (url: string, options?: Parameters<APIRequestContext["get"]>[1]) => {
            captured.push({ method, url, options });
            return original(url, options);
          },
        );
      }
      return api;
    },
  );
  const directory = mkdtempSync(path.join(tmpdir(), "lint-api-"));
  const file = path.join(directory, "upload.txt");
  writeFileSync(file, "owned upload");
  try {
    await withLoopbackServer(
      (incoming, outgoing) => {
        if (incoming.url === "/text") {
          outgoing.end("plain body");
          return;
        }
        outgoing.setHeader("content-type", "application/json");
        if (incoming.url === "/broken") {
          outgoing.end("{");
          return;
        }
        let body = "";
        incoming.on("data", (chunk) => {
          body += chunk.toString();
        });
        incoming.on("end", () =>
          outgoing.end(
            JSON.stringify({
              method: incoming.method,
              body,
              url: incoming.url,
              custom: incoming.headers["x-test"],
            }),
          ),
        );
      },
      async (url) => {
        const client = new ApiClient(url, { "x-test": "default" });
        await client.init();
        try {
          const result = await client.get<{ url: string; custom: string }>(
            "/json?first=1",
            {
              params: { second: "a b" },
              headers: { "x-test": "override" },
              timeout: 0,
            },
          );
          assert.equal(result.data.url, "/json?first=1&second=a+b");
          assert.equal(result.data.custom, "override");
          assert.equal(result.status, 200);
          assert.equal(result.ok, true);
          assert.equal(
            (captured[0].options as { timeout: number }).timeout,
            30000,
          );
          for (const method of ["post", "put", "patch"] as const) {
            const response = await client[method]<{
              method: string;
              body: string;
            }>("/json", { value: 3 });
            assert.equal(response.data.method, method.toUpperCase());
            assert.deepEqual(JSON.parse(response.data.body), { value: 3 });
          }
          await client.post("/json", false);
          assert.equal(
            Object.hasOwn(captured.at(-1)!.options as object, "data"),
            false,
          );
          assert.equal(
            (await client.delete<{ method: string }>("/json")).data.method,
            "DELETE",
          );
          assert.equal((await client.get<string>("/text")).data, "plain body");
          assert.equal((await client.get("/broken")).data, null);
          const upload = await client.uploadFile<{ body: string }>(
            "/json",
            file,
            "file",
            { note: "owned" },
          );
          assert.match(upload.data.body, /owned upload/);
          assert.match(upload.data.body, /owned/);
        } finally {
          await client.dispose();
        }
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("early stopped-server cleanup preserves timer ordering without uninitialized access", async () => {
  const file = require.resolve("../src/execution");
  const callbacks: Array<{ callback: () => void; delay: number }> = [];
  const module = { exports: {} };
  // Expose the private helper only in this in-memory module; production exports are unchanged.
  const closeServer = runInNewContext(
    `(function(require, module, exports, __filename, __dirname) { ${readFileSync(file, "utf8")}\nreturn closeServer; })`,
    {
      setTimeout: (callback: () => void, delay: number) => {
        const timer = { callback, delay };
        callbacks.push(timer);
        return timer;
      },
      clearTimeout: () => undefined,
    },
  )(createRequire(file), module, module.exports, file, path.dirname(file)) as (
    server: object,
    sockets: Set<unknown>,
  ) => Promise<{ closed: boolean; injectedPending: boolean }>;
  for (const initiallyListening of [false, true]) {
    callbacks.length = 0;
    let closeCalls = 0;
    const server = {
      listening: initiallyListening,
      close: (callback: () => void) => {
        closeCalls += 1;
        server.listening = false;
        callback();
      },
    };
    const result = await closeServer(server, new Set());
    assert.equal(result.closed, true);
    assert.equal(result.injectedPending, false);
    assert.equal(closeCalls, initiallyListening ? 1 : 0);
    assert.deepEqual(
      callbacks.map((timer) => timer.delay),
      [1000],
    );
    callbacks[0].callback();
    assert.deepEqual(
      callbacks.map((timer) => timer.delay),
      [1000, 500],
    );
    callbacks[1].callback();
    assert.equal(closeCalls, initiallyListening ? 1 : 0);
  }
});

test("global setup retains its one-argument runtime callback contract", () => {
  assert.equal(globalSetup.length, 1);
});

test("logger forwards arbitrary console arguments with unchanged identity and ordering", (context) => {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "DEBUG";
  try {
    const logger = new Logger("contract");
    const object = { value: 1 };
    const callable = () => "value";
    const symbol = Symbol("value");
    const args = [object, callable, symbol, undefined, null, 42];
    for (const level of ["debug", "info", "warn"] as const) {
      const output: unknown[][] = [];
      const spy = context.mock.method(
        console,
        level,
        (...forwarded: unknown[]) => {
          output.push(forwarded);
        },
      );
      logger[level]("message", ...args);
      logger[level]("empty");
      assert.equal(output.length, 2);
      assert.match(
        String(output[0][0]),
        new RegExp(`\\[${level.toUpperCase()}\\] \\[contract\\] message$`),
      );
      assert.deepEqual(output[0].slice(1), args);
      assert.equal(output[0][1], object);
      assert.equal(output[0][2], callable);
      assert.equal(output[1].length, 1);
      spy.mock.restore();
    }
    const output: unknown[][] = [];
    context.mock.method(console, "error", (...forwarded: unknown[]) => {
      output.push(forwarded);
    });
    const error = new Error("owned error");
    logger.error("failure", error, ...args);
    logger.error("no error", undefined, ...args);
    assert.equal(output[0][1], error.stack);
    assert.deepEqual(output[0].slice(2), args);
    assert.deepEqual(output[1].slice(1), args);
  } finally {
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
  }
});

test("file utilities preserve string, parsed JSON, null and serialization-failure behavior", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "lint-file-contract-"));
  const file = path.join(directory, "data.json");
  context.mock.method(console, "error", () => undefined);
  try {
    for (const value of [{ a: [1, true, null] }, ["value"], 42, false, null]) {
      await TestUtils.saveToFile(file, value);
      assert.equal(readFileSync(file, "utf8"), JSON.stringify(value, null, 2));
      assert.deepEqual(await TestUtils.loadFromFile(file), value);
    }
    await TestUtils.saveToFile(file, "literal text");
    assert.equal(readFileSync(file, "utf8"), "literal text");
    assert.equal(await TestUtils.loadFromFile(file), null);
    assert.equal(
      await TestUtils.loadFromFile(path.join(directory, "missing")),
      null,
    );
    const circular: { self?: unknown } = {};
    circular.self = circular;
    for (const value of [
      circular,
      1n,
      undefined,
      Symbol("value"),
      () => "value",
    ]) {
      await assert.rejects(TestUtils.saveToFile(file, value), TypeError);
      assert.equal(readFileSync(file, "utf8"), "literal text");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
