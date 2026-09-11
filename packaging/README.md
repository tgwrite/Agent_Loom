# Agent Loom — local alpha package

**开发中：本包是本地 alpha 候选版本，完整 v0.1 尚未验收。**

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
acceptance are separate. This candidate must pass local real-task acceptance
before any public release.

License: Apache-2.0. See LICENSE and NOTICE.

For application developers and coding agents, start with [AGENT_GUIDE.md](AGENT_GUIDE.md).
It maps business changes to files, describes the reusable Host and input helpers,
and includes two executable synthetic domain examples. Use `app validate --explain`
to inspect composition and `task inspect --summary` to see governance outcomes.
Full inspection JSON and existing Host interfaces remain supported.


The alpha.4 `agent-loom/agent` export provides Discover, Describe, Check, Invoke and
Inspect over the existing governance Kernel. Run `loom --help` for commands and
see `AGENT_GUIDE.md` for request mapping. Requests and receipts are versioned,
named bindings are rechecked at execution, and Pi factories are selected per
Profile. This local candidate does not establish native compatibility or
independent Agent experience acceptance.
