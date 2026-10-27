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
input preparation does not accept or invoke a provider. Prepared account access
contains only account and secret reference identifiers. Runtime provider
execution and confidentiality integration for CLI arguments, logs, and results
remain execution-scope obligations; this slice does not establish those runtime
guarantees or provision credentials.

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
