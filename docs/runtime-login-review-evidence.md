# Runtime-login public-entry review record

Base: `e5ab4941cc9c9100ba86ca770f897955f7cf01d6`, verified by both GitHub and git.
This branch contains no held PR46 changes. Its only change to
`src/execution/reviewed-scenarios.ts` is the expected implementation digest.

## Fingerprint maintenance

The previous expected digest was
`8e0733112e631ecfdcdd46a21361edc8d7c36b0d14da5c69187595f36c7e4627`.
A pristine baseline build reproduced it and passed reviewed scenario admission.

The first aggregate with the intentional package export change correctly stopped
in execution tests with `Pinned synthetic scenario review is stale`; 17 execution
tests failed with incomplete admission outcomes. The earlier input, login,
validation and existing feature stages passed. Remaining aggregate stages were not
run by that failed command. This failure is retained as evidence, not reclassified
as a baseline issue. At that intermediate manifest the computed digest was
`cf0ed7012419021f019d39bd7cdcd7d758a319b84272476e1d79f77920f0ae70`.

The repository procedure in `docs/local-adapter-contract.md` requires reviewing an
intentional source/config/dependency change, then explicitly updating the committed
pin and both JSON examples. It does not require an additional human attestation.
Independent source review confirmed the narrow API change; its cold-import deadline
finding was corrected and re-reviewed. The coordinator explicitly clarified that
reviewed expected-fingerprint maintenance is authorized, while bypasses are not.

After completing the additive export, test command and packaged guide, the normal
`npm run review:revision` produced:
`48a7d4d8ad7226a2642f566fea1aa7d6193626bd346d1343b0a3e9bffccf6296`.
That exact candidate replaces the old digest in the committed pin and two adapter
JSON examples. Historical acceptance evidence keeps its original digest. Hash input
selection, normalization, dependency checks, admission logic and tamper checks are
unchanged; no placeholder or runtime self-approval is introduced.

## Test history and limits

Five cold-process probes passed before fingerprint maintenance: pending-provider
IPC/cancellation with zero browser imports; input/terminal/pre-cancellation guards;
controlled cold-import expiry preventing browser launch; root identity compatibility;
and real owned loopback browser consumption with confirmed closure. An initial test
incorrectly expected `fromUnknown` to return the same exception instance; it was
corrected to test preserved class identity and normalized report equivalence, since
that existing sanitizer intentionally returns a fresh instance.

The cold-import deadline regression was added after independent review: module
loading can block timer delivery, so wall-clock expiry is checked before launch and
only remaining work time is passed to the launcher. No work or cleanup deadline was
increased. Authentication-only tests passed (35), and source-policy tests passed (4).
Full lint retains 33 pre-existing diagnostics identical to pristine baseline;
changed-source lint passed. Final aggregate, installed artifact, provenance and
remote check results are recorded in the PR after execution.

This work addresses import initialization only. It does not fix context.close
reliability, implement PR46 cleanup diagnostics, or measure the separate opt-in
Dev Cognito pilot's installedLoginBrowser()/playwright-core startup cost. Historical
overlapping timing samples must not be summed or treated as complete causality.

Initial packed checks also exposed two harness/environment issues: npm's default
cache path was unavailable in this cloud sandbox (rerun with the writable workspace
cache), and the nested node:test process inherited its parent's reporter context,
producing no captured summary. The installed runner now clears only NODE_TEST_CONTEXT
and explicitly selects TAP; it still requires all five probes and their passing
summary. Neither issue changed production behavior or relaxed test assertions.

Sonar initially rejected head `16ab407` for 10.2% new-code duplication. The duplicate
root/runtime export lists and copied fixture were consolidated: the root re-exports
the narrow entry (never the reverse), and the existing Partay suite reuses the same
synthetic descriptor factory. No exclusions or quality thresholds were changed.
An intermediate harness edit also failed typecheck before its missing local variable
was corrected; final build and package checks were rerun afterward.
