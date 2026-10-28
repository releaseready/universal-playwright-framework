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
and the existing feature/implementation review. Before binding or execution call
`verifyDataReferenceBinding(candidate, currentApprovedCatalogue, savedBinding)`;
reject stale/removed selections and invalidate the earlier review in central state.
Also require the scenario IDs to exactly match the approved expanded selection.
No server persistence or portal behavior is implemented by this Web change.

After that check, an authorized resolver can map the selected non-sensitive rows
into the existing `prepareScenarioInputs` document and reviewed field policy.
Keep versioned secret associations out of Gherkin and fixture values; pass only
opaque runtime references at the existing account boundary. Secret revision lookup,
customer credentials, vault provisioning and runtime confidentiality remain outside
this association API. Standalone Web callers may continue using the existing
preparation API directly. This does not complete RRDSCRUM-70 or all RRDWEB-3 runtime ACs.

Owned synthetic coverage is in `features/data-references.feature` and
`scripts/data-references.test.ts`, included in `npm run test:input-preparation`.
