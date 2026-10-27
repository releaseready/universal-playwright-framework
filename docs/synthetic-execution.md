# Reviewed synthetic scenario execution

Run `npm ci`, `npx playwright install chromium`, `npm run execute:synthetic`, and `npm run test:execution`.
The parent owns a BrowserServer; each Cucumber worker gets a fresh context and process group. Only the run's synthetic loopback server is browsable; requests outside its approved origin are blocked. All redirects are rejected, including approved destinations, because Playwright routes only the first URL in a redirect chain.
`src/execution/reviewed-scenarios.ts` pins the feature, compiled worker modules, Cucumber/TypeScript configuration, fixture, and locked runtime identities. Approval is a fixed list, not derived from discovered scenarios.
Cancellation targets only owned worker processes. The parent verifies BrowserServer process exit through its exact handle; uncertain cleanup is never reported as a successful cancel or clean teardown.
Account/cleanup references are unused; there is no secret provider or data-changing cleanup. Data restoration stays unknown. Retries, customer targets/data, and ReleaseReady accounts remain out of scope.
