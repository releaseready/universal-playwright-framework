import fs = require("node:fs");
import { join } from "node:path";
import { mock } from "node:test";
import partay = require("../../src/customer-login/partay");

const file = process.argv[2];
if (!file) throw new Error("Expected an owned synthetic fixture path");

const protectedPaths = new Set(["descriptor", "request", file]);
const originalReadFileSync = fs.readFileSync;
let referenceReads = 0;
mock.method(
  fs,
  "readFileSync",
  (
    path: fs.PathOrFileDescriptor,
    options?: Parameters<typeof fs.readFileSync>[1],
  ) => {
    if (protectedPaths.has(String(path))) referenceReads += 1;
    if (path === "descriptor" || path === "request") return "{}";
    return originalReadFileSync(path, options);
  },
);

let promptCalls = 0;
let fileCalls = 0;
mock.method(partay, "promptAndVerifyPartayLogin", async () => {
  promptCalls += 1;
  throw new Error("Unexpected prompt dispatch");
});
mock.method(partay, "privateFileAndVerifyPartayLogin", async () => {
  fileCalls += 1;
  throw new Error("Unexpected file dispatch");
});

process.argv = [
  process.execPath,
  "owned-cli",
  "descriptor",
  "request",
  "--private-account-file",
  file,
];
require(join(__dirname, "../verify-partay-login.js"));
process.stdout.write(
  JSON.stringify({ referenceReads, promptCalls, fileCalls }),
);
