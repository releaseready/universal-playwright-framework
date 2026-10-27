# Reviewed feature selection contract

`src/validation/feature-validator.ts` reads only workspace-relative `.feature`
files up to 256 KiB, decodes UTF-8 strictly, and parses standard Gherkin. It
matches Pickle steps against an explicit manifest of Cucumber Expressions; it
never imports or executes step implementations and never contacts a target.
Undefined or multiply matched steps make their scenario not runnable.

Each scenario needs one `@scenario-id=<stable-id>` tag. Scenario Outline example
tables need a unique `case_id` column; the resulting row ID is
`<scenario-id>/<case_id>`. Effective tags include inherited Feature, Rule,
Scenario, and Examples tags. Review approvals record those IDs and tags with
the feature path, caller-supplied source revision, feature content hash, and
step-implementation revision. Any revision mismatch makes the approval stale.
The caller must advance the implementation revision whenever reviewed step
code changes.

The selector returns only runnable approved scenarios that match all requested
IDs and tags. A zero-match result is not runnable. Validation or approval is
not authorization to access a target. Commit only synthetic fixtures and never
place customer scenarios in the public repository or routine logs.

Run the focused checks with `npm run test:validation`.
