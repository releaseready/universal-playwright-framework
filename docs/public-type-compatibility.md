# Public type compatibility during lint repair

The lint repair preserves the existing permissive TypeScript contracts. It does
not add runtime payload validation or claim that previously untyped data is safe.

Response defaults follow the actual `APIResponse.json()`, `APIResponse.text()` and
parse-failure `null` branches. Request bodies follow the corresponding Playwright
request option. Logger arguments follow each console method's rest arguments,
after the formatted first argument. File-save input follows the literal-string
and `JSON.stringify` branches; file-load output follows `JSON.parse` and the
failure-to-`null` branch. These relationships intentionally inherit the upstream
permissiveness; they are not unrelated aliases for `any`.

Three declaration-local lint exceptions preserve contracts with no suitable
operation-derived replacement:

| Declaration                              | Exception                            | Reason and rejected alternative                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiClient.uploadFile` additional fields | `@typescript-eslint/no-explicit-any` | Existing callers may supply arbitrary record values. The precise Playwright multipart record narrows source inputs, even when those inputs later fail at runtime. An unrelated JSON type would misrepresent multipart handling.                |
| `TestUtils.getPerformanceMetrics` return | `@typescript-eslint/no-explicit-any` | The implementation constructs four numeric fields, but the existing public return is permissive. Narrowing it changes callers' source compatibility. A generic browser-evaluation type would obscure the actual computed result.               |
| `globalSetup` parameter                  | `@typescript-eslint/no-unused-vars`  | The callback accepts a configuration argument and retains runtime arity one. `_config` expresses its intentionally unused status to TypeScript. Removing the formal argument changes arity; dummy reads or metadata rewriting are unnecessary. |

Each exception is limited to its declaration and rule. No ESLint configuration,
assertion, deadline or concurrency setting changes. The regression aggregate now
appends a compatibility stage after all existing stages.

Compatibility verification compares declarations emitted from the preserved
pre-repair candidate against the repaired build using TypeScript equality checks
and bidirectional assignability. It covers each generic API method, default and
explicit response types, request options, logger parameter tuples, file utility
signatures and the setup callback. This verifies the locked toolchain and upstream
types; it cannot promise equality after future upstream declaration changes.

`scripts/lint-compatibility.test.ts` also checks actual API option/response behavior,
console argument forwarding, file serialization/failure behavior, setup arity and
early server closure. `npm run test:features:regression` automatically runs it as
its final `test:lint-compatibility` stage, after every pre-existing stage. Run
`npm run test:lint-compatibility` on its own for focused feedback; it compiles its
TypeScript dependencies before running the tests. Its compile-only assertions
also preserve the public default-response and permissive argument/return types.
It uses owned loopback fixtures and temporary files, and requires no baseline
checkout, pre-existing build, customer service, browser installation or special
environment variable. The existing stages retain the expanded runtime-login and
reporting regressions.
