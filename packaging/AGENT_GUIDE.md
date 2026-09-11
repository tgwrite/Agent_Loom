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

Legacy JSON errors remain on stderr with exit code 1; successful results are on stdout.
Agent Check blockers and Invoke receipts are on stdout, with exit code 1 for a blocked
check or an execution status other than completed. Envelope errors use stderr.
Errors add `diagnostic` with a version, execution phase and suggested checks. Do not
parse prose as an error code. Native output may require application-owned routing;
trusted imported modules can have side effects even during definition loading.

Malformed Application fields retain `InvalidDefinition` and include
`error.details.path` and `error.details.rule`, for example
`profiles[0].entry.implementation` / `expected-native-or-synthetic`.
The path identifies the declaration field without echoing its invalid value.
An explicit `entry` requires `id`, `purpose`, `implementation` and
`effect_declarations`; `request_mapping` alone is not a complete entry contract.

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
`create({ store, plan })`. The factory returns `{ initialize, run, afterRun }` hooks;
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

## Agent services in alpha.3

`agent-loom/agent` exports `connectLoom`, `discoverEntries`, `describeEntry`, and
`createRequest`. The facade reuses the existing resolver, execution Kernel and
canonical inspection. It does not decide which entry to call next.

An optional `profile.entry` describes one existing Profile:

```js
entry: {
  id: 'measurement.consume',
  purpose: 'Derive a result from an accepted measurement source',
  implementation: 'synthetic',
  request_mapping: 'v1',
  effect_declarations: ['task-files-write'],
}
```

Add `input_name: 'source'` to its Artifact requirement. The default entry ID is the
Profile ID; undeclared implementation/effects remain unknown. Declared outputs are
those of the primary Plugin, and do not promise every Profile produces every type.
`describe` returns an envelope JSON Schema, participant facts, optional examples,
effects and retry limitations. The application still owns the data parser and
semantic validation. Effect declarations are not enforced sandbox boundaries.

```js
import { connectLoom, createRequest } from 'agent-loom/agent';
import { createSessionHost } from './host.mjs';

const loom = await connectLoom({
  taskRoot: './sample-task',
  taskId: 'sample-task',
  host: { actor: { id: 'application-executor' }, createHost: createSessionHost },
});
const entries = loom.discover({ input_type: 'measurement.samples' });
const contract = loom.describe('measurement.consume');
const request = {
  ...createRequest('sample-task', contract.entry_id),
  inputs: { source: { artifact_id: 'selected-artifact' } },
};
const checks = await loom.check(request);
if (checks.blockers.length === 0) console.log(await loom.invoke(request));
else console.log(checks);
```

The caller chooses the Artifact identity from Task facts and decides whether to
invoke. This conditional is caller code, not a Loom planner. SDK `connectLoom`
receives its trusted Host binding explicitly; CLI commands reuse the Task's saved
Host binding. Request fields cannot override identity, composition, model settings,
required aspects or unsupported hard limits. Unknown request fields are rejected.

Supported CLI operations share the SDK implementation:

```sh
loom agent discover --app ./application.mjs --input-type measurement.samples --json
loom agent describe measurement.consume --task sample-task --root ./sample-task --json
loom agent check --task sample-task --root ./sample-task --request ./request.json --json
loom agent invoke --task sample-task --root ./sample-task --request ./request.json --json
loom agent inspect --task sample-task --root ./sample-task --entry measurement.consume --json
```

Discover supports exact ID, name substring, tag, input type and output type filters.
Inspect can filter entry, Session, request or Artifact identity. Default views omit
request contents, raw logs, transcripts and Artifact bodies. Old full inspection
remains available and includes the locally persisted Session request copy.

Check reports declaration, candidate IDs, selected references, Host delivery and
native preflight separately. Host delivery is only a declaration, not a verified
file, dependency fingerprint or working credential. Static checks do not import
the Host or invoke factories. Loading an executable Application module may have
side effects; for data-only discovery pass a previously validated data snapshot to
`discoverEntries` or `describeEntry`.

SDK bindings may supply `checkBindings(plan)` and `nativePreflight(plan)` with
explicit coverage. `check(request, { native_preflight: true })` or CLI
`--native-preflight` opts into trusted native loading; CLI preflight covers the
Host's Application resources. It does not evaluate credentials, models, input
bytes, initialization or business acceptance. Check reserves nothing. Invoke
resolves again and the initializer must verify the actual bytes.

The Profile, primary Pi registration and Host must explicitly support request
mapping. Register `request_mapping: 'v1'` on the primary registration and implement
its parser in the adapter. The initializer receives `context.request` and
`context.plan.named_artifacts`; the factory receives a detached `plan`. Instructions
and data are passed only to declared recipients. Aspects receive no request unless
their registration explicitly opts in. Adapters decide which necessary domain
values to send to the model; Loom never automatically prompts with the request,
Task, governance store or Artifact body. Unsupported values must be rejected by
the application parser, not silently ignored. Existing adapters still work through
`session start` without invocation requests.

`definePiApplicationModule` accepts `id`, `version`, `profiles`, the existing Pi
Host options and `plugins: [{ descriptor, adapter }]`. It returns `application`,
`createSessionHost` and `validateNativeApplication`. Descriptors and registrations
are paired once; declaration validation, entry descriptions and Host composition
use that definition. Export its application and Host functions from trusted local
modules. Opening or validating a Host creates no adapter factories. Launch creates
only participants selected by that Profile, with a separate governance writer per
Session. No dependency causes a producer to run automatically.

## Safe receipts and diagnostics

A version 1 receipt separates execution, output references, aspect failures and
`business_acceptance: { status: 'not-evaluated' }`. Adapter READY labels are not an
independent business evaluation. Applications must perform their own acceptance;
this release does not persist an additional business-acceptance authority.

Missing prerequisites produce `not-started` with no Session. An initialization
rejection retains its actual failed Session and records no consumption. A running
record alone cannot confirm the outcome or executor liveness. Unreadable or
inconsistent governance facts produce `unknown` with known IDs. If a transient
write failure is followed by a consistent failed settlement, both Invoke and
Inspect report `failed`. A receipt is a projection, not another store.
Inspecting a Task does not recover a conversation or establish safe retry.

`request_id` correlates attempts; repeating it creates another Session. No
idempotency, exactly-once, cancellation service or automatic recovery is provided.

`readArtifactFile` produces safe reasons such as `DIGEST_MISMATCH` and
`CONTRACT_MISMATCH`. Domain adapters can register reviewed static codes:

```js
import { registerSafeDiagnostics } from 'agent-loom';
const reject = registerSafeDiagnostics('domain', ['SOURCE_POLICY_REJECTED']);
// After applying the application's domain policy:
throw reject('SOURCE_POLICY_REJECTED');
```

Registered errors survive Adapter, Pi Host and Kernel boundaries. Ordinary error
objects, even ones containing a lookalike `diagnostic`, are not trusted. Only
versioned allowlisted fields enter the receipt; raw message, stack and paths stay
hidden. Kernel lifecycle observations set `domain_execution_started`; false means
the domain run was not entered and does not rule out initialization side effects.
The execution phase is not a claim about individual tools or external vendors.

The local single-writer filesystem and cooperative same-process adapters remain
trust assumptions. This release does not provide a malicious-code sandbox.
Synthetic tests and the offline examples demonstrate these interfaces, not real
Plugin compatibility or improved Agent task performance. Independent cold-start
Agent comparisons remain a separate acceptance exercise.

## Contract updates in alpha.4

Request v1 and Task schema 2 remain supported. Receipt v1 adds facts; consumers
should accept additive fields. `observation.recorded_session_status` reports the
stored status, while `observation.outcome_confirmed` indicates a consistent terminal
outcome (or an explicit pre-start rejection). A stored `running` becomes execution
`unknown`, with `OUTCOME_UNCONFIRMED`, rather than a liveness claim. Matching terminal
records and events are required for Agent receipts. `call_diagnostic`, when present,
describes an immediate observation that could not be persisted; it does not
override the shared outcome. Legacy queries retain their historical identity.

Sessions created by `session start` or request-free SDK calls use the same outcome
confirmation, safe domain/aspect diagnostics, output and consumption projection.
Their `request_id` remains null and `identity_migration` remains `not-inferred`;
inspection does not create requests or rewrite history. Missing execution-start
evidence stays unknown, and missing or conflicting terminal evidence cannot confirm
success. Inconsistent persisted bindings report `GOVERNANCE_RECORD_INVALID` at
the governance-storage boundary; caller request rejection remains `REQUEST_REJECTED`.

`requested_inputs` contains explicit caller selections. `resolved_inputs` records
the actual binding before initialization, including implicit selections; its
status is `unavailable` for older records without this evidence. `consumed` contains
only registered successful accepts, with accepted digest, producer Session,
consumer Session/Plugin, time and known input names. One consumption can serve
multiple input names. Old unknown names remain null. Empty consumption records do
not prove that initialization never read data, and inspection does not revalidate
current Artifact bytes. No input body, instruction or data is returned by default.

Artifact summaries expose `consumers`. Session/entry/request filters restrict that
list to matching Sessions; an Artifact-only query includes all its consumers.
Artifact filtering also finds Sessions that selected the Artifact but rejected
initialization; these Sessions are not added to its consumers.

Check reports each stage as `not-checked`, `passed` or `failed`. Unchecked reasons
distinguish an earlier blocker, an unsupported callback and an unrequested check.
A failed native preflight may have loaded code. `agent inspect` returns exit 1
with structured stdout when history is unreadable; missing Host delivery does not
prevent successful historical inspection.

A custom SessionHost can report the same reviewed failure by return or throw:

```js
import { createNativeFailure, registerSafeDiagnostics } from 'agent-loom';
const reject = registerSafeDiagnostics('domain', ['SOURCE_POLICY_REJECTED']);
// From NativeSessionHandle.run(), after applying domain policy:
return { status: 'failed', failure: createNativeFailure(reject('SOURCE_POLICY_REJECTED')) };
```

The helper brands the record in process memory. Cloning, spreading or serializing
it loses trust; lookalike diagnostics fall back to a generic safe reason. Kernel
lifecycle evidence overrides caller-supplied phase claims. This protocol does not
authenticate cross-process errors. All retry and business-acceptance limitations
above still apply.

## Contract updates in alpha.5

### Business parameters before native startup

Entries may declare `data_schema`, `data_required` and `data_examples` alongside
`request_mapping: 'v1'`. Describe embeds the Schema in `request_schema.properties.data`
and returns the examples. Check, Invoke, plan revalidation and the Store startup
gate share validation. A rejection reports `InvalidArguments` with `details.path`
and `details.rule`, without the rejected value. Invalid requests reject the SDK
promise; the CLI returns its structured error on stderr and exits 1.

```js
const entry = {
  id: 'research.report', purpose: 'Create a report from selected sources',
  implementation: 'native', request_mapping: 'v1',
  effect_declarations: ['task-files-write'],
  data_required: true,
  data_schema: {
    type: 'object', required: ['language'], additionalProperties: false,
    properties: {
      language: { enum: ['zh', 'en'] },
      max_sections: { type: 'integer', minimum: 1, maximum: 12 }
    }
  },
  data_examples: [{ language: 'zh', max_sections: 4 }]
};
```

`loom-data-schema-v1` is a bounded JSON Schema subset. Supported keywords are
`type` (one JSON type), `description`, `properties`, `required`, boolean
`additionalProperties`, `items`, `minItems`, `maxItems`, `minLength`, `maxLength`,
`minimum`, `maximum`, `enum` and `const`, plus boolean schemas. Properties use
ASCII identifiers starting with a letter or underscore, up to 128 characters;
remaining characters may also be digits or hyphens. Schema nesting is limited to
32 and nodes to 1,024; enums contain 1–256 unique JSON values. String lengths count
Unicode code points. Unsupported keywords, including references, formats, regexes
and schema combinators, fail declaration validation. Examples must validate.
No network resolution, coercion, default insertion or complete JSON Schema support
is provided. Shape and bounds do not verify URLs, source truth or business policy.

Without `data_required`, omitted data remains allowed even if a Schema is declared.
Without a Schema, data remains application-owned. A required data contract also
rejects request-free execution: use Invoke for that entry. Existing entries without
these fields retain their behavior. Tasks keep their original Application snapshots;
editing an Application module does not update an already-created Task.

### Native readiness

Native failures include a reviewed `diagnostic.check` and static `next_step` for
Host import/exports, SDK version/surface, adapter registration, entry files,
prompt directories, extension loading or launcher checks. Native error text is
not forwarded. `readiness_checks` separates these observations from model,
credential and business-acceptance checks, which remain `not-checked`.

The Pi helper returns a `NativeReadinessReport` from `validateNativeApplication`.
Return that report from an SDK binding's `nativePreflight` callback to preserve
coverage. Legacy callbacks returning void still work; their individual checks stay
`not-checked`. An optional `checkLauncher()` Pi Host option runs only during explicit
native preflight. It must probe the local launcher without starting a model or domain
operation. Absence of that callback leaves launcher readiness unchecked. Ordinary
Check does not import the CLI Host, instantiate adapters or execute this probe.

### Attempts and cooperative Task ownership

`inspect({ request_id })` and CLI `agent inspect --request-id <id>` add an `operation`
summary: attempt count, ordered outcomes, request consistency and confirmation
status. This summary always covers the entire Task/request pair, even if Session
or entry filters narrow displayed rows. It compares recorded request content
without returning instruction/data values or their hashes. Object property order
does not affect comparison. A changed value produces `conflicting-requests`; any
unconfirmed attempt produces `unconfirmed`. No matching record means `not-recorded`,
which cannot rule out an external effect before governance persistence.
Repeated IDs still create new Sessions; the query does not establish safe retry.

```js
const loom = await connectLoom({ taskRoot, taskId, host, writer_policy: 'exclusive' });
const receipt = await loom.invoke(request);
const attempts = await loom.inspect({ request_id: request.request_id });
```

CLI invocation opts in with `--exclusive-writer`. Every mutating client must follow
the same policy. Exclusive Invoke acquires `.agent-loom/writer.lock`, checks history
under ownership, rejects unconfirmed outcomes, resolves inputs again and retains
ownership through execution and receipt inspection. Competition fails immediately
with `TASK_WRITER_BUSY`; this is not a scheduler. SDK callers implementing their own
write boundary can use `withTaskWriter(store, async () => { ... })` and must perform
their own state rechecks inside the callback. Do not nest it around exclusive Invoke.

Only the acquiring owner's token may release the lock. An existing lock is never
automatically expired or removed; after interruption, stop participating writers,
inspect outcomes and reconcile external effects before explicitly removing the
local lock. Lock removal alone does not reconcile an unknown Session. A release
failure after a confirmed invocation preserves its receipt and adds
`call_diagnostic`; it must not be interpreted as permission to repeat the operation.
Direct Store writes, legacy Session entrypoints and clients without the option are
not protected. This is a cooperative local filesystem protocol, not a distributed
lock, hostile-process defense or automatic crash recovery.

### Participants and acceptance evidence

Receipts expose `participants.primary` and every declared aspect. Core reads generic
Host phase observations, independent of Pi. Hosts may call
`recordParticipantObservation(store, sessionId, { plugin_id, phase, status })` with
phase `domain-run` or `aspect-after-run` and status `started`, `completed` or `failed`.
The helper validates the Plugin role against the Session. The Pi application host
emits these observations automatically. They are trusted Host reports, not a new
business-quality authority. Generic Hosts and older Sessions may lack them.

An aspect's `completed` requires an ordered start/completion pair and no recorded
failure. `publication-observed` means an Artifact exists without phase completion
evidence; `not-observed` is not success. The evidence scope refers to the explicit
after-run phase, not every native hook. Session completion, domain completion and
aspect status can differ. No transcript or Artifact body is added to the summary.

An entry can opt into evidence references with
`acceptance_artifacts: [{ type: 'audit.report', version: '1', producer_plugin_id: 'audit' }]`.
Each contract must belong to a selected producer and its declared outputs.
`business_acceptance.references` then identifies matching produced Artifacts;
`status` stays `not-evaluated`. Applications inspect these references and decide
whether their own acceptance policy passed. Missing references do not imply success.

### History inspection

Inspection builds a fresh in-memory index for each read, validates provenance and
reuses the loaded Session records. It does not cache across requests or introduce a
database. Queries still read the full governance history, then filter the projection;
they do not rehash Artifact bodies or provide a transaction snapshot while another
writer is changing files. Use cooperative ownership when a decision requires a
stable read. `npm run benchmark:inspection` in a source checkout measures synthetic
100/500-Session histories; timings are local observations, not Plugin performance
or model-quality evidence.
