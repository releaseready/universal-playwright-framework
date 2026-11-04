import assert from "node:assert/strict";
import { test } from "node:test";
import { TestDataFactory } from "../fixtures/test-data-factory";
import {
  createOutlineFixtureFields,
  createValidationManifest,
} from "../fixtures/input-preparation/reviewed-fixtures";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";
import { TestUtils } from "../src/utils/test-utils";
import { withLoopbackServer } from "./fixtures/loopback-server";
import { runLoginCommand } from "./login-command";

const signalNames = ["SIGINT", "SIGTERM"] as const;

test("login commands remove only their own signal listeners after success and cancellation", async () => {
  for (const signalName of [undefined, "SIGINT", "SIGTERM"] as const) {
    const existing = (): void => {};
    process.on("SIGINT", existing);
    const before = signalNames.map((name) => process.listeners(name));
    try {
      await runLoginCommand(async (signal) => {
        assert.equal(signal.aborted, false);
        if (signalName) process.emit(signalName);
        assert.equal(signal.aborted, signalName !== undefined);
      });
      assert.deepEqual(
        signalNames.map((name) => process.listeners(name)),
        before,
      );
    } finally {
      process.removeListener("SIGINT", existing);
    }
  }
});

test("login commands preserve safe failure evidence without exposing unknown errors", async (context) => {
  const before = signalNames.map((name) => process.listeners(name));
  const exitCode = process.exitCode;
  const output: string[] = [];
  context.mock.method(process.stderr, "write", (text: string) => {
    output.push(text);
    return true;
  });
  try {
    for (const error of [
      new Error("SYNTHETIC_PRIVATE_ERROR_CANARY"),
      new RuntimeLoginFailure(
        "request-policy",
        "confirmed",
        "off-origin",
        "request-policy",
      ),
    ]) {
      await runLoginCommand(async () => {
        throw error;
      });
      assert.equal(process.exitCode, 1);
      assert.deepEqual(
        signalNames.map((name) => process.listeners(name)),
        before,
      );
    }
    assert.ok(!output.join("").includes("CANARY"));
    assert.equal(JSON.parse(output[0]).failureStage, "unclassified");
    assert.equal(JSON.parse(output[1]).policyReason, "off-origin");
    assert.equal(JSON.parse(output[1]).cleanupStatus, "confirmed");
  } finally {
    process.exitCode = exitCode;
  }
});

test("owned loopback fixtures close on both successful and failing consumers", async () => {
  for (const fail of [false, true]) {
    let url = "";
    const failure = new Error("Owned fixture assertion failed");
    const run = withLoopbackServer(
      (_request, response) => response.end("owned"),
      async (target) => {
        url = target;
        assert.equal(await (await fetch(url)).text(), "owned");
        if (fail) throw failure;
      },
    );
    if (fail) await assert.rejects(run, (error) => error === failure);
    else await run;
    await assert.rejects(fetch(url));
  }
});

test("phone fixture generation reuses the utility with unchanged numeric bounds", (context) => {
  let random = 0;
  context.mock.method(Math, "random", () => random);
  for (const [value, expected] of [
    [0, "100-100-1000"],
    [1 - Number.EPSILON, "999-999-9999"],
  ] as const) {
    random = value;
    assert.equal(TestUtils.generateRandomPhoneNumber(), expected);
    assert.equal(TestDataFactory.generateUser().phone, expected);
  }
});

test("reviewed test fixture factories return independent copies without broadening approval", () => {
  const manifest = createValidationManifest("review-a");
  const fields = createOutlineFixtureFields();
  assert.notEqual(manifest.steps, createValidationManifest("review-a").steps);
  assert.notEqual(
    fields["approved-outline/row-a"],
    createOutlineFixtureFields()["approved-outline/row-a"],
  );
  assert.equal(
    createValidationManifest("review-b").implementationRevision,
    "review-b",
  );
  assert.deepEqual(Object.keys(fields), [
    "approved-outline/row-a",
    "approved-outline/row-b",
  ]);
});
