# Agent contracts and compatibility

## Start here

Agent Loom is a minimal governance runtime that controls whether selected Agent
work may proceed based on declared evidence. The core concepts are Task, Run,
Artifact, Requirement and Consumption. Plugins own domain truth; the Agent chooses
work. Discover, Describe and Check are convenience interfaces over this kernel.

This manual describes the **0.2.0-alpha.1 development candidate**, not a published
release or proof of real Plugin compatibility. Start with [onboarding](START_HERE.md)
and the [native example](NATIVE_INTEGRATION.md).

## Compatibility and migration

This alpha changes APIs and persisted semantics deliberately:

| Previous contract | Current contract |
| --- | --- |
| Capability definitions, invocations and events | Removed; select a Profile/Entry |
| `producer.capability_id` | Removed; Plugin and Run identify the producer |
| Artifact `verification.status` | `assertion.status`: a producer assertion |
| Requirement / NativePublication `verification_status` | `assertion_status` |
| `acceptance_artifacts`, `business_acceptance` | Ordinary Proof Artifacts plus downstream Requirements |
| `effect_declarations` | Removed; Loom does not enforce permissions |
| Entry purpose/name/tags/implementation/examples/data_examples | Optional Profile `presentation` metadata |
| Task schema 2 | Task schema 3; old Tasks are rejected without modification |
| Root storage, events, context, provisional Runtime exports | Internal; use the explicit facade and Host contract |

Request v1 remains unchanged. Receipt v1 retains execution, observation and lineage
facts but removes the acceptance field; this is an alpha API break. Session remains
the CLI/storage spelling for a Run. Public types use `RunProfile` and `RunRecord`.

Do not change an old Task's schema number in place. Keep its Application snapshot,
logs and payloads intact and use its matching old installation for inspection.
Start a new Task with a migrated declaration. Continuing old history needs a separate,
explicit conversion on a copy, with reviewed field mappings and audited digests and
relationships. No automatic conversion is provided. Legacy `.agent-container/`
directories also require explicit migration; Loom never silently splits a Task.

## Discover the installed interfaces

- `agent-loom`: `createTask`, `defineApplication`, `validateApplication`, `connectLoom`,
  `createRequest`, `discoverEntries`, `describeEntry`, `registerSafeDiagnostics`,
  governance types and the trusted Host contract.
- `agent-loom/agent`: convenience facade and request/receipt types.
- `agent-loom/runtime-pi`: `createPiHostModule`, `definePiApplicationModule`,
  `createPiApplicationHost`, `createPiSessionHost`, `readTaskInput`, `readArtifactFile`.

Import only package export specifiers. `LocalTaskStore`, direct execution helpers,
`withTaskWriter`, event/context helpers and provisional RuntimeAdapter are internal.
The SDK creates a Task through `createTask({ taskRoot, taskId?, application, title })`;
then connects through `connectLoom({ taskRoot, taskId, host? })`.

CLI equivalents include `app validate --definition-only`, `task create`,
`agent discover`, `agent describe`, `agent check`, `agent invoke`, `agent inspect`,
and `task inspect --summary`. `loom --help` lists argument combinations.
Check blockers and Invoke receipts use stdout and exit 1 when blocked or incomplete;
malformed envelopes use stderr. Parse structured codes, not prose.

## One Host module for preflight and execution

Applications export `nativeHost = './host.mjs'`. `createPiHostModule(options)` returns
`createSessionHost` and `validateNativeApplication`; export both. Supply the actual
SDK/version, explicit adapter registrations, local preflight directory and trusted
model configuration. Factories run only for selected participants during launch.

A Host gets `HostTaskStore`, a limited facts interface: Task snapshot/root, Session
lookup, Artifact publication, observer failure recording and runtime event append.
It does not receive lifecycle settlement or consumption mutation. Runtime events
are trusted observations; core lifecycle/artifact events are store-managed.
The Pi host derives producer identity from selected bindings and computes publication
digests. Custom Hosts must enforce their own binding attribution.

Host launch opens a native session without starting domain execution. Initialize
must validate all exact resolved inputs; only after it succeeds does Loom persist
consumption, then call run. A failed required write stops execution. Observer failures
remain contained; storage failures are fatal. Host code, plugins and the Task root
are trusted local components, not hostile-process security boundaries.

## Input and contracts

Profiles are execution declarations, never schedules. A Run has at most one primary
domain Plugin and any number of aspects. A Task fixes its Application snapshot.
Changing a source Application does not change existing Tasks.

```js
const consumerProfile = {
  id: 'consume', primary: 'consumer', aspects: [],
  entry: { id: 'sample.consume', request_mapping: 'v1' },
  presentation: { purpose: 'Use a result with independently produced evidence' },
  requirements: [
    { input_name: 'result', type: 'sample.result', version: '1', producer_plugin_id: 'author' },
    { input_name: 'proof', type: 'sample.proof', version: '1',
      producer_plugin_id: 'verifier', assertion_status: 'READY' }
  ]
};
```

Declare both producers and their output contracts in the Application. A Requirement
matches type/version, optional producer identity, optional assertion status and
optional Artifact identity. Zero matches produce `PreconditionNotSatisfied`; multiple
matches produce `BindingConflict`. Loom does not schedule a missing producer or choose
the newest result. Named request inputs may select an exact Artifact but cannot
weaken any Requirement or replace an Application-pinned identity. See the complete
[result-and-proof declaration](ADAPTER_API.md#require-a-result-and-independent-proof)
for a producer, verifier and consumer configuration.

A Proof Artifact is an ordinary publication. Its payload can contain
`subject_artifact_id`, `subject_sha256` and `verdict`. The consumer must check that
these identify the exact selected result and an acceptable verdict. Loom does not
interpret the proof payload. Merely having a result and proof does not establish that
the proof concerns that result. Producer IDs constrain trusted bindings; they are
not cryptographic authentication of an external organization.

Native publications use `{ type, version, path, assertion_status }`. Paths are
Task-relative. `readArtifactFile(context, ref, requirement, verify)` checks the exact
selected reference, contract, producer, file location and digest before calling the
domain verifier. It does not resolve alternatives or record consumption.

## Agent services

```js
import { connectLoom, createRequest } from 'agent-loom';
const loom = await connectLoom({ taskRoot, taskId, host });
const request = createRequest(taskId, 'sample.consume');
const description = loom.describe(request.entry_id);
const preflight = await loom.check(request);
const receipt = await loom.invoke(request);
const history = await loom.inspect({ request_id: request.request_id });
```

Check is an observation, not a reservation or lasting execution authorization. Invoke
revalidates against the Task snapshot. Ordinary Check performs no model call or
initializer. `native_preflight: true` explicitly opts into trusted native resource
loading. It does not certify credentials, domain truth or external side effects.

### Business parameters before native startup

Entry contains `id`, optional `request_mapping: 'v1'`, `data_schema` and
`data_required`. These affect request legality. Purpose, labels, tags, implementation
kind and examples belong to `profile.presentation`; they do not participate in Core
validation or grant execution eligibility. Describe exposes them as convenience data.

`loom-data-schema-v1` supports boolean schemas, `type` (one JSON type), `description`,
`properties`, `required`, boolean `additionalProperties`, `items`, `minItems`,
`maxItems`, `minLength`, `maxLength`, `minimum`, `maximum`, `enum` and `const`.
Property names are ASCII identifiers up to 128 characters. Nesting is limited to 32,
nodes to 1,024, enums to 1–256 unique JSON values. String length counts code points.
References, formats, regexes and combinators are unsupported. There is no coercion,
default insertion or network resolution. Presentation examples are advisory.

Check, Invoke and startup share validation. Rejections use `InvalidArguments` with
`details.path` and `details.rule`, without the rejected value. `data_required: true`
requires Invoke with data; request-free `session start` cannot supply it. Omitted
optional data is valid even with a Schema. Shape validation does not prove domain truth.

### Native readiness

Definition validity, Host delivery, binding checks and native resource loading remain
separate. Readiness fields are `passed`, `failed` or `not-checked`; missing coverage
stays unchecked. A native preflight can load trusted code. Model configuration,
credentials, Artifact bytes, consumer initialization and external effects are outside
ordinary Check. An optional launcher probe must not start domain/model work.

## Safe receipts and diagnostics

`execution.status` distinguishes not-started, running, completed, failed and unknown.
`observation.outcome_confirmed` requires consistent durable terminal evidence.
`resolved_inputs` records selection; `consumed` records successful initialization of
an exact ID/digest. Consumption can remain true even when later execution fails.
No completed status or producer assertion certifies a business conclusion.

Use `registerSafeDiagnostics('domain', ['SOURCE_POLICY_REJECTED'])` in trusted code
and throw the registered error after a failed domain check. Native raw messages,
paths and stacks are not projected. Diagnostic branding is process-local; serialized
or forged errors do not acquire trusted meaning. Inspect phase, Plugin attribution
and participant observations together. Cleanup errors must not erase prior failures.

### Attempts and cooperative Task ownership

Repeated request IDs create new Runs. They correlate attempts, not idempotency.
`inspect({ request_id })` reports all attempts and conflicting request content without
exposing raw instruction/data. No recorded attempt does not rule out a startup effect.

Use `writer_policy: 'exclusive'` or CLI `--exclusive-writer` for cooperative Task
ownership. Every mutating client must participate. Loom checks history under the lock,
blocks unconfirmed outcomes, resolves inputs again and retains ownership through
receipt inspection. Contention fails immediately; it does not queue work. A release
failure preserves a confirmed receipt with a call diagnostic. Locks are not expired
automatically. Reconcile outcomes and external effects before operator recovery.
This is not a hostile-process defense or distributed transaction.

### Participants and proof evidence

Primary and aspect observations have independent statuses. An aspect's completed
status requires an ordered start/completion pair and no recorded failure.
`publication-observed` records an Artifact without claiming complete aspect execution;
`not-observed` is not success. The Pi host supplies phase observations automatically.
Proofs appear in ordinary `artifacts`; downstream Requirements govern eligibility.

### History inspection

Inspection rebuilds and validates its index per read, including producer-constrained
resolved bindings. It does not rehash payload bodies or provide a transaction snapshot
while another writer changes files. Unknown outcomes do not establish safe retry.
The summary and Agent receipt share execution/observation/consumption semantics.
See [troubleshooting](TROUBLESHOOTING.md) and the [adapter API](ADAPTER_API.md).
