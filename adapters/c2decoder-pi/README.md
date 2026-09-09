# C2Decoder compatibility adapter

Current scope: a native domain descriptor and the baseline's READY V3 Artifact
requirement. Core resolution works; calling the native initializer is not implemented.

Phase 4 will resolve the same Task's Artifact before domain execution, pass its
reference into the existing initializer, and leave Handoff, transaction, receipt,
Seed identity, digest, HOLDOUT and tool/path checks with the native Plugin.
Missing dependencies must never launch C2Forge automatically.
