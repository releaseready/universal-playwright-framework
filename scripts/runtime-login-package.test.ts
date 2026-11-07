import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const exec = promisify(execFile);
const root = path.resolve(__dirname, "../../..");

test(
  "packed installed public entry retains cold-start, browser and root contracts",
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "runtime-login-package-"),
    );
    try {
      const packed = await exec(
        "npm",
        ["pack", "--json", "--pack-destination", directory],
        {
          cwd: root,
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        },
      );
      const metadata = JSON.parse(packed.stdout) as Array<{
        filename: string;
        integrity: string;
        shasum: string;
      }>;
      assert.equal(metadata.length, 1);
      const tarball = path.join(directory, metadata[0].filename);
      const sha256 = createHash("sha256")
        .update(await readFile(tarball))
        .digest("hex");
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({ private: true }),
      );
      await exec(
        "npm",
        ["install", "--ignore-scripts", "--omit=dev", "--no-audit", tarball],
        {
          cwd: directory,
          timeout: 90000,
          maxBuffer: 1024 * 1024,
        },
      );
      const installed = path.join(
        directory,
        "node_modules/@universal/playwright-framework",
      );
      assert.equal((await lstat(installed)).isSymbolicLink(), false);
      for (const file of [
        "src/runtime-login/v1.js",
        "src/runtime-login/v1.d.ts",
        "src/customer-login/partay.js",
        "src/execution/runtime-login-browser.js",
      ]) {
        assert.deepEqual(
          await readFile(path.join(installed, "dist/cucumber", file)),
          await readFile(path.join(root, "dist/cucumber", file)),
        );
      }
      const consumer = path.join(directory, "consumer.ts");
      await writeFile(
        consumer,
        `import {
      withOperatorLoginInputs, InMemoryRuntimeSecretProvider, RuntimeLoginFailure,
      partayLoginFailureReport, PARTAY_LOGIN_URL, validateRuntimeLoginRequest,
      verifyPartayLogin, type PreparedInputDescriptor, type RuntimeLoginRequest,
      type RuntimeSecretProvider, type RuntimeLoginBrowserOptions,
    } from "@universal/playwright-framework/runtime-login/v1";
    export const values = { withOperatorLoginInputs, InMemoryRuntimeSecretProvider,
      RuntimeLoginFailure, partayLoginFailureReport, PARTAY_LOGIN_URL,
      validateRuntimeLoginRequest, verifyPartayLogin };
    export type Inputs = [PreparedInputDescriptor, RuntimeLoginRequest, RuntimeSecretProvider, RuntimeLoginBrowserOptions];
    `,
      );
      await exec(
        process.execPath,
        [
          path.join(root, "node_modules/typescript/bin/tsc"),
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--target",
          "es2022",
          "--module",
          "Node16",
          "--moduleResolution",
          "Node16",
          consumer,
        ],
        { cwd: directory, timeout: 30000 },
      );
      // Do not inherit the parent node:test process's IPC reporter context.
      const consumerEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_PATH: "",
      };
      delete consumerEnvironment.NODE_TEST_CONTEXT;
      const result = await exec(
        process.execPath,
        [
          "--test",
          "--test-reporter=tap",
          path.join(
            installed,
            "dist/cucumber/scripts/runtime-login-entry.test.js",
          ),
        ],
        {
          cwd: directory,
          timeout: 60000,
          maxBuffer: 1024 * 1024,
          env: consumerEnvironment,
        },
      );
      assert.match(result.stdout, /(?:#|ℹ) pass 10/);
      const revision = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
      process.stdout.write(
        JSON.stringify({
          sourceHead: revision.stdout.trim(),
          tarball: metadata[0].filename,
          sha256,
          integrity: metadata[0].integrity,
          shasum: metadata[0].shasum,
          installedCopiesMatch: true,
          consumerTypes: "passed",
          installedTests: 10,
        }) + "\n",
      );
      process.stdout.write(result.stdout);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
