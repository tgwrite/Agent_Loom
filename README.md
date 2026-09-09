# Agent Loom

> **Work in progress / 开发中**
>
> 本项目尚未开发完成，v0.1 完整闭环尚未通过验收。当前仅提供项目骨架与部分 Core 基础能力。
>
> This project is still under development. The complete v0.1 flow has not passed
> acceptance. The current implementation provides a scaffold and partial Core functionality.

Agent Loom organizes existing Agent Plugins into an Application and connects their
Sessions through a shared Task, Artifact registry, and Event history.

The v0.1 reference flow is a C2Forge Session producing a Handoff, followed by a
C2Decoder Session consuming that Artifact within the same Task. Postmortem is a
cross-cutting observer in both Sessions. Plugin implementations retain ownership of
domain verification, tools, guards, and reflection.

**Status: Core governance and an initial CLI are implemented.** Real Plugin
compatibility and the complete v0.1 loop are pending. The Pi 0.85.1 reference target
comes from the design baseline and has not been validated by this repository.

## Quick start

Use Node.js 24.12 or newer and npm:

```sh
npm ci
npm run check
npm run demo
npm run loom -- --help
```

The demo uses synthetic data, creates two Session records, publishes an Artifact
reference, reopens the Task store, and records a simulated successful consumption.
It prints a neutral summary and removes its temporary files. No Plugins, model keys,
private repositories, or Pi installation are required.

`npm run check` builds JavaScript and declarations for the CLI and checks types
separately. Local Application files may use Node's native TypeScript support; see
the [Node.js documentation](https://nodejs.org/api/typescript.html).
After `npm run build`, `npm link` optionally exposes the `loom` command locally.
No package has been published to a registry.

## CLI development preview

```sh
npm run loom -- app validate ./examples/c2-analysis-application/agent-loom.app.ts --definition-only
npm run loom -- task create --app ./examples/c2-analysis-application/agent-loom.app.ts --root ./local/example-task --name example-task
npm run loom -- task inspect example-task
npm run loom -- session start --task example-task --profile c2forge --dry-run
```

Application validation without `--definition-only` and Session startup without
`--dry-run` or a local Host currently fail with `NativeIntegrationNotReady`.
`--definition-only` and `--dry-run` exercise validation and dependency planning only.
A missing READY Handoff fails with `PreconditionNotSatisfied` before consumer execution.

Integrators can supply `--host-module ./local/native-host.mjs` for Session startup.
This trusted local module exports `createSessionHost({ store })` and returns a
Core `SessionHost`. The `agent-loom/runtime-pi` export provides `createPiSessionHost`
for an injected Pi SDK, explicit Plugin entries, a native initializer, and an
execution driver. The initializer runs before Pi loads workspace instructions;
successful initialization precedes Artifact consumption. Native Session IDs and
terminal status are persisted. Host modules execute local code and belong outside
version control when they contain private integration configuration.

The same module can export `validateNativeApplication({ application })` for
`app validate --host-module ./local/native-host.mjs`. This preflight should verify
the local SDK and all Profile bindings without executing a domain task. Its output
is explicitly `host-preflight-passed`; it is not an E2E acceptance result.

Built-in domain initialization and Artifact publication adapters remain unfinished.
Supplying a Host does not establish Plugin compatibility or complete v0.1 acceptance.

Task creation stores an Application snapshot. Later commands find the Task through a
local index, independent of the current working directory or original definition file.
Set `LOOM_STATE_DIR` to choose the index directory, or supply `--root` when inspecting
or starting an existing Task. Task names must be unique within an index.

`task inspect`, `session inspect <id> --task <task-id>`, and
`artifact inspect <id> --task <task-id>` accept `--json`. They expose production and
successful consumption, Session workspaces, failures, Events, and per-Plugin Artifact
counts. Artifact inspection resolves the original file location locally. Such output
is local runtime data and must be reviewed before sharing publicly.

## Repository layout

```text
packages/container-core/       Runtime-independent contracts and local governance
packages/runtime-pi/           Pi Session lifecycle bridge with injected native bindings
packages/cli/                  Application validation, Task lookup and inspection
adapters/                     Thin reference Plugin descriptors
examples/c2-analysis-application/
tests/                        Synthetic behavior and boundary checks
test/lightweight/             Optional native Pi Plugin closure and test Handoff protocol
scripts/                      Test runner and publication checks
```

## Design boundaries

- A Task spans Sessions; a Session has at most one primary domain Plugin.
- Artifacts are Task-scoped references with provenance and verification metadata.
- Missing dependencies fail explicitly; resolving a dependency never starts a Plugin.
- Plugins verify domain truth. The Container records their verification metadata.
- Governance records and Plugin private state do not implicitly enter Agent Context.
- Storage uses `.agent-loom/` JSON and JSONL files, without a database.
- Tasks keep Application snapshots; Sessions have separate Task-relative workspaces.
- A successful consumer initialization records the exact Artifact and accepted digest.
  Lookup alone never records consumption. Core trusts the consumer's report of acceptance.
- v0.1 targets Pi only while keeping Core contracts independent of Pi.

The current store assumes one writer per Task and trusted local filesystem ownership.
Crash recovery and complete sidecar verification remain pending. The Pi bridge
loads explicit Profile entries and exposes lifecycle observations to the local Host.
Callers must serialize mutations; multi-file transactions and recovery are not yet
supported. Pi session files use `.agent-loom/native-sessions/`, separate from Core records.

The current Task schema is version 2. Legacy `.agent-container/` data is detected and
rejected explicitly; automatic migration is not implemented. No existing Task or
domain data is overwritten. Public bridge tests use an injected synthetic SDK;
native domain initialization and publication still require local integration.

## Iterating toward v0.1

The optional [lightweight native acceptance](test/lightweight/README.md) exercises
two Pi Sessions with public HTTP, report-export and telemetry Plugins. Packages
are test-local and loaded explicitly at startup. Its default mode scripts model
decisions while running real native tools; a separate model mode accepts a live
URL and the existing Pi default model. It complements the original reference
Application and does not establish its domain acceptance.

The next steps are native Artifact publication and initialization, full compatibility
verification, observer isolation, and a complete real E2E run. Synthetic Core coverage and real Plugin
acceptance remain separate. Local planning directories `doc/` and `docs/` are excluded
from version control.

## Public development

This repository contains public code and synthetic examples only. Private Plugin
sources, local checkout paths, identities, organizations, real case data, and runtime
outputs must never be published. See [AGENTS.md](AGENTS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [Apache License 2.0](LICENSE).

中文：项目接管 Plugin 组合、跨 Session 产物关联与任务记录，让 Plugin 专注领域能力。
当前交付是可运行的 Core 基础和项目骨架，后续按阶段验证真实 Pi 与三个 Plugin 的闭环。
