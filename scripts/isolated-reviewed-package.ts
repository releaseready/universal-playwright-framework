import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runtimePackagePath } from "../src/execution/reviewed-scenarios";

const sourceRoot = path.resolve(__dirname, "../../..");

/** Independent file copies, including dependencies: mutation tests never write
 * shared source, emitted code, manifests or dependency directories. */
export async function withIsolatedReviewedPackage<T>(
  use: (root: string) => Promise<T>,
): Promise<T> {
  const isolated = mkdtempSync(path.join(tmpdir(), "rr139-reviewed-copy-"));
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
    ) as { files: string[] };
    for (const name of [
      "package.json",
      "package-lock.json",
      ...manifest.files,
    ]) {
      const source = path.join(sourceRoot, name);
      if (existsSync(source))
        cpSync(source, path.join(isolated, name), {
          recursive: true,
          dereference: true,
        });
    }
    // The package's dependencies can be hoisted in a tarball consumer.
    const dependencies = path.dirname(
      path.dirname(runtimePackagePath("playwright")),
    );
    cpSync(dependencies, path.join(isolated, "node_modules"), {
      recursive: true,
      dereference: true,
    });
    assert.notEqual(realpathSync(isolated), realpathSync(sourceRoot));
    return await use(isolated);
  } finally {
    // Remove only this invocation's owned files and module-cache entries.
    for (const name of Object.keys(require.cache)) {
      if (name.startsWith(isolated + path.sep)) delete require.cache[name];
    }
    rmSync(isolated, { recursive: true, force: true });
  }
}

/** Called while a copied artifact remains mutated. A separate process proves
 * concurrent readers of the original package still see its valid review. */
export function assertOriginalReviewUnaffected(
  relativePath: string,
  isolated: string,
  original: Buffer,
): void {
  const shared = relativePath.startsWith("node_modules/")
      ? path.join(
          path.dirname(path.dirname(runtimePackagePath("playwright"))),
          relativePath.slice("node_modules/".length),
        )
      : path.join(sourceRoot, relativePath),
    copied = path.join(isolated, relativePath);
  const sharedStat = statSync(shared),
    copiedStat = statSync(copied);
  assert.ok(
    sharedStat.dev !== copiedStat.dev || sharedStat.ino !== copiedStat.ino,
    "mutation target must not share an inode",
  );
  assert.deepEqual(
    readFileSync(shared),
    original,
    "shared bytes must remain unchanged while the copy is mutated",
  );
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `
    require(${JSON.stringify(path.join(sourceRoot, "dist/cucumber/src/execution/reviewed-scenarios.js"))})
      .loadReviewedScenarios().then(() => process.exitCode = 0, () => process.exitCode = 1);
  `,
    ],
    { cwd: sourceRoot, timeout: 10000, stdio: "ignore" },
  );
  assert.equal(child.error, undefined);
  assert.equal(
    child.status,
    0,
    "concurrent original-package reader must retain a valid review",
  );
}
