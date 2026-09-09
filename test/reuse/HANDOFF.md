# Native session audit contract

Contract: `audit.session-summary@1`

Producer Plugin: `session-audit`

Native verification: `COMPLETED`

## Native boundary

The standalone Pi extension registers a `session-audit` command. Its JSON argument
contains an opaque request ID and `outcome` (`completed` or `failed`). A test-only
`fail` flag injects a native command failure. The extension reads only Pi's current
branch through `ctx.sessionManager`, then writes a fresh JSON file in its own
workspace-relative `.pi-session-audit` directory.

The file has schema `pi-session-audit-v1`, the native Session ID, request ID,
caller-reported outcome, timestamp and structural user/assistant/tool-result/error
counts. It contains no Loom Task, SessionRun, Actor or Runtime IDs, Artifact contract,
Artifact hash or governing Session status. It does not read Loom records.

The native Session ID is Pi's identity, not the Loom SessionRun ID. Reporting an
outcome of `failed` is valid audit output; it does not mean the audit itself failed.

## Compatibility boundary

The adapter runs through the already-existing `afterRun(session, context, outcome)`
interface. It supplies command input, reads the expected native file and verifies
schema, request ID, native Session identity and reported outcome. It returns only:

```json
{
  "type": "audit.session-summary",
  "version": "1",
  "verification_status": "COMPLETED",
  "path": "workspace/.pi-session-audit/request.json"
}
```

The path is illustrative; native request filenames are unique per invocation.
The adapter does not decide producer/Actor/Runtime identity, compute SHA, write
governance failures or settle a Session. Existing Host and Core do that work.

## Acceptance

A native audit failure leaves no successful audit Artifact. Invalid file paths,
undeclared contracts and nonexistent files are rejected by the frozen Host and
recorded as failures of `session-audit`. Other aspects can still run.

On successful native audit, inspect must expose the current Task/Session producer,
actual Actor/Runtime, matching file SHA and Plugin artifact count. During domain
execution failure, the audit may still publish while the domain Session remains
failed. There is no new business dependency on this audit contract and no new
per-task CLI parameter.
