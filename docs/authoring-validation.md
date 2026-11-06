# RRDWEB-12 authoring validation

Baseline: `64b5cc385960823b624eb667fedef2ecacfa8665` (verified remote main at branch creation).
Environment: Node 24.22.1, locked Playwright 1.55.1, downloaded Chromium build 1193.
No system-browser substitution or customer targets were used.

## Exact-head review findings addressed

At original PR48 head `4ea00827451dd86506308811cace0e3fcc66c0c1`, GitHub's
[Sonar check annotations](https://github.com/releaseready/universal-playwright-framework/runs/127887931299)
reported insecure HTTP in the synthetic origin and no direct assertion in the
Business Flows spec. The origin is now intercepted HTTPS, and that spec explicitly
asserts the saved draft list. No suppression, exclusion or gate change was used.

The [discovery finding](https://github.com/releaseready/universal-playwright-framework/pull/48#discussion_r4492321775)
was independently reproduced: root discovery contained 71 cases, including 50
unintended authoring/browser combinations. Moving the starter outside `tests/` and
`features/` restores the original 21 root Playwright cases, with zero authoring
cases; dedicated discovery contains all 10 authoring checks. No root testIgnore or
existing test removal was needed. Dedicated Cucumber paths likewise avoid root
feature discovery.

## Final local checks

| Check | Result |
| --- | --- |
| `npm run test:typescript-source-policy` (includes full build/typecheck) | Pass; 4 tests and source-policy pass |
| `npx tsc -p examples/authoring/tsconfig.json` | Pass; both runner adapters, shared models and regression tests compile |
| `npx eslint src/readiness/wait-for-visible.ts src/pages/base-page.ts src/index.ts examples/authoring --ext .ts` | Pass |
| `npx playwright test --config examples/authoring/playwright.config.ts --repeat-each=3 --workers=4` | Pass; 30 tests, zero retries |
| `npx cucumber-js --config examples/authoring/cucumber.json` | Pass; 3 scenarios / 11 steps with 3 workers |
| `node --test dist/authoring/examples/authoring/regression/authoring.test.js` | Pass; 7 regression tests |
| `npm run test:features` | Pass; existing owned Cucumber suite, 12 scenarios / 52 steps |
| `npm run lint` | Fail; 33 errors, normalized output identical to pristine baseline in a separate worktree |
| `git diff --check` | Pass |
| Full execution/customer aggregate; Firefox/WebKit | Not run; outside scoped Chromium authoring validation |
| Hosted CI dispatch, customer actions, merge/deploy | Not performed |

The seven regression tests include three repeated parallel Cucumber runs (nine
successful scenarios), four deliberate child-process failures (missing readiness,
hidden readiness, false saved outcome and context interruption), root/dedicated
discovery separation, and a Before-hook timeout with late browser acquisition.
Each scenario must attach exactly one successful cleanup confirmation from a
**passing After hook**. Expected failing child scenarios must exit nonzero within a
bound, preserve readable failure evidence and close their owned browser/context.

Independent review found and re-reviewed fixes for the initial idle timing/hidden
locator test weaknesses and the later setup/cleanup race and false-positive cleanup
evidence. Cleanup now waits for pending setup to settle, stops further acquisition
once closing starts, and confirms only error-free closure. If setup never settles,
the After hook times out instead of claiming cleanup succeeded. Abrupt OS process
termination is not represented as graceful cleanup support.

## POM wording follow-up

All five POM scenario steps end with `on the Draft Screen` and name the form,
field, button, status message or list they act on/assert. Entered and expected values
use reusable Cucumber string parameters; fixed controls map to page/component methods.
The POM scenario has no inherited Background lacking the screen suffix. The existing
`DraftEditor.save(title)` method remains compatible through composition of
`enterTitle(title)` and `saveDraft()`. Independent source review found no issues.
Dedicated compilation/lint, all three Cucumber scenarios (11 steps), seven regression
checks and the repeated parallel Playwright suite were rerun for this follow-up.

## Clean consumer check (preceding head 150a14c)

A fresh archive of the staged source was extracted outside the working checkout,
without node_modules or generated output. `npm ci` installed locked dependencies
and ran the normal prepare/build. Dedicated TypeScript compilation then passed,
followed by all 10 Playwright checks and all 3 Cucumber scenarios (9 steps).
No symlinked dependencies or compiled output from the development checkout were used.
The already downloaded matching Chromium binary was reused via
`PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright`; package installation,
compilation and runner commands otherwise match the maintained starter README.

See [authoring styles](authoring-styles.md) and the
[starter README](../examples/authoring/README.md) for the supported six-combination
matrix, checkout distribution and migration path. Portal integration, arbitrary code
execution and leased data remain outside this implementation. Remote check status
is reported separately for the pushed exact head; these local results do not claim
a remote quality gate passed.
