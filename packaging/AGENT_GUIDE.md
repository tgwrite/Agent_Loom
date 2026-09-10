# Application development with Agent Loom

This guide ships with the installed CLI/SDK. Use its declarations and `loom --help`
as the API reference for this version. Examples here describe implemented APIs.
The package is a development preview; complete v0.1 native acceptance is pending.

## Start here

Loom governs Plugin composition, Task/Session identity, dependencies, Artifact
provenance, successful consumption, and failures. Runtime and Plugins own reasoning,
tools and domain verification. Application definitions contain no execution graph.

If Plugins already have adapters, reuse those adapters. Write a new adapter only
for an unsupported native protocol or a genuinely new domain requirement. Installed
Plugins alone do not establish compatible Artifact contracts.

| Change requested | Change location |
| --- | --- |
| New instance of the same task | Application input file; create a new Task |
| Different Plugin composition | Application plugins and profiles |
| Different acceptance policy | Domain validator / adapter |
| New native Plugin protocol | Its reusable adapter, then the Application binding |
| Different runtime credentials/model | Trusted local Host configure callback |
| Inspect history | CLI; do not edit governance records |

Generated `.agent-loom/` data belongs to each Task. Do not rewrite it to repair an
assertion, mark an Artifact READY, or force a completed Session. The local filesystem
is trusted and each Task has one writer. No automatic crash recovery is provided.

## Discover the installed interfaces

- `agent-loom`: Core interfaces, `LocalTaskStore`, `prepareSession`, `executeSession`.
- `agent-loom/runtime-pi`: `createPiHostModule`, `createPiApplicationHost`,
  `createPiSessionHost`, `readArtifactFile`, `readTaskInput`.
- Types: `dist/packages/runtime-pi/src/index.d.ts` and its referenced declarations.
- `loom app validate <app> --definition-only --explain --json`: static composition.
- `loom app validate <app> --json`: configured native preflight, not task acceptance.
- `loom task inspect <task> --summary --json`: small governance projection.
- `loom task inspect <task> --json`: unchanged full evidence contract.

JSON errors remain on stderr with exit code 1; successful results are on stdout.
Errors add `diagnostic` with a version, execution phase and suggested checks. Do not
parse prose as an error code. Native output may require application-owned routing;
trusted imported modules can have side effects even during definition loading.

## One Host module for preflight and execution

The Application exports `nativeHost = './host.mjs'`. That module can export the two
functions returned by `createPiHostModule(options)`:

```js
import { createPiHostModule } from 'agent-loom/runtime-pi';
import * as sdk from '@earendil-works/pi-coding-agent';
import { registrations, configureRuntime } from './integration.mjs';

export const { createSessionHost, validateNativeApplication } = createPiHostModule({
  sdk,
  sdkVersion: sdk.VERSION,
  preflightDirectory: import.meta.dirname,
  adapters: registrations,
  configure: configureRuntime,
});
```

`integration.mjs` is your trusted integration module or a reusable adapter package;
it is not built into Loom. `configureRuntime({ store })` returns
`{ settings, modelRuntime }` using the selected Pi SDK and local authentication.
Loom does not select a provider, copy global credentials or change global settings.
The helper uses `<Task>/.agent-loom/pi` for its native runtime directory.

Each registration is keyed by the Application's `native.binding_key` and contains
an explicit absolute `entry`, optional absolute `prompt_paths`, and optional
`create({ store })`. The factory returns `{ initialize, run, afterRun }` hooks;
a primary domain adapter must implement initialize and run. Hook factories share
the registered entry used by preflight; they cannot replace it at execution time.

Preflight checks SDK version, selected entries, prompts and exact extension loading.
It does not call configure, factories, createAgentSession or domain hooks. Native
extension modules are trusted executable code and may have their own load effects.
Model access, factory output and domain compatibility are checked later at execution.
Profile resources load explicitly; no global Plugin discovery or installation occurs
in the built-in Pi bridge. A custom Host remains responsible for its own behavior.

Use `createPiApplicationHost` directly for advanced integrations needing different
native directories or dynamic entries. Existing Hosts remain supported.

## Input and contracts

`loom task create --app <app> --root <root> --name <id> --input <json-file>` parses
UTF-8 JSON before creating the Task. The Application may export
`validateTaskInput(value)`; throw to reject. The CLI calls it with a detached value,
including undefined if --input was omitted. It does not use a returned normalization.
Input is saved in `.agent-loom/input.json`; without a validator the result says
`json-only`. No domain acceptance is implied by JSON parsing.

Use `await readTaskInput(store, parse)` in an adapter. `parse(unknown)` is a required
application function that returns its typed domain value or throws. The snapshot
is independent of later edits to the original file. It is not a security boundary
against a trusted local actor rewriting Task files; task input is not an Artifact.

For a file Artifact received in initialize:

```js
const accepted = await readArtifactFile(context, artifacts[0], requirement,
  bytes => parseAndVerifyDomainPayload(bytes));
```

The helper checks Task membership, exact selected reference, type/version/status,
optional Artifact and producer identities, real file containment and SHA-256. The
required callback verifies domain truth using those bytes. It does not choose another
Artifact, write records, or mark consumption. Use the accepted bytes/value rather than
reopening an unverified path. It supports file references; inline contracts remain
application-owned. A trusted single-writer filesystem remains the storage assumption.

Successful initialization, including native setup, precedes Core consumption. A
consumer run failure after initialization retains the truthful consumption record.
The adapter writes its domain files and returns publications with only
`{ type, version, path, verification_status }`. Loom derives identity and provenance
from the active Session. Paths are Task-relative, even for a nested workspace.

## Verify before spending model calls

Run definition checks, preflight and synthetic domain fixtures first. Check both
accepted and rejected inputs. A runnable two-domain example is included below. Its
SDK is explicitly synthetic: it proves API composition, not native Plugin compatibility.

From the project containing the installed package, choose a fresh Task root/name:

```sh
npx --no-install loom app validate ./node_modules/agent-loom/examples/integration/measurement.mjs --explain --json
npx --no-install loom task create --app ./node_modules/agent-loom/examples/integration/measurement.mjs --root ./sample-task --name sample-task --input ./node_modules/agent-loom/examples/integration/measurement.json --json
npx --no-install loom session start --task sample-task --root ./sample-task --profile produce --json
npx --no-install loom session start --task sample-task --root ./sample-task --profile consume --json
npx --no-install loom task inspect sample-task --root ./sample-task --summary --json
```

For a different domain use `catalog.mjs` and `catalog.json` with another Task. Both
reuse the same Host while their input schemas and business validators differ.
The synthetic model has no network or model requests. Do not use its SDK as a real
runtime. In a native integration supply the real Pi SDK, native entries, application
configuration, and adapters that execute native tools or commands.

## Diagnose without weakening governance

| Symptom | Check |
| --- | --- |
| PreconditionNotSatisfied | Required type, version, verification and selected Task; no producer is scheduled |
| BindingConflict | Candidate identities; never pick a file by modification time |
| NativeIntegrationNotReady | Host exports, Pi version and explicit registrations; inspect diagnostic phase |
| NativeExecutionFailed | Session, rejection events and native log; raw native errors stay out of Core |
| Completed Session with aspect failure | Main execution and aspect results are separate; inspect the failed Plugin |
| StorageFailure | Partial records and explicit Task root before retrying; persistence errors are not optional |

`--summary` retains all Sessions, failures, accepted consumption and output locations.
It reports `business_acceptance: not-evaluated`. Absence of an aspect failure record
does not prove that the aspect produced an accepted result. Business validation is
still supplied and evaluated by the application.

Repeated `session start` creates a new Session. Required Artifacts resolve again;
multiple matches still conflict. No implicit cache, resume, side-effect deduplication
or standalone aspect retry is promised. An Application snapshot does not freeze the
executable Host file. Inspect before retrying after changes or partial execution.

Keep developer instructions and governance inspection outside the main domain model
context. Expose only explicit, domain-relevant inputs. Never publish real inputs,
credentials, machine paths or Task evidence in a public application repository.
