import { execFileSync } from "node:child_process";
import path from "node:path";

const JAVASCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const GENERATED_OR_VENDOR_DIRECTORIES = new Set([
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  "__generated__",
  "allure-report",
  "allure-results",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "playwright-report",
  "test-results",
  "third-party",
  "third_party",
  "vendor",
  "vendors",
]);

export function findAuthoredJavaScriptPaths(
  filePaths: readonly string[],
): string[] {
  return filePaths
    .map((filePath) => filePath.replace(/\\/g, "/"))
    .filter((filePath) => {
      const segments = filePath.split("/");
      const fileName = segments.at(-1) ?? "";
      const extension = path.posix.extname(fileName).toLowerCase();

      if (!JAVASCRIPT_EXTENSIONS.has(extension)) {
        return false;
      }

      if (
        segments.some((segment) =>
          GENERATED_OR_VENDOR_DIRECTORIES.has(segment.toLowerCase()),
        )
      ) {
        return false;
      }

      return !/\.(?:generated|gen|min)\.(?:js|jsx|mjs|cjs)$/i.test(fileName);
    })
    .sort();
}

function listRepositoryFiles(): string[] {
  const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const fileList = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repositoryRoot },
  );

  return fileList.toString("utf8").split("\0").filter(Boolean);
}

function main(): void {
  const authoredJavaScript = findAuthoredJavaScriptPaths(listRepositoryFiles());

  if (authoredJavaScript.length > 0) {
    console.error(
      "TypeScript source policy failed. Convert authored JavaScript files to TypeScript:",
    );
    for (const filePath of authoredJavaScript) {
      console.error(`  ${filePath}`);
    }
    console.error(
      "Generated build output and vendor directories are excluded; configuration files are not implicitly exempt.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "TypeScript source policy passed: no authored JavaScript files found.",
  );
}

if (require.main === module) {
  main();
}
