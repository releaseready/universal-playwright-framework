# RRDWEB-12 first-slice validation

Baseline: `64b5cc385960823b624eb667fedef2ecacfa8665` (verified remote main).
Environment: Node 24.22.1, Playwright 1.55.1, its downloaded Chromium build 1193.
No system-browser substitution or customer targets were used.

| Check | Result |
| --- | --- |
| `npm run build` | Pass |
| `npm run test:typescript-source-policy` (includes full build/typecheck) | Pass; 4 tests, source-policy pass |
| `npx eslint src/readiness/wait-for-visible.ts src/pages/base-page.ts src/index.ts tests/authoring --ext .ts` | Pass |
| `npx playwright test --config tests/authoring/playwright.config.ts --repeat-each=3 --workers=4` | Pass; 30 tests, zero retries |
| `npm run test:features` | Pass; existing owned Cucumber suite, 12 scenarios / 52 steps |
| `npm run lint` | Fail; 33 errors, normalized output identical to pristine baseline in a separate worktree |
| `git diff --check` | Pass |
| Full execution/customer aggregate; Firefox/WebKit | Not run; outside this scoped Chromium authoring validation |
| Hosted CI dispatch, customer actions, merge/deploy | Not performed |

Browser commands used `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright`
to select the pinned downloaded browser in this environment.

Independent review identified two weaknesses in initial test evidence: the idle
negative control was shorter than the 500ms idle threshold, and the hidden locator
implicitly excluded hidden elements. Both were corrected and independently
re-reviewed. The final traffic control uses 1200ms, verifies increasing request
counts, then stops telemetry and proves idle succeeds. The hidden check confirms an
attached button before asserting bounded failure.

An intermediate final-check attempt found TS2352 in the test's telemetry timer cast.
The correction explicitly checks an optional timer property before clearing it;
the full build/source-policy suite and repeated browser suite were rerun afterward.
The initial new fixture lint error was also fixed; final focused lint is clean.

See [authoring styles](authoring-styles.md) for the runnable capability matrix,
readiness compatibility change, and staged remaining work. The passing results do
not establish portal integration, arbitrary code execution or leased-data support.
