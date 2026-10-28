# Local adapter v1 — RRDWEB-6

[Jira RRDWEB-6](https://noisegatemusicstudios.atlassian.net/browse/RRDWEB-6) /
[issue 16](https://github.com/releaseready/universal-playwright-framework/issues/16).
[PR15](https://github.com/releaseready/universal-playwright-framework/pull/15)
is merged. PR17 now targets `main`, verified at
`e99be5ca53d8eae7eb6b9ff48b25f82eb700b381`, which includes that reporting work.
Execution, input preparation, approval, and reporting are inherited. New work is
the versioned local boundary, package wiring, and its contract/acceptance tests.
There is no new engine, remote protocol, account service, database, or deployment.

## Calling the installed package

```typescript
import {
  executeAdapter,
  type AdapterRequest,
  type TrustedAdapterContext,
} from "@universal/playwright-framework/adapter/v1";

// Load the exact compatible fixture shipped with this reviewed package.
// The central owner must authorize the caller before constructing this context.
declare const request: AdapterRequest;
declare const context: TrustedAdapterContext;
const controller = new AbortController();
const result = await executeAdapter(request, context, controller.signal);
if (!result.accepted) {
  console.log(result.error.code, result.error.message);
} else {
  console.log(result.run.id, result.report.status, result.lifecycle);
}
```

`fixtures/adapter/v1-compatible.json` is the pinned complete valid example;
`v1-rejected.json` is an intentionally unsupported external target. The central
Git revision in these synthetic examples is an illustrative 40-hex caller value,
**not** an approval hash. The feature and implementation approval hashes are real.
Tests do not automatically replace them with whatever runtime happens to exist.

Request v1 has only:

| Field                           | Meaning / bound                                                        |
| ------------------------------- | ---------------------------------------------------------------------- |
| `version`                       | Exactly `1`                                                            |
| `run.id`                        | Caller-owned central run reference                                     |
| `run.gitRevision`               | Caller-owned central Git revision, exactly 40 lowercase hex            |
| `target`                        | Exactly `owned-synthetic`; **never a customer URL**                    |
| `scenarioIds`                   | 1–6 unique, approved runnable registry identifiers                     |
| `approval`                      | Exact `sourceRevision`, `featureRevision`, `implementationRevision`    |
| `inputs`                        | Exact fixed `fixtureRevision`, `environmentRevision`, `policyRevision` |
| `limits.runTimeoutMs`           | Integer 50–120000, shared across attempts                              |
| `limits.scenarioTimeoutMs`      | Integer 50–60000                                                       |
| `limits.maxConcurrentScenarios` | Integer 1–2                                                            |
| `limits.retryCount`             | Integer 0–2, zero means no retries                                     |

Identifiers are at most 128 characters and match
`[A-Za-z0-9][A-Za-z0-9._:-]*`. Approval digests are 64 lowercase hex characters.
Every object is strict: extra fields, raw secret fields, URLs, paths,
fault-injection controls and executable callbacks are not part of this request.
The existing registry includes `browser-flow`, `retry-assertion-flow`,
`assertion-failure`, `pending-flow`, `timeout-flow`, and `redirect-flow`.
The registry's `undefined-flow` is not runnable and is rejected, including when
mixed with a valid identifier; no silent partial selection is permitted.
All browser actions use package-owned, ephemeral loopback fixtures.

## Owner context and rejection

Context is a **separate argument**, not an authorization claim inside the request:

```typescript
const context: TrustedAdapterContext = {
  version: 1,
  authorization: "owned-synthetic",
  callerId: "central-owner",
  runId: request.run.id,
  gitRevision: request.run.gitRevision,
  allowedScenarioIds: ["browser-flow"],
  approval: { ...request.approval },
  inputs: { ...request.inputs },
};
```

Only the central owner should construct it after authenticating and authorizing
the caller. The adapter checks context syntax, run/revision/input consistency
and allowed scenarios; **an in-process object is not unforgeable**. This package
does not authenticate users or replace ReleaseReady authorization.

Before any server, browser, worker or temporary report acquisition, the adapter
validates the request/context, verifies the fixed approval/runtime pin, checks
every selected scenario and prepares the fixed input descriptor. Rejections have
`accepted: false`, `resourceAcquisition: "not_started"` and a fixed safe error:

- `INVALID_REQUEST`: use the v1 shape and bounded synthetic-only limits.
- `INVALID_CONTEXT`: the central owner must supply consistent authorized references.
- `STALE_REVIEW`: restore the reviewed package/inputs or obtain a newly reviewed pin.
- `UNSUPPORTED_SCENARIO`: choose only approved runnable synthetic scenarios.

No rejected values, raw exceptions, stacks or filesystem paths are returned.
Acquisition spies in contract tests prove zero server and browser starts for
invalid, stale, unsupported, or inconsistent inputs, not merely an error label.

## Results, cancellation and persistence handoff

`accepted: true` means execution was admitted, **not** that it passed.
`run` and `callerId` retain caller identity. `approval` and `inputs` remain
separate from the central Git revision. `report.runReference` is the engine's
generated diagnostic identifier, not the caller's run ID.

The existing safe `report` retains scenario/step evidence, ordered attempts,
per-attempt outcomes, and `passed_after_retry`. All execution outcomes remain
distinct: `passed`, `passed_after_retry`, `failed`, `incomplete`, `timed_out`,
and `cancelled`. A timed-out or unfinished action is never converted to success.
Screenshots, logs, traces and raw worker exceptions are withheld.

`lifecycle` separately retains resource cleanup and data restoration. Its ordered
`attempts` join to `report.attempts` by `attemptNumber` and `diagnosticReference`,
with per-attempt and per-scenario cleanup status, bounded cleanup failure codes,
and `workerStopped`. Fault-injection flags are not exported. Resource cleanup
can be `not_required`, `confirmed`, `failed`, or `unknown`; browser shutdown
evidence can be true, false, or null. A clean process shutdown is **not** proof
of data restoration: the inherited synthetic runner performs no data restoration,
so `dataRestoration` stays `{ status: "unknown", operationPerformed: false }`.
An unexpected engine exception yields incomplete evidence with unknown cleanup,
not a pre-acquisition rejection or a fabricated successful attempt.

An optional third-argument `AbortSignal` cancels only this call's owned execution.
An already aborted signal starts no runtime. Abort reasons are not exported.
Concurrent calls have independent cancellation and resource ownership.
Late cancellation during terminal-attempt cleanup does not overwrite a completed
pass. Cancellation before a retry prevents further work but retains the failed
attempt. Unconfirmed cleanup preserves failure/uncertainty, never a successful
cancellation claim. Deadlines include execution; bounded teardown can take extra time.

ReleaseReady must persist the caller/run mapping, request approval/input references,
full ordered report attempts **and** lifecycle evidence durably before acknowledging
delivery. Do not overload or flatten the stricter central summary to fit this local
envelope; store/join this evidence alongside it. ReleaseReady owns authorization,
durable idempotency, persistence and recovery. **Two calls mean two executions**,
even with the same central run ID. There is deliberately no in-memory duplicate cache.
Jira S03 durable duplicate delivery and S06 joined live-portal rehearsal remain
central integration follow-ups, not passing or full-story acceptance claims here.

## Building, packaging and review pins

`npm ci` runs `prepare`; `npm run build` compiles the package and Cucumber worker
into ignored `dist/cucumber`. The `./adapter/v1` export points there. `npm pack`
builds the same output and includes the fixed sources/configuration/fixtures used
by approval, compiled workers, declarations, and contract examples.
No registry publication is needed or performed.

The direct Cucumber, parser, Zod and Playwright runtime versions/manifests are
checked through Node resolution from the installed package (including hoisted
dependencies), not a checkout-local `node_modules`. npm intentionally excludes
`package-lock.json` from tarballs, so runtime identity is now pinned by exact
runtime dependencies in the hashed `package.json` and actual resolved manifests;
the source lock remains checked in. The implementation hash binds the actual
adapter and worker JavaScript, fixed input, feature, and execution configuration.
Only the embedded implementation digest is normalized to avoid a self-hash cycle.
There is no placeholder hash, disabled check, or runtime self-approval.

After an intentional source/config/dependency change, `npm run review:revision`
builds and prints a candidate digest. It does **not** write approval. Review the
change, then explicitly update the committed implementation pin and both pinned
JSON examples together. The installed smoke also modifies a packaged worker and
proves that the same call subsequently rejects stale approval.

Playwright remains pinned to 1.55.1. The runtime remediation uses official
Cucumber 12.9.0, Gherkin 38.0.0 and cucumber-expressions 19.0.0, removing the affected nested UUID chain and
resolving maintained glob/minimatch dependencies without overrides. Cucumber
12.3.0 was evaluated but retained the UUID advisory through Gherkin utilities.
Unused `faker` was removed; the installed consumer checks the existing public
`TestDataFactory` and root adapter export. No public export was removed. Validation and execution resolve the same step
matcher; both the source and independently installed consumer assert this.

The package requires Node 22.12 or later in the Node 22 line, or Node 24 or later;
validation uses Node 22.23.4. The production-only audit is clean for this
candidate. Development tooling findings remain outside this runtime repair;
this is not a claim that the entire dependency tree is advisory-free. No audit
suppression, dependency override or broad automatic audit fix is used.

## Checks and review handoff

`npm run test:adapter` runs strict TypeScript contracts and the five tagged
plain-English scenarios; it is included in `npm run test:features:regression`.
S01/S02/S04/S05 and reuse S01/S02 cover this local slice only.
Retry and cleanup fault controls exist exclusively in internal engine test seams,
never public requests. Assertions use real Cucumber/Playwright outcomes.

The S05 smoke uses `npm pack`, installs that immutable SHA-256-identified tarball
with production dependencies into an independent `/tmp/rrdweb6-consumer-*`
directory, rejects symlinks, verifies runtime resolution inside that consumer,
clears checkout module/environment hints, and invokes the package export for a
real synthetic browser run. Only the official matching Chromium cache is shared.
It needs npm access and installed Chromium, not a ReleaseReady account/database,
customer credentials/data, or a live portal. Temporary consumers are removed.

Baseline lint is unavailable because the repository has no ESLint configuration;
this is deferred to **RRDPLAT-28**, not suppressed or repaired in this slice.
PR17 was platform-created as a **draft** and is not marked ready or merged here.
Independent final review and actual bot findings remain owner gates.

### Review evidence (implementation commit `7fdea5e`)

No hosted validation was dispatched, rerun, enabled or reconfigured.
The final batch used Node v24.22.1; Cucumber warns that this Node version has not
been tested by its maintainers. It completed successfully despite that warning.
No application/customer-target Playwright matrix was run.

| Command                                              |   Exit | Captured stdout/result                                                                                                                                  |
| ---------------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --ignore-scripts`                            |      0 | `added 296 packages`; baseline `20 vulnerabilities (6 moderate, 14 high)`                                                                               |
| Initial `npm run build:cucumber` (TDD red)           |      1 | Missing adapter module and revision exports, as expected before implementation                                                                          |
| Two early focused adapter iterations                 | 1 each | `tests 5`, `pass 1`, `fail 4`; fail-closed manifest resolution, then exact input-selection mismatch                                                     |
| Focused direct/adapter contract after projection fix |      0 | `tests 1`, `pass 1`, `fail 0`, `skipped 0`                                                                                                              |
| Remaining focused contracts                          |      0 | `tests 4`, `pass 4`, `fail 0`, `skipped 0`                                                                                                              |
| Initial BDD / isolated S05 diagnostic                | 1 each | `5 scenarios (1 failed, 4 passed)` / `1 scenario (1 failed)`; missing packaged reviewed TypeScript glue, with one dependent step skipped per failed run |
| Fixed isolated S05                                   |      0 | `1 scenario (1 passed)`, `3 steps (3 passed)`                                                                                                           |
| `npx playwright install chromium`                    |      0 | Official Chromium 140.0.7339.186, build v1193, plus matching headless shell and FFmpeg                                                                  |
| Final `npm run build`                                |      0 | `tsc --outDir dist/cucumber` and strict `tsc --project tsconfig.cucumber.json` completed                                                                |
| Final `npm run test:features:regression`             |      0 | **41 scenarios + 46 Node tests passed**, no aggregate failures/skips                                                                                    |
| Final `npm run format:check`                         |      0 | `All matched files use Prettier code style!`                                                                                                            |
| Final owned-file `prettier --check`                  |      0 | Same success for new scripts/glue, JSON/configuration and docs                                                                                          |
| Final `npm run lint`                                 |      2 | `ESLint couldn't find a configuration file.` — baseline RRDPLAT-28                                                                                      |
| Final `git diff --check`                             |      0 | No output                                                                                                                                               |
| Secret scan / CodeQL                                 |  clean | No secrets; JavaScript analysis found **0 alerts**                                                                                                      |

Final aggregate stdout counts, without flattening scenarios into unit tests:

```text
input preparation: 19 scenarios (19 passed), 57 steps (57 passed)
feature validation: tests 6, pass 6, fail 0, skipped 0
synthetic feature: 1 scenario (1 passed), 4 steps (4 passed)
execution contracts: tests 21, pass 21, fail 0, skipped 0
retry acceptance: 10 scenarios (10 passed), 23 steps (23 passed)
timeout/cleanup contracts: tests 7, pass 7, fail 0, skipped 0
reporting contracts: tests 7, pass 7, fail 0, skipped 0
reporting acceptance: 6 scenarios (6 passed), 18 steps (18 passed)
adapter contracts: tests 5, pass 5, fail 0, skipped 0
adapter acceptance: 5 scenarios (5 passed), 15 steps (15 passed)
Installed immutable tarball sha256=10c077f03ca11be26a9392064e70f571dd355cbf7734a95b089b53082ab83599
added 153 packages, and audited 154 packages
7 vulnerabilities (5 moderate, 2 high)
```

That digest identifies the tested implementation tarball; this handoff is a
subsequent documentation-only change, not a claim that its changed documentation
has the same tarball digest. Full command output is retained for this session in
`/tmp/rrdweb6-final-*.log`; focused failure/success logs use `/tmp/rrdweb6-*.log`.
The source install after the necessary Playwright patch reported 18 remaining
audit findings (6 moderate, 12 high); the independent production-only consumer
reported the 7 above. Neither audit output is hidden or treated as a clean audit.

At implementation review, Gitar reported “No issues found” and a successful
check, but explicitly “Functional validation: Not enabled.” There were no review
threads. This does not substitute for the owner's final independent review/tests
or clear future bot findings. S03/S06 and durable central persistence remain open.

### Runtime remediation evidence (Node 22.23.4)

A clean `npm ci --ignore-scripts` and build passed. The normal regression batch
passed all 46 Node tests and 40 of 41 acceptance scenarios. Its new installed-root
assertion exposed unresolved TypeScript logger aliases in the packaged root
export. Three internal imports were changed to relative paths; no export or
behavior was removed. The affected installed-tarball scenario then passed all
three steps, including root data generation, real adapter execution and worker
tamper rejection. Unaffected browser suites were not repeated.

The final build, source/test formatting, changed-file formatting and whitespace
checks passed. Both the source production-only audit and the independently
installed production consumer reported zero advisories. The clean development
install still reported 12 tooling advisories (11 high, one moderate); wider
lint/tooling remediation remains deferred to RRDPLAT-28.

The successful consumer tarball SHA-256 was
`ca57d7b7c93ee0a23a3288bd3011335a1db41a8027242f79ee489f2096d8fa45`.
This evidence paragraph was added afterward, so that digest identifies the
tested package, not a future documentation-inclusive tarball. Validation logs
are `/tmp/web17-final-*.log`, `/tmp/web17-root-*.log` and
`/tmp/web17-final-audit.json`. The original failed scenario remains recorded in
the aggregate log. No hosted workflows or Copilot tasks were run for this repair.

### Matcher alignment follow-up

Gitar identified that validation used cucumber-expressions 18.0.1 while Cucumber
12.9.0 used a nested 19.0.0. A focused resolution regression reproduced this
mismatch, then passed after pinning 19.0.0 directly and updating the reviewed
implementation pin and examples. The installed consumer also verifies that both
resolve the same matcher, without relying on the source checkout.

After this shared matcher change, the full clean-install/build/regression batch
passed: **47 Node tests, 41 Cucumber scenarios and 117 steps**, with no failures
or skips. Formatting and whitespace checks passed. Source and installed-consumer
production audits each reported zero advisories; the 12 development-tooling
advisories remain disclosed above. Logs are `/tmp/web17-matcher-final-*`;
red/green evidence is `/tmp/web17-matcher-red.log` and
`/tmp/web17-matcher-green.log`.

The tested consumer tarball digest is
`34895e0199306520d3b05dfe3cd0bf1f322a4d6803b3400c46fbfff1b6af4fff`.
This evidence paragraph is a subsequent documentation-only addition.
