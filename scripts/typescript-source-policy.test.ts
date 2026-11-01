import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findAuthoredJavaScriptPaths } from "./check-typescript-source-policy";

describe("TypeScript source policy", () => {
  it("detects authored JavaScript across application and test code extensions", () => {
    assert.deepEqual(
      findAuthoredJavaScriptPaths([
        "src/app.js",
        "tests/browser.jsx",
        "scripts/task.cjs",
        "features/steps/example.mjs",
        "src/app.ts",
      ]),
      [
        "features/steps/example.mjs",
        "scripts/task.cjs",
        "src/app.js",
        "tests/browser.jsx",
      ],
    );
  });

  it("excludes generated output and third-party/vendor paths", () => {
    assert.deepEqual(
      findAuthoredJavaScriptPaths([
        "dist/app.js",
        "build/app.js",
        "generated/app.js",
        "vendor/browser.js",
        "third_party/tool.js",
        "node_modules/package/index.js",
        "src/node_modules/package/index.js",
        "src/client.generated.js",
        "src/client.min.js",
      ]),
      [],
    );
  });

  it("does not exempt nested source directories just because they resemble generated or vendor output", () => {
    assert.deepEqual(
      findAuthoredJavaScriptPaths([
        "scripts/build/release.js",
        "src/out/format.js",
        "src/vendor/owned.js",
        "tests/generated/helpers.js",
      ]),
      [
        "scripts/build/release.js",
        "src/out/format.js",
        "src/vendor/owned.js",
        "tests/generated/helpers.js",
      ],
    );
  });

  it("does not mistake TypeScript or non-code configuration and feature files for JavaScript", () => {
    assert.deepEqual(
      findAuthoredJavaScriptPaths([
        "scripts/check.ts",
        "features/login.feature",
        "config/playwright.json",
        ".github/workflows/test.yml",
      ]),
      [],
    );
  });
});
