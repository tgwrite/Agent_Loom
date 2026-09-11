# Agent Loom — Plugin tools and artifact handoffs for AI agents

**TypeScript CLI and SDK for discovering plugin capabilities, reusing artifacts
across sessions, and inspecting provenance and failures.**

**开发预览 / Alpha:** This is an installable development preview; complete v0.1 and
independent Agent acceptance remain pending. No npm registry release is available.

Canonical source: https://github.com/tgwrite/Agent_Loom

Download the archive, SHA256SUMS and installation instructions from
[GitHub Releases](https://github.com/tgwrite/Agent_Loom/releases).

This precompiled package provides the `loom` CLI, Core SDK and Pi Runtime bridge.
It requires Node.js >=24.12.0 and npm. Source checkout, TypeScript compilation and
development dependencies are not required to use the package.

See [INSTALL.md](INSTALL.md) for installation, SDK imports and a synthetic
producer/consumer example. The package does not install Pi or business plugins,
configure model credentials, or include a ready-to-run real webpage application.
Applications supply explicit native bindings and domain verification. Plugins load
at Session startup, according to the selected Application/Profile.

Task data belongs in your own workspace. No workflow scheduling, automatic retry
or schema migration is provided. CLI/SDK installation checks and real Pi task
acceptance are separate. This alpha pre-release is offered for installation and
integration testing. Real-task and independent Agent acceptance remain pending;
it is not a stable release.

License: Apache-2.0. See LICENSE and NOTICE.

| Agent operation | CLI | SDK |
| --- | --- | --- |
| Discover capabilities | `loom agent discover` | `loom.discover()` |
| Read an entry contract | `loom agent describe` | `loom.describe()` |
| Check required inputs | `loom agent check` | `loom.check()` |
| Invoke a selected entry | `loom agent invoke` | `loom.invoke()` |
| Inspect outcomes and lineage | `loom agent inspect` | `loom.inspect()` |

The Agent chooses the action. Loom checks dependencies, runs the selected Session,
and records which artifacts were produced and successfully consumed. Runtime
integration targets Pi; Core is independent of Pi. Completed execution does not
certify business acceptance, and unknown outcomes do not imply safe retry.

For application developers and coding agents, start with [AGENT_GUIDE.md](AGENT_GUIDE.md).
It maps business changes to files, describes the reusable Host and input helpers,
and includes two executable synthetic domain examples. Use `app validate --explain`
to inspect composition and `task inspect --summary` to see governance outcomes.
Full inspection JSON and existing Host interfaces remain supported.


The alpha.6 `agent-loom/agent` export provides Discover, Describe, Check, Invoke and
Inspect over the existing governance Kernel. Run `loom --help` for commands and
see `AGENT_GUIDE.md` for request mapping. Requests and receipts are versioned,
named bindings are rechecked at execution, and Pi factories are selected per
Profile. This development preview does not establish native compatibility or
independent Agent experience acceptance.
