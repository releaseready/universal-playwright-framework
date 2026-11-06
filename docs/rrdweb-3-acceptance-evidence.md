# RRDWEB-3 input acquisition evidence

## Scope and source identities

Audit date: 6 November 2026. This is an implementation/evidence reconciliation,
not a new provider, runtime activation, or acceptance authorization.

- Framework `main`: `64b5cc385960823b624eb667fedef2ecacfa8665`, package
  `@universal/playwright-framework` version `1.0.0`, Playwright `1.55.1`,
  matching Chromium/headless-shell revision `1193` (140.0.7339.186).
- Central `main`: `afb0677476228a42b2b5e1479059d61c7b3f4b51`.
  Its manifest pins framework `3065384fc4346cd68da4881a3df337388a37529d`,
  TDM `b59d9854a4c7c8b0a3d923231d132941b7607199`, and TCM
  `af307c91a926817732c5682bf52dec88fac73a02`. Central's framework pin is
  **not** the current framework main. No consumer manifest was changed here.
- Central paths below refer to that exact central commit in
  [ReleaseReady](https://github.com/releaseready/ReleaseReady/tree/afb0677476228a42b2b5e1479059d61c7b3f4b51).
  Framework paths refer to the framework commit above unless stated otherwise.

## Acceptance mapping

| RRDWEB-3 AC                                                     | Existing implementation and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Boundary / remaining obligation                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Source/package identity and reconciliation                   | Identities above and validation below distinguish current source, installed package, and historical acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Version `1.0.0` alone is not an immutable identity; use commit and artifact digest.                                                                                                                                                                     |
| 2. Automatic exact jointly reviewed TDM input                   | Central `apps/api/auth/automatic-runtime.ts`, `apps/api/jobs/automatic-inputs.ts`, `apps/api/test-data/worker-authority.ts` call `checkJointAdmission` and bind exact case/data references, schema/recipe receipt and a per-run capability. `tdm-worker-provider.ts` consumes the public TDM `/v1/materialize` contract and validates the exact receipt before constructing the framework's public `InMemoryRuntimeSecretProvider`.                                                                                                                                                                       | Trusted central composition owns reviewer identity, scope, current approvals and independent execution permission. The standalone Web package does not manufacture that authority. No duplicate TDM implementation is needed.                           |
| 3. Fail before protected acquisition/browser                    | Central `automatic-worker.ts` lazily acquires only after preflight; rejects wrong scope/reference, expiry and cancellation. `worker-authority.ts` checks current joint admission and persisted run references. Central `apps/portal-tests/automatic-inputs.test.ts` covers changed case/recipe/dataset/row/association/membership, pending cancellation and separate service scopes; `tdm-worker-provider.test.ts` covers altered receipt and cancelled fetch. Framework `scripts/data-references.test.ts` and `runtime-login.test.ts` cover stale/missing/mismatched references, expiry and safe errors. | These source/test mappings do not assert globally atomic cross-service revocation. Terminal entry is disabled by RRDPLAT-39 with no environment override or fallback.                                                                                   |
| 4. Ephemeral values and truthful disposal                       | Central `private-worker-bootstrap.ts` and `private-worker-bootstrap.test.ts` separate capability/token delivery through an anonymous pipe from ordinary IPC/argv/env. Worker materialization creates a scoped expiring provider; bootstrap bytes and retained value references are released. Framework `runtime-login.ts` sanitizes provider/consumer exceptions, discards callback returns and disposes on exit. `runtime-login.test.ts` checks canary absence in ordinary payloads/errors/receipts.                                                                                                     | JavaScript strings cannot be guaranteed erased; trusted callback code must not retain/log values. Dropping references is not revoking a credential already used by a browser.                                                                           |
| 5. Approved navigation, fresh sessions and honest cleanup       | Framework `scripts/partay-login.test.ts`, `runtime-login-cleanup.test.ts`, `runtime-login.test.ts` exercise bounded policy, fresh contexts, cleanup and synthetic session isolation. The reference-preparation API independently copies scenario fixtures.                                                                                                                                                                                                                                                                                                                                                | No customer account leasing/reset is provided. Cleanup errors remain errors/unconfirmed, not restored success. Existing teardown failures and held PR46 must retain their separate provenance.                                                          |
| 6. Standalone/package compatibility and positive/negative proof | Root `RuntimeSecretProvider` injection remains supported; `/data-references/v1` remains exported. `scripts/installed-adapter-smoke.ts` packs and installs outside the checkout; `installed-adapter-consumer.ts` exercises public exports. Focused tests and aggregate outcomes are recorded below.                                                                                                                                                                                                                                                                                                        | Test results use owned synthetic inputs. Package compatibility is not hosted acceptance.                                                                                                                                                                |
| 7. Hosted evidence through Platform12                           | No hosted run was performed by this audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Outstanding and gated.** RRDWEB-3's November 4 hosted AC is not erased by the older local-pilot scope. RRDPLAT-12 owns authorized hosted proof; RR30 retains actual customer-target acceptance. Do not mark the whole ticket Done from this document. |

## Historical local acceptance, preserved as historical evidence

[RR17 comment 10654](https://noisegatemusicstudios.atlassian.net/browse/RRDSCRUM-17?focusedCommentId=10654)
records owner-approved fresh local acceptance on 1 November: actual Keycloak PKCE,
protected input, exact joint review, bounded real browser against an owned
synthetic credential-checking target, saved/reopened results, interruption and
no replay. Its exact identities were central
`4a9f4e59bca8444d6c4329188b48976ae82fdf9f`, UI
`4a2869da06f7c4106c05d1b66fc189bc60bfe686`, and Web PR40 head
`1d363a7f7c5f8508c5fff3f0f918c6ea09225118`.

That record reports 839 ordinary tests (one separate opt-in two-user harness
skipped), 176 BDD scenarios / 2,159 steps and independent review. Those are
**recorded historical results, not reruns on today's commits**. This audit did
not access or restart the retained vault/stack, recreate its identity, or submit
a customer login. RR17/RR89 being Done does not prove Web3's newer hosted AC.

## Current validation

### Single full aggregate follow-up

On 6 November, exactly one `npm run test:features:regression` invocation on
published PR47 commit `9ab2c326557edb7e428274e07be6f43357727763` completed with
**exit code 0: 189 Node tests and 61 BDD scenarios / 198 steps passed**.
All aggregate stages were reached; none failed or were skipped. This includes
the installed-package consumer, whose tarball SHA-256 remained
`73cd20c9438c9d56de325e49e90a4ab49c510ef8947fec495128999ffdc7d4cb`.

The tracked tree was clean before and after the run and still matched that
exact commit. `package.json` SHA-256 matched the committed bytes before and
after: `66fd613c6ee1d4b0ec4e88ca13f2284aaebd3383d7589d64939f911910d24b33`.
The calculated and recorded review fingerprint both remained
`8e0733112e631ecfdcdd46a21361edc8d7c36b0d14da5c69187595f36c7e4627`.
Node `24.4.0`, Playwright `1.55.1` and installed matching Chromium revision
`1193` were used. No manifest experiment, concurrency/deadline/gate change,
source edit, alternate browser or retained-service restart occurred during this
run. The subsequent change only records these results in this document.

This closes the missing full-aggregate evidence for the local documentation
slice. It does not waive the separately recorded baseline lint failure or
complete hosted AC7. Earlier unsuccessful attempts remain recorded below.

### Earlier staged validation and retained failures

All current checks use Node `24.4.0`. The shell initially selected unsupported
Node `23.6.0`; Cucumber refused that attempt before scenarios ran. The existing
Node 24 toolchain was then selected explicitly, without installing a toolchain.

- Framework build and TypeScript source policy: passed.
- Framework lint: **failed, 33 existing errors** on unchanged source, including
  `no-unsafe-finally`, `no-control-regex`, unused variables and explicit `any`.
  This documentation change does not repair or waive them.
- Input preparation: **28 BDD scenarios / 90 steps, 26 Node tests passed**.
  The real Chromium fresh-session test initially failed under the filesystem
  sandbox; its isolated launch-enabled rerun and full focused run passed with
  the matching revision 1193 browser, not system Chrome.
- Customer/runtime regression: **116 Node tests passed**, including navigation
  policy and bounded cleanup cases. General feature tests: **12 scenarios / 52
  steps passed**. Feature-validation tests: **6 passed**.
- Central build and focused `automatic-inputs.test.js`,
  `tdm-worker-provider.test.js`, `private-worker-bootstrap.test.js`: **20 tests
  passed** at the central commit above. These are synthetic loopback service
  and worker-double checks; they do not rerun the historical real Keycloak
  journey or exercise AWS/Cognito infrastructure.

The aggregate was attempted. A temporary documentation allowlist edit to
`package.json` invalidated the deliberately pinned synthetic implementation
fingerprint, and downstream execution/adapter/reporting checks correctly failed
closed. That edit was fully reverted; no review pin or runtime source was
changed. The final calculated and recorded implementation fingerprint both equal
`8e0733112e631ecfdcdd46a21361edc8d7c36b0d14da5c69187595f36c7e4627`.
Affected downstream checks after the revert:

- Execution: **21 Node tests and 10 BDD scenarios / 23 steps passed**.
- Cucumber timeout/cleanup regression: **7 Node tests passed**.
- Reporting: **7 Node tests and 6 BDD scenarios / 18 steps passed**.
- Adapter: **6 Node tests and 5 BDD scenarios / 15 steps passed**, including
  installation and execution of an immutable tarball outside this checkout,
  public data-reference imports and rejection/tamper checks.
- Changed-document formatting and `git diff --check`: passed.

Do not call the interrupted aggregate invocation green; these are staged checks
on unchanged runtime source with the restored manifest.

The central lockfile SHA-256 is
`c336aba135f813c2d133b36a81d3704d0d2f76a337f9dee3abe5b8b60c73bd6e`;
the unchanged framework lockfile SHA-256 is
`5454881b8edbb6b7179e8df725f10ce539d86ad5fd130843a190850b67dd3f2d`.
Installed central package fingerprints after building (sorted relative POSIX
path + NUL + file bytes + NUL, SHA-256, excluding nested `node_modules`) are:

| Package         | Files | Installed tree SHA-256                                             |
| --------------- | ----- | ------------------------------------------------------------------ |
| Framework 1.0.0 | 121   | `3097b1a138dfe018450b3347099e9e641bdbb7f31bc402ea7e5e14a48f551cd8` |
| TDM 0.1.0       | 64    | `03e84b52150594e3eff67f9db1f1a50cfc559e7be867d9f485b8db4e1dba27db` |
| TCM 0.1.0       | 99    | `c533d164fdfb284f545261e6b135768ca79e71dd17e44cac59fa63e5667ac7e3` |

These are locally installed/built tree digests, not registry integrity or claims
that central has upgraded to framework main. The final framework tarball digest
is reported in the PR delivery evidence outside the tarball to avoid a
self-referential digest.

No hosted CI was enabled, no cloud/service/identity configuration changed, no
customer target was contacted, and no held PR was modified or merged. Hosted
acceptance remains pending authorization and configuration through RRDPLAT-12.
