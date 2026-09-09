# v0.1 acceptance evidence

No real Plugin acceptance criterion is declared complete in the initial scaffold.
Passing public tests establishes only the synthetic Core behavior described below.

| Criterion | Current evidence | Remaining real evidence |
| --- | --- | --- |
| AC-01 Plugin independence | No domain implementations imported or changed | Compare native Plugin revisions and any compatibility-only changes |
| AC-02 Cross-Session Artifact | Reopened local store resolves synthetic original reference | Actual C2Forge publication consumed by new C2Decoder Session |
| AC-03 Preconditions | Missing/non-READY/ambiguous matches fail explicitly in Core tests | Actual consumer startup gate and unchanged domain validation |
| AC-04 Provenance | Store checks producer Session, Plugin, Actor and Runtime | Provenance mapped from actual native execution |
| AC-05 Observer isolation | Core has no implicit model or context calls | Real Postmortem sidecar and failure-containment tests |
| AC-06 Domain guards | No domain guard code modified | HOLDOUT, tool guard, path policy and trust regressions |
| AC-07 Profile composition | Static Profile validation and descriptors | Actual automatic native Plugin loading plus Container Bridge |
| AC-08 Governance persistence | Task, Sessions, Artifacts and Events survive reopening | Actual Pi lifecycle drives complete persisted records |

For each future result, record the check, sanitized outcome, public test reference
when available, and the scope it does and does not demonstrate. Keep real cases,
private revision pins, local filesystem paths, and raw execution output private.
