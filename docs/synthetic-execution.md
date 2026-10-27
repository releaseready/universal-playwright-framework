# Reviewed synthetic scenario execution

Run `npm ci`, `npx playwright install chromium`, `npm run execute:synthetic`, and `npm run test:execution`.
The parent owns a BrowserServer; each Cucumber worker gets a fresh context and process group. Only the run's synthetic loopback server is browsable; requests outside its approved origin are blocked. All redirects are rejected, including approved destinations, because Playwright routes only the first URL in a redirect chain.
`src/execution/reviewed-scenarios.ts` pins the feature, compiled worker modules, Cucumber/TypeScript configuration, fixture, and locked runtime identities. Approval is a fixed list, not derived from discovered scenarios.
Cancellation targets only owned worker processes. The parent verifies BrowserServer process exit through its exact handle; uncertain cleanup is never reported as a successful cancel or clean teardown.
Account/cleanup references are unused; there is no secret provider or data-changing cleanup. Data restoration stays unknown. Customer targets/data and ReleaseReady accounts remain out of scope.
Synthetic execution defaults to zero retries. Callers may opt into at most two retries; the run timeout is shared across all attempts. Each attempt owns a fresh browser and loopback servers, and the next attempt starts only after cleanup is confirmed. Only ordinary failed attempts with confirmed cleanup can retry; cancellation, timeout, incomplete selection, and failed or unknown cleanup stop the run.
Results retain each attempt's status, scenario evidence, cleanup result, and diagnostic reference. A later pass is reported as `passed_after_retry`; it does not replace the earlier failure. The regression-only injected failure is recorded separately from the browser's actual passing scenario evidence.
Retries are coordinated by the execution adapter rather than Cucumber's scenario-retry option so each attempt can close its owned browser and servers before a new runtime starts.
