# Synthetic input-preparation contract

`prepareScenarioInputs` accepts a JSON document no larger than 64 KiB. It
requires version 1, an explicitly supplied environment ID/revision and origin,
a same-origin initial target, and fixture data for exactly the runnable scenario
references returned by the existing validator and selector. The prepared
descriptor records safe revision identifiers and fixture values; it does not
redefine review or selection authority. Each descriptor gets independent fixture
and account-reference copies.

The inputs are bounded to 100 scenarios, 32 fields per scenario, 512 characters
per text value, and 25 entries per text list. Each scenario requires at least
one fixture field. A caller supplies `prepareScenarioInputs` with a separate
`ReviewedFixtureFieldPolicy`; a designated reviewer must approve this policy
from the scenario contract before execution. It is not read from or derived
from `inputJson`, and preparation never lets fixture data authorize its own
field names or types. The policy defines shared and per-scenario fields with
bounded string, string-list, number, or boolean types. Policy IDs and revisions
are recorded in the prepared descriptor.

Policy schemas reject credential-like field names, including password, secret,
token, credential, and access-token fields. Each fixture value must also
explicitly declare `non-sensitive`; secret classifications and fields absent
from the external policy are rejected. This caller declaration is not automatic
content inspection: undisclosed secrets embedded in otherwise approved text
cannot reliably be detected. Errors describe the invalid category without
echoing input values.

The initial target must be an HTTP(S) URL on the approved origin, without
credentials, query, or fragment. The check is parsing only: caller approval is
a trusted boundary, not authorization or a browser assertion. This slice does
not navigate, make network requests, or enforce redirects.

`RuntimeSecretProvider` describes the injected runtime consumption boundary;
`prepareScenarioInputs` does not accept or invoke a provider. Prepared account
access contains only account and secret reference identifiers. The one-login
runtime boundary below adds a local operator prompt and in-memory implementation;
it does not provision credentials or establish customer-run acceptance.

Each selected scenario may request cleanup with a synthetic cleanup reference
and requested revision. The cleanup request has no `authorized` field:
caller-provided authorization claims are rejected by the strict input schema.
Preparation represents a valid request as
`requested: true`, `authorizationStatus: "unverified"`, and
`outcome: "unknown"`; caller-provided fixture input cannot grant cleanup
authority. RRDWEB-4 must independently authorize cleanup before execution and
provide runtime evidence before reporting restored or unrestored. No reset
action is executed here, and this contract makes no claim about downstream
fail-closed enforcement. Browser-context/session isolation and cleanup
execution remain later runtime work.

Run the focused checks with `npm run test:input-preparation`; the local
`npm run test:features:regression` aggregate includes them.

## Reviewed dataset associations (RRDWEB-3 / RRDSCRUM-70 handoff)

`src/input-preparation/data-references.ts` supplies a separate, reference-only
review seam. `reviewDataReferences(candidate, approvedCatalogue)` accepts:

```json
{
  "version": 1,
  "rows": [
    {
      "scenarioId": "approved-outline/row-a",
      "dataset": { "id": "owned-demo", "revision": "v1" },
      "rowId": "row-a",
      "secret": { "id": "synthetic-account", "revision": "v1" }
    }
  ]
}
```

The externally approved catalogue has `datasets: [{id, revision, rows}]` and
`secrets: [{id, revision}]`. Secret references are optional for scenarios that do
not use accounts. Each expanded scenario has one distinct scenario ID; row IDs
are scoped to a dataset revision. Missing versions, unknown datasets/rows/secrets,
duplicate scenario IDs and extra payload properties fail with constant safe errors.
Neither API resolves fixtures or secrets, invokes browsers, or accepts secret values.
The result contains only references and a SHA-256 `binding`, canonicalized by
scenario ID. Input order does not change the binding. Changing a selected dataset,
row, scenario or secret revision requires a new binding and review.

Central integration must obtain the catalogue from its authorized data source,
not the submitted draft. IDs must be opaque non-sensitive identifiers and revisions
must be immutable: replacing contents under an existing revision violates this
contract. Syntax checks cannot detect a secret deliberately disguised as an ID.
A hash is not proof of approval. Persist the binding with trusted reviewer state
and the existing feature/implementation review.

`prepareScenarioInputs` can perform this check as part of input preparation by
receiving a `ReviewedDataReferenceInput` as its sixth argument (after selection
filters). This keeps legacy callers unchanged; callers preparing selected data
must supply the review context rather than relying on the legacy path:

```typescript
prepareScenarioInputs(
  inputJson,
  validation,
  approval,
  reviewedFixturePolicy,
  { scenarioIds: ["approved-outline/row-a"] },
  {
    selection,
    approvedCatalogue: currentApprovedCatalogue,
    binding: savedBinding,
    approvedEnvironment: {
      id: "synthetic-review",
      revision: "environment-1",
      approvedOrigin: "https://synthetic.example.test",
    },
  },
);
```

In this mode, preparation re-verifies the selection against the current
catalogue and saved binding, requires the reference scenario IDs to exactly
match the runnable selection, and requires each fixture scenario's
`dataReference` (`dataset` ID/revision and `rowId`) to match the reviewed
association. A selected secret, when present, stays a versioned reference and
must match the fixture row's reference; no value is resolved. The supplied
approved environment ID/revision and normalized origin must match the
environment in the input document. Preparation rejects stale bindings, missing
or mismatched rows, and environment mismatches with constant, non-sensitive
errors before it returns a descriptor. The descriptor preserves the verified
binding and safe row references alongside each prepared scenario; this step does
not launch a browser or resolve dataset contents.

The approved catalogue and environment must come from the caller's authority,
not the submitted fixture. No server persistence or portal behavior is
implemented by this Web change.

The synthetic execution review includes both the source and emitted
data-reference validator in its implementation fingerprint. Preparation changes
require refreshing that existing review pin; changes to the validator invalidate
the pin before execution acquires resources.

An authorized resolver remains responsible for mapping selected non-sensitive
row contents into the `prepareScenarioInputs` document and reviewed field policy,
and for annotating each scenario with its matching `dataReference`. Keep
versioned secret associations out of Gherkin and fixture values; pass only
opaque runtime references at the existing account boundary. Secret resolution,
customer credentials, vault provisioning and runtime confidentiality remain
outside this association API itself. Standalone Web callers may continue using the
existing preparation API directly. This does not complete RRDSCRUM-70 or all
RRDWEB-3 runtime ACs.

Owned synthetic coverage is in `features/data-references.feature` and
`scripts/data-references.test.ts`, included in `npm run test:input-preparation`.

### Public package import

Consumers use the explicit versioned export, including its TypeScript declarations:

```typescript
import {
  reviewDataReferences,
  verifyDataReferenceBinding,
  type DataReferenceSelection,
  type ApprovedDataCatalogue,
} from "@universal/playwright-framework/data-references/v1";
```

Do not import internal `dist` paths: the package exports map intentionally limits
public entry points. This entry forwards directly to the reference contract above;
it does not execute scenarios or grant approval. The installed-package regression
checks this import, distinct rows, safe rejection, and stale bindings outside the
checkout alongside the existing owned synthetic adapter pilot.

## One-login runtime handoff (RRDWEB-3 / RRDSCRUM-62 / Web6)

Implementation paths:

- `src/input-preparation/runtime-login.ts`: `InMemoryRuntimeSecretProvider`,
  `validateRuntimeLoginRequest`, and `consumeRuntimeLoginInputs`.
- `src/input-preparation/operator-prompt.ts`: `withOperatorLoginInputs`.
- `src/input-preparation/index.ts`: the existing `RuntimeSecretProvider` and
  `SecretReference`, extended compatibly with revision, account field, scope,
  and optional disposal.

These APIs and their runtime types are exported from the package root. No
ReleaseReady manifest, auth, UI, or startup changes are part of this boundary.
The framework's existing input-preparation test command includes the new canary
tests; no new test runner is introduced.

### Trusted inputs and preflight

The approved caller passes the descriptor returned by reference-aware
`prepareScenarioInputs`, together with a `RuntimeLoginRequest`:

```typescript
interface RuntimeLoginRequest {
  scope: {
    projectId: string;
    runId: string;
    scenarioId: string;
    dataBinding: string;
    environment: {
      id: string;
      revision: string;
      approvedOrigin: string;
    };
  };
  account: { id: string; revision: string };
  expiresAt: number; // Absolute Unix milliseconds; no more than 15 minutes away.
}
```

The descriptor must select exactly one scenario and one reviewed row with a
versioned secret association. Account ID/revision, row association, binding,
scenario, and independently approved environment must match. The scope is bound
when the operator supplies the account and checked on every resolution; another
project, run, environment, scenario, binding, or account revision cannot reuse it.
Missing, empty/whitespace-only, expired, malformed, or mismatched inputs reject
before the browser consumer is called. The provider owns copies, so later
mutation of the submitted request/account cannot change its authority.

Approval, project/run identity, immutable dataset contents, and the reviewed
login implementation remain the caller's authority. These checks do not turn
submitted JSON into approval. The existing legacy preparation path alone is
insufficient for this runtime boundary.

### Operator collection and Web6 consumption

```typescript
import { withOperatorLoginInputs } from "@universal/playwright-framework";

const receipt = await withOperatorLoginInputs(
  preparedDescriptor,
  reviewedRuntimeRequest,
  async ({ username, password }) => {
    // Web6 supplies the reviewed, in-process login consumer here.
    // Acquire a fresh browser context only inside this callback.
    await reviewedLoginConsumer({ username, password });
  },
  { signal: runCancellationSignal },
);
```

The local prompt requires an interactive TTY for both input and output and
disables echo for both account fields. It prints fixed labels only, not entered
characters or masking characters. It rejects pipe/file input, blank input,
oversized input, multiline paste, terminal-control input, interruption, expiry,
or a terminal already in use. Terminal mode and listeners are restored on both
success and failure. There is deliberately no command-line argument,
environment-variable, saved-file, or Git credential fallback.

`withOperatorLoginInputs` constructs the per-run in-memory provider, resolves
the account through the existing `RuntimeSecretProvider.resolve(reference,
scope)` method, checks the review again after asynchronous resolution, and calls
the reviewed consumer only after both values validate. The two references are:

```typescript
{ id: account.id, revision: account.revision, field: "username" }
{ id: account.id, revision: account.revision, field: "password" }
```

For dependency injection, Web6 can call `consumeRuntimeLoginInputs(descriptor,
request, provider, consumer)` directly. The shipped
`InMemoryRuntimeSecretProvider` strictly requires the full scope and versioned
reference on resolution, even though the base interface keeps the scope
parameter optional for compatibility. It automatically releases retained values
at expiry and exposes `dispose()`; the consumer wrapper calls disposal on every
exit, including preflight rejection and consumer failure. Operator collection
also disposes in its outer `finally`. An injected provider must implement
disposal if it retains values.

The receipt says only `status: "completed"`, scope, and account reference. It
means the consumer returned, **not** that the customer's login passed its
assertions. Callback return values are discarded. Provider and browser
exceptions are replaced with fixed, actionable `RuntimeLoginError` codes and
messages without the original exception/cause, because those may include
credential values.

### Confidentiality and integration obligations

- Values remain in memory, only within the operator/provider/consumer path.
  Provider and callback-handle JSON/inspection expose no credential values;
  the callback handle stops resolving fields when the consumer ends. Ordinary jobs,
  `WEB_EXECUTION_PAYLOAD`, command arguments, approval metadata, persisted
  requests/results, logs, and reports carry references only.
- This boundary does not send credentials to an isolated worker. The existing
  synthetic worker and CLI are unchanged. Web6 must consume in-process or
  implement and validate a narrowly scoped transient channel separately; it
  must not add values to ordinary serialized job payloads or environment
  variables.
- The consumer is trusted reviewed code. It must not log, attach, serialize, or
  retain its account argument, enable credential-bearing traces/screenshots,
  or pass values into exception/report metadata. No wrapper can prevent
  arbitrary trusted callback code from deliberately copying a string.
- Web6 owns a fresh non-persistent browser context per run and must close it in
  `finally`, including assertion failure, cancellation, and timeout. No saved
  storage state, session reuse, browser profile, or account leasing is provided.
- Disposal drops retained references and cancels the expiry timer. It is not
  guaranteed JavaScript memory erasure, revocation of a browser's already-used
  credential, or disposal of strings retained by caller code.

`scripts/runtime-login.test.ts` uses synthetic canaries for prompt delivery,
scope/revision/expiry rejection, safe exceptions, disposal, reference-only job
and receipt serialization, and real owned Chromium input delivery with fresh
context isolation. It never navigates to the customer website.

RRDWEB-3 remains **In Progress** until the independently approved environment,
Web8 reviewed login, Web6 execution join, and RRDSCRUM-62 secure handover are
connected and the joined customer confidentiality/isolation evidence passes.
A synthetic canary pass is not that customer acceptance evidence. No customer
credentials or live customer login are included in this change.

The RRDWEB-8 [Partay login-only consumer](./partay-login.md) uses this boundary
with a fresh browser context, exact target/logo/overlay assertions, bounded
execution and cleanup. Its synthetic results do not replace joined customer
acceptance or independently approved runtime inputs.
