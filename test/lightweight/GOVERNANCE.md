# Governance value experiment

This experiment asks who owns cross-session governance. Generating an HTML report
alone does not establish Loom's value. The test does not claim that reports require
Loom or that a container improves model speed.

## Run

```sh
npm ci --prefix test/lightweight --ignore-scripts --no-audit --no-fund
npm run build
npm run test:governance
```

Optionally add `-- --live-url '<page-url>'` to the last command for a final run
using the current Pi default model. The deterministic matrix always uses a local
synthetic fixture, scripted model decisions and real native tools. The live run
uses normal model requests and may incur their usual cost. It is a headless SDK
run through the CLI, not a manual interactive Pi acceptance session.

Dependencies are test-local and loaded explicitly at startup. No global Plugin
installation or default configuration change is made. The artifact Plugin retains
its native artifact-directory behavior; sandbox execution may need permission to
write that directory. Selected global configuration fingerprints are checked.

## Product entry

The public Application exports a relative native Host binding. After preparing a
Task's `web-input.local.json`, ordinary commands can be run in separate processes:

```sh
node bin/loom.mjs app validate test/lightweight/application.mjs
node bin/loom.mjs task create --app test/lightweight/application.mjs --root .test-tmp/web-task --name web-task
node bin/loom.mjs session start --task web-task --profile fetch
node bin/loom.mjs session start --task web-task --profile report
node bin/loom.mjs task inspect web-task --json
```

Before the first Session, put a JSON object with `mode` (`scripted` or `model`) and
`url` in the Task's `web-input.local.json`. Model mode also needs `auth_source`, a
local Pi configuration directory. Use the same `LOOM_STATE_DIR` for these commands,
or supply an explicit Task `--root` to bypass a missing index. Input configuration
is application-specific; it is not an Artifact or a replacement Task registry.

`application.mjs` and `alternate.application.mjs` share adapters but use different
application/profile names and workspaces. Native preflight checks the installed
SDK version and binding files; actual load compatibility is checked at Session
startup. It is not domain acceptance. No handoff path is passed to a consumer.

## Responsibilities

| Component | Owns |
| --- | --- |
| Loom CLI | Capturing the local Host binding once; Task lookup and public commands |
| Loom Core | Profile resolution, Task-scoped dependencies, initialization/consumption ordering, state and lineage |
| Pi application Host | Binding selection, lifecycle observations and publication provenance |
| `web-adapters.mjs`, `handoff.mjs` | Native output parsing, byte verification, staging and export recognition |
| `native-runtime.mjs` | Shared native SDK/model setup; counted equally in both arms |
| `governance.mjs` | CLI driver, controlled faults and assertions; no direct Loom store access |
| `control.mjs` | No-Loom comparison's custom composition, resolver, session state, consumption, publication and inspection |

The original `worker.mjs` is now a small compatibility entry using the same Host
and adapters; its old integration command remains available. The test-owned
[Handoff protocol](HANDOFF.md) has not moved into Core.

## Scenarios and evidence

Each arm executes nine scenarios:

1. Producer exits completely; a fresh consumer process resolves its input.
2. A second Task uses another page without changing adapter code.
3. Another Application reuses the same adapters with different Profile names.
4. An injected observer callback error is recorded while the domain succeeds.
5. Missing input rejects startup before a consumer Session exists.
6. Other Tasks' inputs do not satisfy an empty Task's requirement.
7. Two genuine producer runs cause explicit ambiguity, with no automatic selection.
8. Altering a snapshot causes initialization failure and zero consumption.
9. Native export failure leaves a failed Session and no successful report, while
   retaining the consumption that genuinely happened before execution.

For successful runs, inspect output must expose two distinct native Sessions, two
Artifacts, one consumption and correct lineage. Report bytes are checked against
the indexed digest and original native export digest. Native telemetry must contain
two completed runs. Missing-input checks do not execute an upstream Profile.

Each command runs in a fresh process from an unrelated directory. Fault injection
modifies only the domain fixture or scripted model decision, never Loom registry
files. The failing export is a real native call with a nonexistent artifact ID.
The observer test covers an injected callback exception, not every telemetry fault.

Ignored `.test-tmp/governance/run-*` output retains command arguments, exit codes,
stdout/stderr, inspect snapshots, native events, reports and result assertions.
Raw real URLs, local paths, model configuration and website content stay local.
Command timing is diagnostic; the matrix is not a paired performance benchmark.

## Fair comparison and interpretation

The no-Loom control imports the same domain adapters, native model setup, Plugin
packages and Application definitions. It imports no Loom implementation. It is
allowed to automate its work: a custom script can provide all tested guarantees
with zero per-task code edits and zero manual handoff-path transfers too.

Its code is an experimental implementation of those guarantees, not a supported
alternative runtime or a claim of parity with all Core validation and persistence
behavior. Both arms assume serialized operations. Crash recovery is untested.

The relevant difference is ownership of reusable governance. Count the control's
custom resolver, composition, lifecycle, consumption and indexing responsibilities,
and disclose Loom's adapter and initial binding cost. Moving code between files is
not a saving. Line counts are supplemental evidence, not measured developer time.

Passing these scenarios establishes the checked mechanisms and CLI reuse. It does
not prove lower per-task effort than a competent automated control, improved model
latency, normal interactive Pi experience, a usable ambiguity-resolution flow or
complete v0.1 product value. Report those gaps explicitly.

## Observed local result

The completed local experiment passed all 18 deterministic arm/scenario pairs and
one additional default-model live-page run through the Loom CLI. Both arms reused
their code across Tasks and Applications with zero handoff-path transfers and zero
per-task governance code edits. Selected global Pi configuration fingerprints and
shared adapter source hashes were unchanged. These are local native results, not
claims that the optional native suite runs in public CI.

The control implements its tested governance in 127 lines including comments and
blank lines, in addition to shared adapters and SDK setup. It successfully
automates the checked behavior. This is evidence of a concrete responsibility
that Loom can own; it is not evidence of 127 lines of net savings, measured
developer-hours saved or fewer daily steps. The complete product-value acceptance
remains open, particularly interactive usage and resolving an ambiguous binding.
