# Agent Loom

Agent Loom organizes existing Agent Plugins into an Application and connects their
Sessions through a shared Task, Artifact registry, and Event history.

The v0.1 reference flow is a C2Forge Session producing a Handoff, followed by a
C2Decoder Session consuming that Artifact within the same Task. Postmortem is a
cross-cutting observer in both Sessions. Plugin implementations retain ownership of
domain verification, tools, guards, and reflection.

**Status: initial scaffold with a tested local Core foundation.** Real Plugin
compatibility and the complete v0.1 loop are pending. The Pi 0.85.1 reference target
comes from the design baseline and has not been validated by this repository.

## Quick start

Use Node.js 24.12 or newer and npm:

```sh
npm ci
npm run check
npm run demo
```

The demo uses synthetic data, creates two Session records, publishes an Artifact
reference, reopens the Task store, and resolves that reference for the second Session.
It prints a neutral summary and removes its temporary files. No Plugins, model keys,
private repositories, or Pi installation are required.

TypeScript runs through Node's native type stripping; `npm run typecheck` checks types
separately. See the [Node.js documentation](https://nodejs.org/api/typescript.html).
Packages are workspace-only and are not yet published to a package registry.

## Repository layout

```text
packages/container-core/       Runtime-independent contracts and local governance
packages/runtime-pi/           Pi integration boundary; implementation pending
adapters/                     Thin reference Plugin descriptors
examples/c2-analysis-application/
tests/                        Synthetic behavior and boundary checks
docs/                         Architecture, baseline, roadmap, acceptance evidence
doc/                          Original v0.1 implementation baseline
scripts/                      Test runner and publication checks
```

## Design boundaries

- A Task spans Sessions; a Session has at most one primary domain Plugin.
- Artifacts are Task-scoped references with provenance and verification metadata.
- Missing dependencies fail explicitly; resolving a dependency never starts a Plugin.
- Plugins verify domain truth. The Container records their verification metadata.
- Governance records and Plugin private state do not implicitly enter Agent Context.
- Storage uses `.agent-container/` JSON and JSONL files, without a database.
- v0.1 targets Pi only while keeping Core contracts independent of Pi.

The current store assumes one writer per Task and trusted local filesystem ownership.
Crash recovery, Pi event mapping, actual Plugin loading, and sidecar behavior are not
implemented. Read the [architecture](docs/ARCHITECTURE.md) for the concrete limits.

## Iterating toward v0.1

Start with the [implementation baseline](doc/Agent%20Plugin%20Application%20Container%20v0.1%20实施基线.md),
then use the [roadmap](docs/ROADMAP.md), [reference baseline](docs/REFERENCE_BASELINE.md),
and [acceptance matrix](docs/ACCEPTANCE.md). Synthetic Core coverage and real Plugin
acceptance are tracked separately.

## Public development

This repository contains public code and synthetic examples only. Private Plugin
sources, local checkout paths, identities, organizations, real case data, and runtime
outputs must never be published. See [AGENTS.md](AGENTS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [Apache License 2.0](LICENSE).

中文：项目接管 Plugin 组合、跨 Session 产物关联与任务记录，让 Plugin 专注领域能力。
当前交付是可运行的 Core 基础和项目骨架，后续按阶段验证真实 Pi 与三个 Plugin 的闭环。
