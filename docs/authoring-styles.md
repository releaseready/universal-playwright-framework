# Choose organization independently from syntax

RRDWEB-12 owned local starter: all three styles in both runners, not a portal execution feature.

Choose the smallest structure that helps the team:

| Organization | Use when | Example |
| --- | --- | --- |
| Simple | A short test is easiest to read with locators inline | `examples/authoring/simple.spec.ts` |
| Page Objects + Components (recommended starting point) | Pages and repeated UI regions benefit from named operations | `examples/authoring/page-objects.spec.ts`, `support/draft-page.ts` |
| Business Flows | A repeated business operation spans reusable page operations | `examples/authoring/business-flows.spec.ts`, `support/draft-flow.ts` |

These are organization choices, not different languages or execution permissions.
TypeScript Playwright Test specs and Gherkin scenarios with TypeScript Cucumber step
implementations can each use any of these structures. There is no keyword DSL.
BasePage and BaseComponent remain optional; flows use composition, not deep inheritance.

## Runnable capability matrix

| Organization | TypeScript / Playwright Test | Gherkin / Cucumber | Portal integration |
| --- | --- | --- | --- |
| Simple | Runnable owned draft example | Runnable owned draft scenario | Future |
| Page Objects + Components | Runnable owned draft example | Runnable owned draft scenario | Future |
| Business Flows | Runnable owned draft example | Runnable owned draft scenario | Future |

Existing Cucumber synthetic/login examples and runners remain available alongside
the dedicated three-style draft scenarios under `examples/authoring/cucumber`. `features/steps/login-ui-page.ts` already reuses BasePage.
This change does not claim arbitrary TypeScript uploads, generated-code execution,
portal style selection, or new runtime admission support.

## Run only the owned examples

From a checkout, install locked dependencies with `npm ci`, then install the browser
matching the pinned Playwright package with `npx playwright install chromium`.
Do not substitute a system browser.

```sh
npx tsc -p examples/authoring/tsconfig.json
npx playwright test --config examples/authoring/playwright.config.ts
npx cucumber-js --config examples/authoring/cucumber.json
npx playwright test --config examples/authoring/playwright.config.ts --repeat-each=3 --workers=4
```

The suite lives outside root `tests/` and `features/` discovery. Dedicated configs
avoid the default auth setup and customer/global configuration.
All requests from these tests are intercepted: the reserved `authoring.invalid` origin
serves repository-owned HTML, synthetic telemetry is fulfilled locally, and other
requests are blocked. No real account, purchase, customer data or service is involved.

Playwright creates a fresh browser context/page per test and retry. The shared
`support/fixtures.ts` composes a page, component, flow and draft data at **test scope**.
Cucumber creates a fresh World/browser/context per scenario and uses the same
runner-neutral page, component, flow and builder. Each scenario attaches cleanup
confirmation after closing its owned resources. The deterministic builder returns
fresh arrays on every call, supports explicit
overrides and uses no clock, random state or global counter. Repetition safely reuses
the same title because storage is context-local. This is not a uniqueness guarantee
for a shared remote service, nor a TDM lease; RRDSCRUM-21 remains separate and deferred.

The existing public TestDataFactory remains compatible. Its random/time-based
user/event data has a different purpose and is not silently changed to deterministic
data. The new draft builder is deliberately example-local, without credentials.

## Readiness and compatibility

`waitForVisible(locator, timeout = 10000)` is exported from the package root and
works without a base class. `BasePage.waitForReady(locator, timeout)` delegates to it.
Select a specific visible app state; timeouts must be finite, positive and at most
120000 ms. Missing, hidden or ambiguous locators fail rather than returning success.
For enabled state, exact text, counts and other conditions, prefer Playwright's
web-first assertions with an explicit timeout.

BasePage's existing `waitForPageLoad()` signature remains, but is deprecated: it now
waits only for `domcontentloaded` (30-second bound). Its navigation methods request
`domcontentloaded` instead of the full load event. They **do not promise application
readiness**. This is an intentional behavioral change: code relying on incidental
network quiescence must add its actual UI condition after navigation, or override its
page's `open()`/`waitForPageLoad()` to wait for that condition. Existing imports and
subclass overrides are preserved. No universal ready selector is inferred.

```ts
await page.goto(url, { waitUntil: 'domcontentloaded' });
await waitForVisible(page.getByRole('form', { name: 'Draft editor', exact: true }), 10000);
await page.getByRole('textbox', { name: 'Title', exact: true }).fill(draft.title);
await page.getByRole('button', { name: 'Save draft', exact: true }).click();
await expect(page.getByRole('status')).toHaveText(`Saved: ${draft.title}`);
```

A visible form/status alone is not proof of business success. Each runnable style
asserts the exact saved title and list content. Regression tests demonstrate delayed
UI, ongoing traffic, missing/hidden state failures, invalid timeout rejection,
false-pass prevention and fresh storage/data across repeated parallel tests.

## Starter distribution and migration

The supported starter is a full repository checkout/archive with locked dependencies.
It reuses existing source imports without adding public exports beyond the readiness
helper. A separate TypeScript config builds both runner adapters and shared models;
embedded HTML eliminates compiled asset-path assumptions. See
[the maintained starter README](../examples/authoring/README.md) for commands and
migration from the unchanged legacy `tests/example-app.spec.ts`.

## Remaining stages

1. Coordinate a separate portal integration with its owners. Review how syntax and
   organization are represented without implying upload or execution authorization.
2. Consider standalone starter packaging only if a separate-folder/npm distribution
   is needed. The current supported distribution is a complete reviewed checkout;
   copying the examples folder alone is not supported.

Portal selector/redesign, AI generation, leased data and runtime admission remain
out of scope. No PR46 teardown, evidence or adapter-pin changes are included.
RRDSCRUM-21 remains separately deferred. Cucumber regression covers context
interruption and assertion/readiness failures, not graceful cleanup after abrupt OS
process termination. No signal-control layer is added.
