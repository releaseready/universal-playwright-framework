import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterResult } from "../src/adapter/v1";
import { REPOSITORY_ROOT } from "../src/execution/reviewed-scenarios";

const exec = promisify(execFile);

export async function installedPackageSmoke(): Promise<AdapterResult> {
  const consumer = mkdtempSync(path.join(tmpdir(), "rrdweb6-consumer-"));
  const hash = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  try {
    assert.ok(
      !realpathSync(consumer).startsWith(
        `${realpathSync(REPOSITORY_ROOT)}${path.sep}`,
      ),
    );
    const packed = await exec(
      "npm",
      ["pack", "--json", "--pack-destination", consumer],
      {
        cwd: REPOSITORY_ROOT,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      },
    );
    const metadata = JSON.parse(packed.stdout) as { filename: string }[];
    const tarball = path.join(consumer, metadata[0].filename);
    const digest = hash(tarball);
    writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({ private: true }),
    );
    const installed = await exec(
      "npm",
      ["install", "--omit=dev", "--ignore-scripts", tarball],
      {
        cwd: consumer,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      },
    );
    process.stdout.write(
      `Installed immutable tarball sha256=${digest}\n${installed.stdout}`,
    );
    assert.equal(hash(tarball), digest);
    const packageRoot = path.join(
      consumer,
      "node_modules/@universal/playwright-framework",
    );
    assert.equal(lstatSync(packageRoot).isSymbolicLink(), false);
    const worker = path.join(
      packageRoot,
      "dist/cucumber/scripts/installed-adapter-consumer.js",
    );
    const executed = await exec(process.execPath, [worker], {
      cwd: consumer,
      timeout: 90000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SystemRoot: process.env.SystemRoot,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      },
    });
    const result = JSON.parse(executed.stdout) as AdapterResult;
    assert.ok(result.accepted);
    assert.equal(result.report.status, "passed");
    return result;
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}
