# Maintained authoring starter (checkout distribution)

This directory is a maintained starter inside the framework checkout. Use a reviewed
revision containing this directory and the repository's `package-lock.json`.
The supported distribution is the **whole repository checkout/archive**, not copying
this folder alone and not a new npm subpath export. The relative imports deliberately
reuse the framework's BasePage, BaseComponent and readiness helper.

## Install and run from the repository root

```sh
npm ci
npx playwright install chromium
npx tsc -p examples/authoring/tsconfig.json
npx playwright test --config examples/authoring/playwright.config.ts
npx cucumber-js --config examples/authoring/cucumber.json
```

Use the Chromium downloaded for the locked Playwright version. The dedicated
TypeScript build produces `dist/authoring`; embedded synthetic HTML requires no
asset-copy step. Cucumber imports only that build. Rebuild after changing source.
Do not run `node` directly on the TypeScript steps.

To verify the starter before adapting it:

```sh
npx playwright test --config examples/authoring/playwright.config.ts --repeat-each=3 --workers=4
node --test dist/authoring/examples/authoring/regression/authoring.test.js
```

The regression command repeats all three Cucumber scenarios three times with three
workers, then checks deliberate failures and discovery separation. Expected failure
probes are child processes whose failures are asserted by the regression suite;
they are not included in the normal Cucumber configuration.

## Choose syntax and organization separately

| Organization | Playwright Test / TypeScript | Gherkin / Cucumber with TypeScript steps |
| --- | --- | --- |
| Simple | `simple.spec.ts` | `Scenario: Simple` |
| Page Objects + Components (recommended) | `page-objects.spec.ts` | `Scenario: Page Objects and Components` |
| Business Flows | `business-flows.spec.ts` | `Scenario: Business Flows` |

`support/` is shared across runners. `support/fixtures.ts` is the Playwright lifecycle
adapter; `cucumber/world.ts` and hooks in `cucumber/steps.ts` are the Cucumber adapter.
The three Gherkin scenarios call specific business steps, not a generic keyword DSL.

For POM steps, use one consistent convention: **action or expected state + named
field/control + `on the <Page name> Screen`**. Every POM step, including setup and
assertions, ends with the concrete screen name. Parameterize entered/expected values;
keep control names bound to specific page/component methods. For example:

```gherkin
When I enter "Synthetic rehearsal" in the "Title" field on the Draft Screen
And I click the "Save draft" button on the Draft Screen
Then the status message shows "Saved: Synthetic rehearsal" on the Draft Screen
And the "Drafts" list contains only "Synthetic rehearsal" on the Draft Screen
```

Reuse these bindings for different values on the same screen. Add screen-specific
bindings for other pages rather than mapping arbitrary strings to locators. Simple
and Business Flows retain their distinct organization; the screen convention applies
to POM scenarios, including any Background steps they inherit.

The origin `https://authoring.invalid/` is intercepted locally. Unknown requests are
blocked, service workers are disabled, and no customer system is contacted. Each
Playwright test and Cucumber scenario owns fresh storage and data. Cucumber reports
include a cleanup attachment after browser/context closure, including failed scenarios.
Regression coverage includes interruption by context closure. Abrupt process/OS
termination (for example SIGKILL) is not a supported graceful-cleanup guarantee;
there is no new signal-handling or runtime-admission layer here.

## Migrate from the legacy generic example

`tests/example-app.spec.ts` remains unchanged with its existing root configuration.
Root test discovery does not include this starter, and root Cucumber feature discovery
does not include `examples/authoring/cucumber`. Nothing changes a customer's runtime
path automatically.

1. Run the owned starter first. Choose one spec/scenario style as the pattern to adapt.
2. Create an application-owned suite/config in your repository. Keep its browser/auth
   lifecycle explicit, with a fresh context per test/scenario. Do not reuse synthetic
   interception as if it verified a real application.
3. Replace the synthetic model and visible-state locator with your actual page
   contract. Keep exact business outcome assertions after actions. Do not replace
   readiness with network idle.
4. Move only genuinely repeated UI operations into a component/page, and repeated
   business operations into a composed flow. Base classes are optional.
5. Keep deterministic builders test-scoped. If records must exist in a shared remote
   service, design a separate authorized setup/cleanup strategy; this builder is not
   a lease or a global uniqueness mechanism.

No generator, arbitrary-code upload, AI generation or automatic portal integration
is provided. See [the framework authoring guide](../../docs/authoring-styles.md).
