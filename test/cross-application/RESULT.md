# Cross-Application result

The experiment completed on Windows with Node 26.8.1 and Pi 0.85.1. The onboarding
baseline is `366d110`; observer migration M1 is preserved as `55c066e`.

## Formal matrix

| Phase | Loom | Shared control | Business Sessions | Artifacts | Local review HTTP requests | Driver commands |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A: frozen onboarding | 3/3 | 3/3 | 12 | 48 | 36 | 24 |
| M1: observer failure V2 | 15/15 | 15/15 | 60 | 210 | 180 | 132 |
| M2: native provenance V2 | 15/15 | 15/15 | 60 | 210 | 180 | 135 |
| Total | 33/33 | 33/33 | 132 | 468 | 396 | 291 |

These are 66 formal Tasks. The final checkpoint-independent verification smoke
also passed three Loom Tasks / six business Sessions. Two earlier onboarding
debugging runs are excluded from formal success counts. They exposed normal
Markdown escaping and missing native theme initialization; the assertions/setup
were corrected before recording the frozen onboarding checkpoint.

All model responses were deterministic fixtures. Real Pi, market plugins, native
tools, HTTP, Pandoc, files and review subprocesses ran; actual LLM inference and
commercial model requests were zero. Local review HTTP calls are not LLM calls.

## What passed

Application A retains the existing two-Session web composition. B uses a market
JSON query plugin in one Session with no handoff. C uses three different market
plugins for source capture, section editing and HTML publication across three
Sessions and two handoffs. All share the existing three aspects.

Phase A changed no Core, Runtime, CLI or previous integration code. M1 and M2
changed no application definitions, domain code, adapters or native startup
bindings. Native package fingerprints and the checked global Pi configuration
fingerprints stayed unchanged. No global plugin installation was performed.

Each migration tested normal execution, native-hook failure, afterRun failure,
invalid aspect publication and domain failure followed by afterRun. New observer
events consistently carry phase and failure class. New native artifacts carry
producer phase and bound native Session ID, including artifacts generated after
domain failure. Successful audit output does not turn a failed domain into success.

Storage-failure classification has a separate shared primitive test: when artifact
storage fails but diagnostic storage survives, the event is retained and the
Session fails. This was not a physical disk-fault test in all three applications.
Complete diagnostic storage failure cannot promise a persisted diagnostic.

The new code read six historical Tasks after M1 and 36 after M2, preserving both
inspection results and governance-file hashes. V1 event/Artifact compatibility is
also covered by shared tests. Reads never backfill invented provenance.

## Ownership and review ledger

| Metric | Loom | Shared control |
| --- | --- | --- |
| Observer semantic implementations across A/B/C | 1 | 1 |
| Provenance semantic implementations across A/B/C | 1 | 1 |
| Independent logical migration patch groups | 2 | 2 |
| Application-specific semantic patches | 0 | 0 |
| Business adapter changes during migration | 0 | 0 |
| Production implementation/contract/projection files per migration | 5 | 1 |
| Shared production M1 diff | +52 / -12; net +40 | +9 / -5; net +4 |
| Shared production M2 diff | +38 / -8; net +30 | +2 / -0; net +2 |

One semantic implementation is not one review location. Each Loom migration
touches a contract file, Runtime and store implementations, schema/compatibility
validation and the CLI projection. It also changes two shared test files. Across
both migrations, six distinct production files changed. The control keeps its
narrower implementation in one shared file: 144 to 148 to 150 lines.

Logical patch groups count independent semantic migrations, not editing-tool
invocations. Both Loom patches needed a TypeScript narrowing correction during
implementation; those revisions are work, not extra application owners. No human
review minutes were measured, and automated review is not described as human review.

Regression scope is separated as follows:

- Shared primitive tests: each migration adds two tests and strengthens two
  existing tests. The full suite grows from 53 to 55 to 57, all passing.
- Application compatibility: each migration runs three applications and five
  scenarios per arm, using the same domain adapters and assertion driver.
- Application-specific governance tests: no independent per-application semantic
  implementation or dedicated semantic assertions are introduced. All three
  native integration topologies still require regression execution.
- Historical compatibility: six read-only inspections after M1 and 36 after M2,
  plus the shared legacy-record tests. These create no business Sessions.

The domain adapters, legacy JSON entry, application definitions, host/setup,
scripted model, driver, freeze/history checks, dependencies and documents are
additional onboarding and experimental costs. They are not included in the
shared-governance diff or treated as free.

## Interpretation

Loom demonstrated one shared implementation supporting two semantic upgrades
across three different application topologies without business changes. The
reasonable control also had one shared implementation from the start and required
no application-specific patches. Thus the experiment did not observe a relative
advantage in semantic-owner or independent-patch counts, nor an evolution from
three control owners to one.

The control does not implement all of Loom's typed contracts, persisted-record
validation, write queue and storage-error regression coverage. Its smaller diff
does not rank two fully equivalent production frameworks. Conversely, Loom's
broader checks do not by themselves establish lower total ownership cost.

The seven planned gates are satisfied within their stated scopes: onboarding
freeze, one shared Loom owner per semantic, unchanged definitions, unchanged
adapters, consistent new schemas, fair shared control and an explicit economic
ledger. The ledger is evidence collection, not a positive economic verdict.

Actual LLM quality, long-term maintenance/review time, security sandboxing,
performance, other runtimes and complete v0.1 acceptance remain unproven. A useful
next comparison would pre-align production guarantees and measure missed-change
propagation and regression maintenance, rather than adding more similar plugins.

See [README.md](README.md), [HANDOFF.md](HANDOFF.md) and
[MIGRATIONS.md](MIGRATIONS.md) for reproduction, native contracts and compatibility.
