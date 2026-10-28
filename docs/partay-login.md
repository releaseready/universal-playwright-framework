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
  An observed blocked document navigation fails the run.

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
closed in `finally`. Cancellation and the overall timeout close the browser to
interrupt pending Playwright operations. Late browser/context acquisition is
also closed. The deadline is bounded by the request expiry (default 30 seconds,
at most 120 seconds). Cleanup errors fail the run rather than producing a
success receipt. The trusted launcher seam exists for owned tests; it must not
be supplied from job JSON or used to enable recording/session reuse.

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
`checks.overlayDismissed` and `checks.cleanupCompleted` set to `true`. A failure
emits a fixed safe message and exits nonzero, not a successful receipt. Share only
the sanitized outcome, never raw browser/terminal logs or account values.

`promptAndVerifyPartayLogin` exposes the same operator path in-process. It uses
`withOperatorLoginInputs`, which in turn reuses `consumeRuntimeLoginInputs`.
The shared browser displayed in an editor is not reused for credential entry.

## Local checks and retained handover evidence

`npm run test:customer-login` compiles and runs owned Chromium fixtures.
All browser requests are intercepted locally; it does not contact the customer
site. Coverage includes a single successful submit, background-logo/rejected
login false positives, wrong URL/text/visibility, blocked redirect, missing
form, cancellation, timeout, invalid preflight, late acquisition, safe errors
and disposal/cleanup. It is included in `test:features:regression`.

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
