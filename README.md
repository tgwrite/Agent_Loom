# Agent Loom — Plugin tools and artifact handoffs for AI agents

**A TypeScript CLI and SDK for AI agents to discover and invoke plugin capabilities,
reuse artifacts across sessions, and inspect provenance and failures.**

Agent Loom gives an agent structured answers to: What can I call? What inputs are
missing? Which artifact did this run use? What outcome is confirmed?
The agent chooses the next action; Loom manages the selected execution and its facts.

[User manual / 使用手册](manual/README.md) · [Download alpha](https://github.com/tgwrite/Agent_Loom/releases) ·
[中文介绍](README.zh-CN.md) · [Agent reading map](llms.txt)

## What it provides

| Interface | Purpose |
| --- | --- |
| Discover / Describe | Find callable entries and read their input/output contracts |
| Check | Inspect missing inputs and declared native prerequisites |
| Invoke | Execute an explicitly selected entry |
| Inspect | Query outcomes, artifact provenance, consumption and failures |

A Task links multiple Sessions. Each Session selects one primary domain Plugin and
optional aspects. Consumers receive artifact references and verify inputs before
successful consumption is recorded. Plugins retain their domain tools and policy.

## Install and use

**Current release: 0.1.0-alpha.6.** Download the precompiled `.tgz`, `SHA256SUMS` and
installation instructions from [GitHub Releases](https://github.com/tgwrite/Agent_Loom/releases).
Requires Node.js >=24.12.0 and npm; native plugins may require a newer Node version.
No npm registry release is available.

Start with the **[user manual](manual/README.md)**:

- [Installation](manual/INSTALL.md)
- [Getting started](manual/START_HERE.md)
- [Build a native application](manual/NATIVE_INTEGRATION.md)
- [Application and adapter API](manual/ADAPTER_API.md)
- [Troubleshooting](manual/TROUBLESHOOTING.md)

Applications supply native plugins, Host bindings, model configuration and domain
validation. The manual includes complete examples using public APIs; it does not
require reading framework or test implementations to infer integration steps.

## Status and scope

Development preview: Core, CLI/SDK and the Pi application host are implemented.
Complete v0.1 and independent Agent experience acceptance remain pending. Pi is the
current runtime integration; Core stays independent of Pi.

Artifact dependencies do not schedule execution. Completed execution does not certify
business acceptance, and unknown outcomes do not establish safe retry. There is no
workflow planner, automatic retry, database or malicious-code sandbox. Synthetic
examples do not establish real plugin compatibility or production readiness.

For development, checks and contribution rules, see [CONTRIBUTING.md](CONTRIBUTING.md)
and [AGENTS.md](AGENTS.md). Contract changes are in the
[manual's compatibility chapter](manual/AGENT_GUIDE.md).

License: [Apache-2.0](LICENSE). Canonical repository:
[tgwrite/Agent_Loom](https://github.com/tgwrite/Agent_Loom).
