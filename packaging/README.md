# Agent Loom — Minimal Agent governance runtime

**Declared evidence gates selected Agent work. Loom records provenance, exact
consumption and durable execution facts; Plugins own domain truth.**

Pre-release: 0.2.0-alpha.1. Real Plugin compatibility remains separately unverified.
Read the migration chapter before upgrading.

Canonical source: https://github.com/tgwrite/Agent_Loom

Download this precompiled archive, `SHA256SUMS` and `INSTALL.md` from
[GitHub Releases](https://github.com/tgwrite/Agent_Loom/releases).
To build one yourself, run `npm ci` and
`npm run package:local` in the source checkout; the installed package has no build scripts.

This precompiled package provides the `loom` CLI, Core SDK and Pi Runtime bridge.
It requires Node.js >=24.12.0 and npm. Source checkout, TypeScript compilation and
development dependencies are not required to use the package.

Start with the [user manual](manual/README.md), included in this package and maintained
with the public repository. It separates getting started, native integration,
adapter APIs, troubleshooting and advanced contracts.

See [INSTALL.md](INSTALL.md) for installation, SDK imports and a synthetic
producer/consumer example. The package does not install Pi or business plugins,
configure model credentials, or include a ready-to-run real webpage application.
Applications supply explicit native bindings and domain verification. Plugins load
at Session startup, according to the selected Application/Profile.

The core model is Task, Run, Artifact, Requirement and Consumption. Run is called
Session in the CLI. Evidence resolves uniquely, the consumer initializes and verifies
it, consumption is persisted, then execution begins. Discover/Describe/Check are
convenience APIs; Invoke rechecks the declared requirements.

For a specified verifier, use `producer_plugin_id` in the proof Requirement and
check the exact subject and verdict during consumer initialization. See the
[result-and-proof recipe](manual/ADAPTER_API.md#require-a-result-and-independent-proof).

Task data belongs in your own workspace. No workflow scheduling, automatic retry
or schema migration is provided. CLI/SDK installation checks and real Pi task
acceptance are separate. This alpha pre-release is offered for installation and
integration testing. Real-task and independent Agent acceptance remain pending;
it is not a stable release.

License: Apache-2.0. See LICENSE and NOTICE.

| Agent operation | CLI | SDK |
| --- | --- | --- |
| Discover entries | `loom agent discover` | `loom.discover()` |
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
Task schema 3 uses producer assertions and optional producer-constrained Requirements.
Older stores require explicit migration; storage and event internals are no longer root exports.


The `agent-loom/agent` export provides Discover, Describe, Check, Invoke and
Inspect over the existing governance Kernel. Run `loom --help` for commands and
see `AGENT_GUIDE.md` for request mapping. Requests and receipts are versioned,
named bindings are rechecked at execution, and Pi factories are selected per
Profile. This development preview does not establish native compatibility or
independent Agent experience acceptance.
