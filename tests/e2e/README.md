# Real v0.1 E2E: pending

The public demo and unit tests cover synthetic Core governance only.

`tests/cli/commands.test.ts` additionally exercises separate synthetic producer and
consumer processes and queries their persisted lineage through the compiled CLI.
This establishes process-independent governance, not real Plugin compatibility.

This suite will eventually verify the complete real Pi flow: Task creation, native
C2Forge execution, existing Handoff publication, Artifact registration, producer
Session exit, native C2Decoder initialization in a new Session, Postmortem checkpoints
and report, and Task provenance queries. Private sources and cases remain local.

Do not add a passing placeholder or count a skipped integration test as acceptance.
