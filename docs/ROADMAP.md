# v0.1 roadmap

The current milestone is the initial public scaffold and local Core foundation.
Phase 1 foundation work can be exercised independently; real integration remains
gated by Phase 0. No phase is marked accepted by directory creation alone.

| Phase | Deliverable | Current state | Exit evidence |
| --- | --- | --- | --- |
| 0 | Reference baseline freeze | Pending | Real Pi coexistence smoke tests; privately frozen revisions and case |
| 1 | Container Core skeleton | Foundation implemented | Contracts, persistence, provenance and dependency tests; integration review pending |
| 2 | Pi Runtime Bridge | Boundary scaffold only | Actual Session mapping, event recording, shutdown and failure settlement |
| 3 | C2Forge Artifact adapter | Descriptor only | Discover existing READY publication and register original reference |
| 4 | C2Decoder resolver | Core resolver tested; initializer pending | Resolve Task Artifact before domain execution; preserve domain validation |
| 5 | Session Profile composition | Static validation tested; loading pending | Select Profile and load native Plugins with Bridge automatically |
| 6 | Postmortem governance | Pending | Real sidecar isolation, observer failure containment, unchanged guards |
| 7 | Complete E2E | Pending | Real producer Session exit, consumer Session, checkpoints and Task query evidence |

## Next iteration

Establish an operator-supplied Phase 0 integration harness with sanitized public
results. Verify actual Pi APIs and the existing publication/initializer contracts
before implementing the Pi Bridge or domain adapters. Keep default public CI fully
synthetic and independent of those local integrations.

## Success measure

A user selects a Task and Session Profile, performs domain work, and can query the
resulting Session lineage, Artifact provenance, and Events without manually passing
Handoff paths or rebuilding Plugin combinations.
