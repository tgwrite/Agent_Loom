# Reference baseline

Status: **pending real compatibility verification**.

The design proposes Pi **0.85.1**. This is a target, not a verified support claim.
No private Plugin repository, revision, local checkout, or real case is distributed
with this public project.

| Reference integration | Required evidence | Status |
| --- | --- | --- |
| C2Forge + Postmortem | Startup, lifecycle, tools, sidecar coexistence on target Pi | Pending |
| C2Decoder + Postmortem | Startup, READY initialization, guards, sidecar coexistence | Pending |
| Cross-Session Handoff | Existing publication and initializer contracts | Pending |

## Freeze procedure

1. An integration operator supplies existing native Plugin installations locally.
2. Record the exact Pi version, three immutable Plugin revisions, and case identity
   in an ignored `local/reference-baseline.local.json` file or external private record.
3. Run each coexistence smoke test and identify only necessary compatibility fixes.
4. Publish an anonymized result summary and an opaque validation label. Keep source
   locations, private revisions, case identifiers, raw logs, and local paths private.
5. Update this document and the acceptance matrix only with evidence actually observed.

The public fixture-based tests do not satisfy this freeze. Private revisions remain
private even when the result summary is public. A future public Plugin source may be
linked only after its public status and disclosure authorization have been verified.
