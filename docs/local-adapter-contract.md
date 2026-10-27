# Local adapter v1 — RRDWEB-6

[Jira RRDWEB-6](https://noisegatemusicstudios.atlassian.net/browse/RRDWEB-6) /
[issue 16](https://github.com/releaseready/universal-playwright-framework/issues/16).
This incremental change depends on [reviewed PR15](https://github.com/releaseready/universal-playwright-framework/pull/15),
base `copilot/rrdweb-5-bounded-reporting-adapter`, exact head
`192c7a0da689483e2a3c800d0f1def975dfb520b`.
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
Late cancellation during completed-attempt cleanup does not overwrite the actual
pass/failure. Unconfirmed cleanup preserves failure/uncertainty, never a successful
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

Playwright was patched from inherited 1.54.1 to exact 1.55.1 solely to address the
browser-download certificate advisory found by npm audit. The other promoted
runtime dependencies retain their reviewed versions. No broad audit-fix churn
was applied; inherited audit findings remain (including fixed-config parser/glob
dependency chains and unrelated existing faker/lint dependencies). This boundary
accepts no caller-provided files, YAML, glob expressions or executable options.
It is not a claim that the entire dependency tree is advisory-free.

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

Captured command stdout/exit results are recorded below after final verification.
