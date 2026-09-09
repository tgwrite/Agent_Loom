# Shared semantic migrations

## Observer failure V2

Task and Session IDs remain in the event envelope. Newly recorded observer
failures carry this payload shape:

```json
{
  "contract_version": 2,
  "plugin_id": "session-audit",
  "phase": "after-run",
  "failure_class": "aspect-execution",
  "failure": {
    "code": "NativeAspectFailed",
    "message": "Native aspect failed during after-run.",
    "source": "session-audit",
    "timestamp": "2026-01-01T00:00:00.000Z"
  }
}
```

The Runtime classifies by the boundary where failure occurred. It does not parse
private native error text. Hook failures are `native-hook`; adapter afterRun
failures are `aspect-execution`; rejected returned publication facts are
`publication-validation`. A rejected governance publication is fatal and can
record `governance-storage` if diagnostic persistence still works. Total storage
failure cannot guarantee a diagnostic on the failed storage medium.

Core validates structured V2 records while preserving V1 reads. Older callers
without phase context produce V2 with `unknown` / `unspecified`. Existing V1 rows
are not rewritten, and their message text is not used to fabricate phase facts.

The native matrix exercises the first three classes in all applications. Storage
failure is covered by shared Core/Runtime tests, not by three physical disk-fault
experiments. The control's inline contract covers the common native matrix; its
entire validation and persistence coverage is not asserted equivalent to Loom.

## Native artifact provenance V2

New Pi Application Host publications add:

```json
{
  "producer_phase": "aspect-after-run",
  "native_runtime_session_id": "native-session-example"
}
```

The Host owns the phase and obtains the native ID from the bound producer Session.
Adapters still return only contract, path and verification facts. Core rejects
half-present provenance, a wrong native Session ID or a phase incompatible with
the producer role. Resolved ArtifactRefs preserve both fields for consumers.

Legacy records with neither field remain readable. The low-level store API still
accepts the legacy shape for compatibility. Reading or inspecting old artifacts
does not backfill provenance. This is an additive native Host contract, not a claim
that all historical records or all low-level callers have been upgraded.

## Ownership and cost

Each arm has one cross-Application implementation per semantic rule. Loom's single
owner spans contracts, storage, validation, Runtime integration and inspect output;
each file remains part of the review surface. The shared control keeps its narrower
implementation in one file. No application-specific semantic patch is required.

Historical checkpoints record the sequential experiment. The final `--phase=verify`
mode checks current behavior without claiming those checkpoints. Read-only legacy
compatibility can be checked against retained local evidence with:

```sh
node test/cross-application/check-history.mjs a m1
```

This command compares the new inspect result to the old saved inspection and checks
unchanged governance-file hashes. It creates no new business Session.
