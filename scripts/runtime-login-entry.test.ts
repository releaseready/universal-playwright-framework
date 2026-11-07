import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const probe = path.join(__dirname, "fixtures/runtime-entry-probe.js");

test(
  "public runtime-login entry handles pending provider IPC and cancellation without Playwright",
  { timeout: 15000 },
  async () => {
    const child = fork(probe, ["pending"], { silent: true });
    let pending = false;
    let completed = false;
    let output = "";
    child.stdout?.on("data", (data) => {
      output += String(data);
    });
    child.stderr?.on("data", (data) => {
      output += String(data);
    });
    const timer = setTimeout(() => child.kill(), 12000);
    try {
      await new Promise<void>((resolve, reject) => {
        child.on(
          "message",
          (message: { stage: string; browserLoads: number }) => {
            if (message.stage === "pending") {
              pending = true;
              if (message.browserLoads !== 0) {
                reject(new Error("pending provider loaded browser"));
                return;
              }
              child.send("cancel");
            }
            if (message.stage === "completed") completed = true;
          },
        );
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          if (code !== 0 || signal)
            reject(new Error(output || `probe exited ${code}/${signal}`));
          else resolve();
        });
      });
      assert.ok(pending && completed, output);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
    }
  },
);

for (const mode of ["guards", "load-timeout", "root", "browser"]) {
  test(
    `public runtime-login entry preserves ${mode} behavior`,
    { timeout: 45000 },
    () => {
      const result = spawnSync(process.execPath, [probe, mode], {
        encoding: "utf8",
        timeout: 40000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.signal, null);
      assert.match(result.stdout, new RegExp(`"mode":"${mode}"`));
    },
  );
}

// Also run deterministic cleanup-budget regressions from the installed package.
import "./runtime-login-cleanup-deadline.test";
