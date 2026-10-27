# Standalone synthetic Cucumber + Playwright

This maintained Cucumber/Gherkin path runs an assertion-backed browser scenario against a tiny HTTP page owned by this repository. It binds only to loopback on an ephemeral port and requires no ReleaseReady account, portal, database, customer environment, or hosted service.

## Setup and run

Requirements: Node.js 18+ and npm.

```bash
npm ci
npx playwright install chromium
npm run test:features -- --tags @synthetic
```

The command reports the scenario's actual outcome in the terminal and writes Cucumber JSON results to `reports/cucumber-results.json`. A failed browser assertion fails the command. To select a different tagged feature, pass its tag after `--`; only reviewed step definitions loaded by `cucumber.js` are executable. Feature files are Gherkin descriptions, not JavaScript or uploaded customer code.

## Scope and boundaries

Owned paths for this standalone bootstrap are `package.json`, `package-lock.json`, `cucumber.js`, `features/synthetic.feature`, `features/steps/synthetic.steps.cjs`, `features/support/hooks.cjs`, this guide, and the README link. The feature describes observable behavior; the step definitions contain the reviewed Playwright actions and assertions, and the support hooks own the local target and browser lifecycle.

This is a small reviewed-step and tag-selection seam for later validator work, not the validator. It does not execute feature-supplied code, add customer journeys, connect to ReleaseReady systems, or use external infrastructure. Existing Playwright Test tooling and suites remain separate and unchanged.

The relevant validation level here is browser end-to-end testing: there is no application logic or service contract to unit-, component-, contract-, or integration-test in this synthetic target.
