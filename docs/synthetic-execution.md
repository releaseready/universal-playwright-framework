# Reviewed synthetic scenario execution

This local adapter runs one repository-owned, reviewed Cucumber scenario per
owned Node process. Each worker gets its own Playwright browser context and
the only target is an ephemeral loopback server owned by that run. Playwright
routes every browser request and blocks destinations outside the prepared
loopback origin before a connection is made.

## Run and test

Install the project's locked dependencies and the matching local browser:

```bash
npm ci
npx playwright install chromium
npm run execute:synthetic
npm run test:execution
```

The command prints a bounded JSON outcome and exits nonzero unless a selected
scenario and its resource teardown are confirmed successful. The default CLI
selection is the reviewed `@web-safe-execution-S01` scenario. The regression
command also exercises assertion failure, pending and undefined steps, empty
selection, a blocked redirect, run/scenario timeouts, isolated cancellation,
normal teardown, and an explicitly injected cleanup fault.

The TypeScript adapter uses the existing feature validator, approval selector,
and input preparer. Feature, runner/configuration, glue, policy, and fixture
revisions are pinned in `src/execution/reviewed-scenarios.ts`; changing them
requires an explicit review and revision update. Only this fixed feature and
its compiled, repository-owned glue are loaded by Cucumber. Inputs are
synthetic and are copied per selected scenario.

The adapter bounds a run to six scenarios and two concurrent workers. Each
worker runs Cucumber in its own process group; cancellation or timeout signals
only that run's owned group. A forced stop is reported as unknown cleanup,
never as a confirmed teardown. Normal completion is reported only after
Cucumber evidence and the cleanup sidecar both confirm success. Diagnostics
contain a random reference and bounded cleanup stage names, not fixture values
or raw browser errors.

Prepared account/cleanup references are not consumed. No secret provider or
data-changing cleanup is invoked; restoration remains unknown because fixture
cleanup requests are unverified metadata. Bounded automatic retries, external
targets, customer data, and ReleaseReady account integration are out of scope.
