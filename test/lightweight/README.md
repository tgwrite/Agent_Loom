# Lightweight native Plugin acceptance

For the formal CLI path and a no-Loom control, see the
[governance value experiment](GOVERNANCE.md). This older command remains a focused
integration regression using the same reusable Host and domain adapters.

Two Loom-managed Pi Sessions run three pinned public packages:

| Profile | Primary package | Aspect package |
| --- | --- | --- |
| fetch | pi-http-util 2.0.5 | @spences10/pi-telemetry 0.0.33 |
| report | @jakeryderv/pi-artifacts 0.11.0 | @spences10/pi-telemetry 0.0.33 |

Pi SDK and Pi AI SDK are pinned to 0.85.1. Node >=24.15.0 is required by the
telemetry Plugin. Dependencies are installed only inside this test directory;
each Session explicitly loads its selected entries. Global Pi packages, extension
settings, and defaults are not installed or updated. No `pi install` is used.
The small telemetry wrapper uses the native documented factory to enable an
isolated database without saving a global preference.

## Setup and repeat

From the repository root:

```sh
npm ci --prefix test/lightweight --ignore-scripts --no-audit --no-fund
npm run test:lightweight
npm run test:lightweight -- --observer-fault
```

The default `scripted` mode serves one synthetic page on a temporary local HTTP
server. Only model decisions are scripted; the real Pi agent loop, native HTTP
tool, conversion, artifact scaffold/export, telemetry hooks and Loom persistence
execute. No provider request is made. This measures deterministic integration,
not model reasoning or webpage summary quality.

To run the same composition with the current Pi default model and a selected URL:

```sh
npm run test:lightweight -- --mode model --url '<page-url>'
```

Replace `<page-url>` with the desired HTTP(S) URL. `--agent-dir <directory>` can
select an existing Pi configuration. Credentials are read into an in-memory
store; refreshed credentials are not written back. Model settings are inherited
except automatic compaction/retry and install telemetry, which are disabled for
this bounded test. Package/resource discovery remains explicit. Each Session has
a three-minute abort budget and a ten-tool-call limit; provider abort responsiveness
can affect shutdown time. Model mode uses paid/subscription model calls normally.

## What is checked

- A consumer started before its required source is rejected before native startup.
- Two separate processes create distinct Pi Session IDs and the intended Profiles.
- Native successful, untruncated HTTP output produces a hashed source Handoff.
- The consumer verifies the Handoff and its referenced bytes before consumption.
- The native report export succeeds and its unchanged bytes are registered.
- Reopening the Task in another process retains producer/consumer relationships.
- Both Sessions generate real native tool metrics with completed run records.
- `--observer-fault` injects an additional failing listener in the telemetry
  binding. Aspect errors must be observed while both primary Sessions complete.
- Selected global Pi configuration files have identical hashes before/after.

[HANDOFF.md](HANDOFF.md) describes the test-owned protocol. The four small
[Handoff tests](handoff.test.mjs) also run with the normal root `npm test`, without
requiring these optional dependencies or a model. Existing Core tests cover other
storage and dependency boundaries.

## Outputs and scope

Each invocation creates a fresh ignored `.test-tmp/lightweight/run-*` Task. It
retains `result.local.json`, `inspection.local.json`, metrics, per-profile logs,
native Sessions, source snapshots and the final `consumer/<session>/report.html`.
Raw web output and user configuration details stay local. Neither captured web
content nor runtime logs belong in a public commit.

The report Plugin natively stores bundles in its own user artifact directory;
this harness keeps that behavior and saves a verified export copy under the Task.
It never enables the viewer or modifies global plugin configuration. Native
bundles are retained; subsequent runs create unique bundles and do not overwrite
previous reports. The local telemetry database belongs to the native Plugin,
not Loom Core.

Elapsed time includes SDK loading, process startup and assertions; it is not pure
Loom overhead. Native tool timing is reported separately. Scripted telemetry uses
zero-usage model fixtures; only model-mode output represents real model activity.

Passing this suite establishes the lightweight Application's integration. It does
not complete the original reference group's domain trust, guards, extraction,
Postmortem or all v0.1 acceptance criteria.

The dependency lock keeps versions, registry URLs, integrity and licenses.
Optional upstream funding links are omitted from this public test lock; package
contents and their third-party notices are unchanged.
