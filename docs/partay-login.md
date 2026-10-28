# Partay login-only consumer (RRDWEB-8)

[Ticket](https://noisegatemusicstudios.atlassian.net/browse/RRDWEB-8).
This consumer does not establish customer acceptance until an authorized live
run actually passes. Synthetic fixture results are not customer-login evidence.

## Reviewed journey

- Navigate only to `https://partay.staging.noutify.app/`.
- Require visible `#overlay`; fill its `#username` and `#password` from the
  runtime provider and click `#authGo` once. There is no automatic login retry.
- Require `#overlay` hidden, the exact final URL above (no alternate path,
  query or fragment), and visible `#brandLogo` with rendered text exactly `Partay`.
  The logo and URL already exist behind the login overlay and are insufficient
  on their own.
- Do not visit another workflow or modify customer data. Other
  document destinations, including redirects and popup destinations, are blocked.
  Every routed HTTP(S) request (including fetch, form, iframe and assets) must
  use the approved origin; document requests must use the exact login URL.
  The shared transport uses `route.fetch({ maxRedirects: 0 })` and only fulfills
  non-30x responses. **All HTTP 30x responses are rejected**, even same-origin
  redirects: Chromium never receives a redirect to follow outside interception.
  Redirect chains therefore stop at the first response, before the next hop.
  WebSockets are blocked, and service workers are disabled. An observed blocked
  request or transport failure fails the run. This deliberately fails closed;
  a site requiring redirects needs a separately reviewed policy, not a bypass.

Site-specific actions are in [partay.ts](../src/customer-login/partay.ts).
Shared resource lifetime is in
[runtime-login-browser.ts](../src/execution/runtime-login-browser.ts).
Do not use the example authentication setup: it saves storage state.

## Runtime integration

```typescript
import { verifyPartayLogin } from "@universal/playwright-framework";

await verifyPartayLogin(preparedDescriptor, reviewedRequest, runtimeProvider, {
  signal: cancellationSignal,
  timeoutMs: 30_000,
});
```

`consumeRuntimeLoginInputs` validates the one-scenario descriptor, reviewed data
binding, account revision, environment, scope and expiry before browser
acquisition. Provider disposal and fixed safe errors remain owned by that
existing boundary. The callback validates the exact target before navigation.
The result contains only scope/account references, not credentials.

A fresh non-persistent Chromium browser/context is acquired for each call and
closed in `finally`. The operation races cancellation/the overall deadline, so
even a never-settling browser operation cannot retain the provider indefinitely.
Cancellation requests both context and browser closure independently. Final
cleanup allows at most **1,000 ms total** (two 500 ms stages): context closure
gets a head start, but cannot prevent the browser-close attempt. Neither close
promise must settle for the consumer to return a fixed safe failure and allow
provider disposal. Late acquisition also requests closure; late rejections are
handled, not emitted as unhandled promise rejections. The operation deadline is
bounded by the request expiry (default 30 seconds, at most 120 seconds), plus
the cleanup budget (subject to normal event-loop scheduling).

Success requires both acquired resources' close promises to resolve. Rejected
or unconfirmed shutdown produces no success receipt and cannot set
`cleanupCompleted: true`. A timeout is **not proof that Chromium stopped**:
an unresponsive/defective launcher may leave a process or in-flight operation
alive; do not retry or treat local/session cleanup as verified. This is bounded
waiting, not OS-level process termination or server-session revocation.
The trusted launcher seam exists for owned tests; it must not be supplied from
job JSON or used to enable recording/session reuse.

No storage-state file, profile, screenshot, video, trace, account logging or
credential-bearing exception is produced. Run without Playwright debug/protocol
logging or external browser instrumentation. Closing a context removes local
session state; it does not revoke a server-side session or prove server cleanup.
JavaScript disposal drops references; it does not guarantee memory erasure.

## Secure operator invocation

The local operator must provide the independently approved reference-only
prepared descriptor and runtime request described in the
[runtime input contract](./input-preparation-contract.md).
They must select the approved customer account reference and exact Partay
environment, have current review bindings, and use a new run ID and unexpired
request. Do not copy the synthetic test descriptors or treat submitted JSON as
approval.

From a private interactive terminal, using a supported Node version:

```sh
npm run verify:partay-login -- /path/to/approved-descriptor.json /path/to/approved-request.json
```

Only reference-file paths are arguments. The existing non-echo TTY prompt
collects both account fields in memory. There is no credential file, environment
variable, argument, pipe or chat fallback. SIGINT/SIGTERM request cancellation,
and cleanup is awaited before returning. Do not capture terminal input or enable
debug recording. A rejected login is not retried; stop and have the operator
review the account/permission before any subsequent run.

Only after all assertions and cleanup succeed, the command emits a reference-only
receipt with `checks.expectedUrlMatched`, `checks.partayLogoVisible`,
`checks.overlayDismissed` and `checks.cleanupCompleted` set to `true`, and
`cleanupStatus: "confirmed"`. A failure emits only a structured safe report to
stderr and exits nonzero, never a successful receipt:

```json
{
  "status": "not-verified",
  "failureStage": "navigation",
  "cleanupStatus": "confirmed",
  "automaticRetryAttempted": false
}
```

Failure stages are allowlisted: `input-validation` (including reference-file
reading/parsing and secure input collection), `browser-startup` (launch,
context/page acquisition), `navigation` (destination guard, initial navigation
and URL assertion), `submission-assertion` (form, single submit and remaining
assertions), `cleanup` (assertions completed but shutdown unconfirmed),
`input-disposal` (runtime provider disposal failed), or `unclassified` (unknown
diagnostic metadata). No exception text, cause, request contents, paths or
arbitrary supplied strings are included. `partayLoginFailureReport` reconstructs
only allowlisted values and returns no account/scope data.

Cleanup is a **separate dimension**, not the failure stage:

- `not-acquired`: no browser/context was returned and no acquisition is pending,
  e.g. input validation or a launcher rejection before resources were returned.
  This does not prove a defective launcher created no OS process.
- `confirmed`: all acquired browser/context close promises resolved within the
  budget. A navigation/assertion failure can still have confirmed cleanup.
- `unconfirmed`: a close rejected, did not settle within the budget, or resource
  acquisition was interrupted while pending. Late closure remains best-effort;
  the returned status is not retroactively upgraded.

An earlier failure stage is retained even if cleanup also fails. Successful
assertions with unconfirmed cleanup report stage `cleanup`, exit nonzero and
produce no receipt or `cleanupCompleted: true` fallback. These statuses describe
local resource closure, not server-session revocation or OS-level termination.
Share only the sanitized outcome, never raw browser/terminal logs or account values.

`promptAndVerifyPartayLogin` exposes the same operator path in-process. It uses
`withOperatorLoginInputs`, which in turn reuses `consumeRuntimeLoginInputs`.
The shared browser displayed in an editor is not reused for credential entry.

## Local checks and retained handover evidence

`npm run test:customer-login` compiles and runs owned Chromium fixtures.
Customer-URL fixtures remap only the guarded transport to owned loopback HTTP
servers; they do not contact the customer site. Separate real loopback HTTP
tests exercise 301/302/303/307/308 redirects to off-origin destinations,
same-origin unapproved paths and chains, plus off-origin POST fetch,
top-level/iframe forms and same-origin fetch redirect chains. Destination
server counters must remain **zero**, including the blocked next chain hop.
An approved same-origin POST is also tested to avoid a vacuous deny-all result.
Coverage includes a single successful submit, background-logo/rejected
login false positives, wrong URL/text/visibility, blocked redirect, missing
form, cancellation, timeout, invalid preflight, late acquisition, safe errors
and disposal/cleanup. Never-settling context, browser, and both-close faults
are tested after successful assertions, assertion failure, cancellation and
timeout: both closures are attempted, the safe result fails within the deadline
plus cleanup budget, and the provider is disposed. Tests explicitly rescue
their owned browsers afterwards; this is not evidence that a hung production
close stopped its process. Focused offline tests also cover input/CLI failures,
launch/context/page startup failures, navigation versus submission/assertion
stages, independent confirmed/unconfirmed cleanup, interrupted pending launch,
provider disposal faults, and allowlist reconstruction from canary-bearing
exceptions, causes and injected metadata. It is included in
`test:features:regression`.

Live customer acceptance remains **PENDING**. No live credentials, customer
attempts or shared/staging browser interactions are part of these checks.
The previous operator attempt's login outcome is **UNKNOWN**: do not infer
successful authentication or credential rejection from its generic failure.
Its cleanup outcome is also **UNKNOWN**. No new live attempt was performed for
this repair. A read-only process check found no exact `verify-partay-login.js`
Node parent remaining, so no browser could be definitively attributed to that
attempt; ownership remains **UNKNOWN**. No process was stopped, and no browser
profile or customer content was accessed.

For RRDSCRUM-62, retain rather than unnecessarily rerun
[merged PR #21](https://github.com/releaseready/universal-playwright-framework/pull/21)
(merged 2026-10-28 05:39:51 UTC). Its recorded evidence is:

- Real OS PTY probe (Python standard-library `pty`, Node 22), exit 0: both
  account fields non-echoing, neither synthetic canary in output, reference-only
  receipt, terminal echo restored and process exited normally.
- `test:input-preparation`, exit 0: 21 Node tests and 28 Cucumber scenarios /
  90 steps passed, including owned browser runtime delivery and fresh-context
  isolation.
- Full feature regression, exit 0: 68 Node tests and 50 Cucumber scenarios /
  150 steps, zero failed/skipped; installed-package exports and tamper checks.
- Build, formatting and diff checks passed. These are retained PR #21 results,
  not newly executed RRDWEB-8 results and not customer acceptance.
