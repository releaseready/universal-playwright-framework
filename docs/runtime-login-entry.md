# Runtime-login entry for external-provider workers

Use the supported public entry when initializing a runtime-login worker:

```ts
import {
  verifyPartayLogin,
  validateRuntimeLoginRequest,
  RuntimeLoginFailure,
  partayLoginFailureReport,
  InMemoryRuntimeSecretProvider,
  withOperatorLoginInputs,
  PARTAY_LOGIN_URL,
  type PreparedInputDescriptor,
  type RuntimeLoginRequest,
  type RuntimeSecretProvider,
  type RuntimeLoginBrowserOptions,
} from '@universal/playwright-framework/runtime-login/v1';
```

The root entry remains compatible; each overlapping exported value has the same
identity, including RuntimeLoginFailure. The narrow entry does not re-export the root
barrel or load Playwright during initialization, input validation, disabled terminal
input, or while an external provider is pending. Existing provider cancellation and
disposal responsibilities remain with their owners; importing this entry does not
add a cancellation protocol for a provider that never settles.

Playwright is loaded when the existing browser consumer runs after reviewed input
resolution. Its loading time counts toward the existing work deadline. A wall-clock
check prevents launch after synchronous cold loading exhausts that deadline; the
launcher receives the remaining budget. The original policy, authority checks,
assertions, timeout classifications and cleanup budget remain in effect. Terminal
credential capture remains disabled. No execution permission is granted by importing
this module, and no consumer should use private deep imports to select it.

## Validation

```sh
npm run test:runtime-login-entry
npm run test:features:regression
npm run test:authentication-only
npm run test:owned-local
npm run test:typescript-source-policy
```

The dedicated gate runs isolated cold processes with a module-load guard. It checks
pending-provider IPC/cancellation, invalid/expired inputs, pre-cancelled browser
consumption, disabled terminal input, root export/class identity, a controlled cold
load exceeding the work budget, and a real owned loopback login through the existing
request guard. No customer request is sent. It then packs and installs the built
package outside the source tree, checks declaration consumers, compares installed
compiled files and repeats the five probes against the installed public export.
Five deterministic cleanup-deadline controls also run from source and the installed
package: on-time success/failure, boundary expiry, and late success/failure before
timer delivery. Cleanup uses its existing deadline even when promise settlement
precedes the timeout callback. This prevents false success; it does not explain
the separately retained authenticated-login aggregate timeout.
The package gate prints tarball SHA-256/integrity and the source HEAD for provenance;
use a committed clean tree when recording release evidence.

This removes the eager browser import path. It does not establish an absolute worker
startup guarantee under every aggregate load. Previously reported overlapping import
and IPC timings are not additive and do not establish a complete root cause. The
separate opt-in Dev Cognito pilot's installedLoginBrowser()/playwright-core startup
was not measured here and is not claimed fixed.

Central package pin adoption and fingerprint regeneration are separate reviewed work.
This change does not alter execution fingerprints, deadlines, concurrency limits,
terminal restrictions or held PR46 teardown behavior.
