# Standalone synthetic Cucumber + Playwright

This maintained Cucumber/Gherkin path runs an assertion-backed browser scenario against a tiny HTTP page owned by this repository. It binds only to loopback on an ephemeral port and requires no ReleaseReady account, portal, database, customer environment, or hosted service.

## Setup and run

Requirements: Node.js 18+ and npm.

```bash
npm ci
npx playwright install chromium
npm run test:features -- --tags @synthetic
```

The command reports the scenario's actual outcome in the terminal and writes Cucumber JSON results to `reports/cucumber-results.json`. A failed browser assertion fails the command. To select a different tagged feature, pass its tag after `--`; only reviewed step definitions listed by `cucumber.json` are executable. Feature files are Gherkin descriptions, not JavaScript or uploaded customer code.

Cucumber steps and hooks have a validated 15-second default timeout. To adjust it for a slower local machine, set `CUCUMBER_STEP_TIMEOUT_MS` to an integer from `12000` through `60000` (for example, `CUCUMBER_STEP_TIMEOUT_MS=20000 npm run test:features -- --tags @synthetic`). Values outside that range are rejected before execution. Playwright launch/navigation are bounded at 10 seconds, while actions and assertions retain their 5-second timeout, so their useful error details surface before Cucumber's outer timeout.

Hooks, steps, and regression tests are authored in TypeScript and strictly compiled by the repository's existing TypeScript compiler. `cucumber.json` points Cucumber to generated, ignored JavaScript output; regression runs use a separate config with no JSON report formatter.

Run the local timeout and cleanup regression checks with:

```bash
npm run test:features:regression
```

This command runs the real scenario first, then checks timeout defaults and bounds, a synthetic step lasting longer than the old 5-second limit, readable Playwright assertion output, that the real results report stays byte-for-byte unchanged, and independent cleanup/error preservation including server closure when browser close rejects or does not settle. Browser shutdown is bounded at 5 seconds; if it does not finish, the run reports that its final state is unknown and proceeds to close the listener.

## Scope and boundaries

Owned paths for this standalone bootstrap include `package.json`, `package-lock.json`, `cucumber.json`, `cucumber-regression.json`, `tsconfig.cucumber.json`, `features/synthetic.feature`, `features/steps/synthetic.steps.ts`, `features/steps/timeout-regression.steps.ts`, `features/support/hooks.ts`, `features/support/world.ts`, `features/support/step-timeout.ts`, `features/support/cleanup-runtime.ts`, `scripts/cucumber-timeouts.test.ts`, this guide, and the README link. Generated JavaScript is written only under ignored `dist/cucumber`. The feature describes observable behavior; TypeScript step definitions contain reviewed Playwright actions and assertions, and support hooks own the local target and browser lifecycle.

This is a small reviewed-step and tag-selection seam for later validator work, not the validator. It does not execute feature-supplied code, add customer journeys, connect to ReleaseReady systems, or use external infrastructure. Existing Playwright Test tooling and suites remain separate and unchanged.

The relevant validation level here is browser end-to-end testing: there is no application logic or service contract to unit-, component-, contract-, or integration-test in this synthetic target.
