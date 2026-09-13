# Agent Loom — Minimal Agent governance runtime

**Agent Loom controls when selected Agent work may proceed based on declared evidence.**

Models choose work; domain Plugins produce and verify facts. Loom records who produced
an Artifact, which exact evidence a consumer accepted, and what execution outcome is
durably confirmed. Its core concepts are Task, Run, Artifact, Requirement and Consumption.

[User manual / 使用手册](manual/README.md) · [Install local candidate](manual/INSTALL.md) ·
[中文介绍](README.zh-CN.md) · [Agent reading map](llms.txt)

## The governance loop

| Concept | Meaning |
| --- | --- |
| Task | A fixed governance context and Application snapshot |
| Run | One explicitly selected execution; called Session in the CLI and stored records |
| Artifact | A result with producer/Run identity, payload reference and digest |
| Requirement | Evidence a Run needs, optionally from a specified producer |
| Consumption | A consumer accepted an exact Artifact and digest during initialization |

`Requirements → unique evidence → consumer initialization → recorded consumption → execution`

For example, an author publishes a result and a verifier publishes a Proof Artifact.
A consumer Run requires both, with the proof's `producer_plugin_id` set to that
verifier. Missing evidence blocks execution; ambiguous evidence requires an explicit
binding. The consumer checks the proof's subject, digest and verdict before Loom
records consumption. `assertion.status` is a producer claim, not Loom's verdict.
See the [result-and-proof recipe](manual/ADAPTER_API.md#require-a-result-and-independent-proof).

Each Run has at most one primary domain Plugin and optional aspects. The model
chooses work; Plugins retain domain tools, guards and verification. Discover,
Describe and Check help callers inspect declarations. Invoke rechecks evidence;
a successful Check is not a reservation or permission to bypass initialization.

## Install and use

**Development candidate: 0.2.0-alpha.1 (unreleased).** Build a local archive with
`npm ci` and `npm run package:local`. See [installation](manual/INSTALL.md) for `.tgz`
installation and [migration](manual/AGENT_GUIDE.md#compatibility-and-migration) before upgrading.
Requires Node.js >=24.12.0 and npm; native plugins may require a newer Node version.
No npm registry release is available.

To exercise the source checkout without native dependencies:

```sh
npm ci
npm run check
npm run demo:agent
npm run package:local
```

The demo uses a synthetic Host and no model. The packaging command prints the local
archive path and writes its checksum alongside it. After installing the archive,
follow [the first Task walkthrough](manual/START_HERE.md#3-check-the-complete-lifecycle-without-native-dependencies)
to observe a missing-evidence blocker, produce an Artifact, and inspect its consumption.

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
Real Plugin compatibility and independent Agent experience acceptance remain pending.
Pi is the current runtime integration; Core stays independent of Pi.

Requirements do not schedule execution. Missing evidence yields `PreconditionNotSatisfied`;
ambiguous evidence yields `BindingConflict`. Proofs are ordinary Artifacts whose exact
subjects and verdicts the consumer verifies. `assertion.status` is a producer claim.

Loom governs execution through trusted Host entrypoints; it does not constrain code
that bypasses them or enforce permissions. Task schema 3 rejects older stores without
rewriting their history. Completed execution does not certify domain correctness, and unknown outcomes do not establish safe retry. There is no
workflow planner, automatic retry, database or malicious-code sandbox. Synthetic
examples do not establish real plugin compatibility or production readiness.

For development, checks and contribution rules, see [CONTRIBUTING.md](CONTRIBUTING.md)
and [AGENTS.md](AGENTS.md). Contract changes are in the
[manual's compatibility chapter](manual/AGENT_GUIDE.md).

License: [Apache-2.0](LICENSE). Canonical repository:
[tgwrite/Agent_Loom](https://github.com/tgwrite/Agent_Loom).
