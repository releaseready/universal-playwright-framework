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
one fixture field. Fixture field names that indicate credentials or secrets are
rejected. Errors describe the invalid category
without echoing input values. The initial target check is parsing only: caller
approval is a trusted boundary, not authorization or a browser assertion. This
slice does not navigate, make network requests, or enforce redirects.

`RuntimeSecretProvider` describes the injected runtime consumption boundary;
input preparation never calls it and secret values are not part of a prepared
descriptor. Tests use synthetic values only. This interface does not provision
or store credentials or connect to a secret manager.

Each selected scenario must provide an explicitly authorized cleanup reference
and its authorization revision. Preparation hands off `required: true` and
`outcome: "unknown"`; runtime evidence is required before reporting a restored
or unrestored outcome. No reset action is executed here. Browser-context/session
isolation and cleanup execution remain later runtime work.

Run the focused checks with `npm run test:input-preparation`; the local
`npm run test:features:regression` aggregate includes them.
