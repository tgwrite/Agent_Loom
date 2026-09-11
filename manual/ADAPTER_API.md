# Application and Pi adapter API reference

Public contracts for **Agent Loom 0.1.0-alpha.6**. Start with
[onboarding](START_HERE.md); use the [complete native example](NATIVE_INTEGRATION.md)
for executable files. This page is a reference, not a request to inspect implementation
source or installed internal paths.

## Imports and ownership

| Import | Relevant exports |
| --- | --- |
| `agent-loom` | `LocalTaskStore`, `prepareSession`, `executeSession`, `inspectTask`, `withTaskWriter`, `registerSafeDiagnostics` |
| `agent-loom/agent` | `connectLoom`, `createRequest`, `discoverEntries`, `describeEntry`; request/receipt types |
| `agent-loom/runtime-pi` | `createPiHostModule`, `definePiApplicationModule`, `createPiApplicationHost`, `readTaskInput`, `readArtifactFile`; adapter types |

The package includes TypeScript declarations for editor assistance, but the steps
here do not depend on reading them. Import from these public specifiers. An adapter
is trusted local code; its descriptor is data. Neither is obtained automatically
by installing a native plugin.

## Application module

Export `application` (required), `nativeHost` (for CLI native execution) and optionally
`validateTaskInput`. The native tutorial contains a complete declaration.

| Field | Contract |
| --- | --- |
| `application.id`, `version` | Nonempty identifiers/version strings for this application's definition |
| `runtime` | `{ id: 'pi', version: '0.85.1' }` for the pinned Pi example; runtime version must match the selected SDK |
| `plugins` | Array of Plugin descriptors |
| `profiles` | Array of Session Profiles |
| `nativeHost` | Exported string, e.g. `'./host.mjs'`, relative to the Application file; not a field inside `application` |
| `validateTaskInput(value)` | Optional exported function, sync or async; throw to reject `--input`. Called with `undefined` if omitted. Its returned value does not normalize the saved input. |

A Plugin descriptor has `id`, `role` (`domain` or `aspect`),
`native: { runtime: 'pi', binding_key: 'text' }`, `capabilities: []`, and
`produces: [{ type: 'text.result', version: '1' }]`. Use `produces: []` if it publishes
nothing. The `id` identifies the Plugin within this Application; `binding_key`
selects a registration in the Host. Neither field is an npm package name unless
the application deliberately chooses that spelling.

A Profile has `id`, optional `primary` (Plugin ID), `aspects` (Plugin IDs), optional
Task-relative `workspace` (default `'.'`), and `requirements` (array). The Pi application
Host requires a primary domain adapter. Each Session runs only the selected Profile.
An aspect is not another primary. A Profile never describes execution order.

For Agent Invoke, provide an `entry` with:

| Field | Contract |
| --- | --- |
| `id`, `purpose` | Callable entry ID and its purpose; use the entry ID, not the Profile ID, in Agent requests |
| `implementation` | `'native'` or `'synthetic'`; do not label a fake SDK native |
| `effect_declarations` | Array of descriptive strings, e.g. `['task-files-write', 'model-request']`; not enforced permissions |
| `request_mapping` | `'v1'` if the adapter handles instruction/data; also opt in on the primary registration |
| `data_schema`, `data_required`, `data_examples` | Optional bounded JSON Schema contract, required-data flag and valid example values |
| `name`, `tags`, `examples` | Optional discovery metadata |
| `acceptance_artifacts` | Optional `{ type, version, producer_plugin_id }[]` matching selected Plugins' declared outputs; exposes references, not a business verdict |

Schema syntax and unsupported features are documented in
[Business parameters](AGENT_GUIDE.md#business-parameters-before-native-startup).
An entry with `data_required: true` must use Invoke with data; request-free
`session start` cannot supply it.

## Host module and registrations

`createPiHostModule(options)` returns **both** `createSessionHost` and
`validateNativeApplication`. Export both from your Host file for CLI execution
and native preflight. The helper does not choose a model or provide adapters.

```ts
type HostOptions = {
  sdk: unknown;                         // the actual imported Pi SDK
  sdkVersion: string;                    // its installed VERSION
  preflightDirectory: string;            // absolute local directory
  adapters: Record<string, Registration>; // keys match native.binding_key
  configure(context: { store: LocalTaskStore }):
    { settings: Record<string, unknown>; modelRuntime: unknown } |
    Promise<{ settings: Record<string, unknown>; modelRuntime: unknown }>;
  checkLauncher?(): Promise<void>;        // optional, no domain/model execution
};
type Registration = {
  entry: string;                         // absolute native extension file
  prompt_paths?: readonly string[];       // absolute template directories
  request_mapping?: 'v1';
  create?(context: { store: LocalTaskStore; plan: SessionPlan }):
    AdapterHooks | Promise<AdapterHooks>;
};
```

These are signature summaries, not a separate package to import. Primary
registrations require `create`, which must return `initialize` and `run`.
An aspect can register only its native entry when native event hooks suffice.
Use its `create` factory if an explicit `afterRun` phase is also needed.

`configure` and the selected factories run at launch, not during definition
validation or native preflight. Put per-Session mutable state in the factory closure.
The factory receives a detached plan. Its hooks cannot replace the registered entry
file; that same file is used for preflight and execution.

Native preflight verifies SDK surface/version, registrations, entry files, prompt
directories and exact extension loading. It returns SDK/binding/resource/launcher
statuses. It does **not** call `configure`, adapter factories, `createAgentSession`
or domain hooks. Native module loading can have plugin-defined side effects.

`configure` returns settings and a Pi `ModelRuntime`, not a provider name alone.
The [native tutorial](NATIVE_INTEGRATION.md#runtime-configuration) gives a complete
default-model implementation. The bridge disables global extension/skill discovery
and uses only the Profile's registered resources. Plugin-specific configuration
and subprocess behavior remain the adapter's responsibility.

## Hook arguments and return values

```ts
type AdapterHooks = {
  initialize?(context: Context, artifacts: readonly ArtifactRef[]): Promise<void>;
  run?(session: PiSession, context: Context): Promise<readonly Publication[]>;
  afterRun?(session: PiSession, context: Context,
            outcome: 'completed' | 'failed'): Promise<readonly Publication[]>;
};
type Publication = {
  type: string;
  version: string;
  path: string;                  // existing file, relative to Task root
  verification_status: string;   // domain-assigned, e.g. READY or COMPLETED
};
```

| Context field | Meaning |
| --- | --- |
| `task_id`, `task_root` | Active Task ID and absolute root |
| `session_id` | Loom Session ID; not the native Pi Session ID |
| `workspace` | Absolute resolved directory for this Profile within the Task |
| `plan.profile_id`, `primary_plugin_id`, `aspect_plugin_ids`, `plugin_ids` | Selected composition |
| `plan.artifacts` | Exact resolved input references for this launch |
| `plan.named_artifacts` | Optional map from requirement `input_name` to selected reference |
| `request` | Optional Agent request, only for adapters that opted into mapping |

An Artifact reference includes `id`, `task_id`, `type`, `version`, `producer`
(Plugin/Session identity), `verification.status`, `payload_ref` and `sha256`.
File payloads use `{ kind: 'file', path }`, relative to the Task root.
Do not generate replacement reference objects or resolve a different artifact
inside initialization. Use the references supplied by the active plan.

The primary initializer runs **before native extension loading and model execution**.
It validates inputs and prepares explicit domain context, including creating any
workspace directories it will write to. After the entire
initialization succeeds, Core records consumption. Throwing rejects initialization
and prevents `run`. Successful resolution by itself never records consumption.

`run` is where the adapter invokes the native plugin's documented tool, command or
API and validates its result. With the pinned real Pi SDK, `session` is a Pi
AgentSession, with `prompt`, `abort`, `subscribe`, `getAllTools`,
`setActiveToolsByName`, `messages`, `sessionFile` and `extensionRunner` available.
Loom's minimal `PiSession` TypeScript interface describes only the bridge surface;
an adapter using additional methods must narrow to the pinned SDK's `AgentSession`
type and validate its required features. Other SDK versions are not inferred compatible.

After domain execution, the Host calls each implemented aspect `afterRun` in the
Profile's aspect order, passing domain `outcome`. It runs before native shutdown,
including after a domain run failure, but not after initialization/load failure.
Its returned files belong to that aspect. An aspect execution/validation failure
is recorded separately; required governance storage failure remains fatal.
Aspects do not receive request payloads unless their registration opts in.

Return an empty array for no publication. Do not return `{ status: 'completed' }`
from a Pi application adapter's `run`: that shape belongs to the lower-level
`NativeSessionHandle`, not this adapter API. Do not assign Artifact IDs, producer
identities, digests or consumer records: the Pi Host and Core derive those facts.
The returned file must already exist inside the Task and match a declared output.

## Cross-Session inputs

A consumer Profile declares, for example:

```js
requirements: [{ input_name: 'source', type: 'text.result', version: '1',
  verification_status: 'READY' }]
```

The caller selects the source's ID from the producing receipt or Inspect and sets
`request.inputs.source = { artifact_id: selectedId }`. With no explicit selection,
one matching candidate can resolve; zero gives `PreconditionNotSatisfied`, multiple
give `BindingConflict`. Neither schedules a producer.

In a factory closure, accept the named reference during initialization:

```js
let accepted;
async function initialize(context) {
  const source = context.plan.named_artifacts?.source;
  if (!source) throw new Error('Named source is required');
  accepted = await readArtifactFile(context, source,
    { input_name: 'source', type: 'text.result', version: '1',
      verification_status: 'READY', producer_plugin_id: 'text-domain' },
    bytes => {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (typeof value.input !== 'string' || value.normalized !== value.input.toUpperCase())
        throw new Error('Invalid text result');
      return value;
    });
}
```

Import `readArtifactFile` from `agent-loom/runtime-pi`. The complete native example's
producer emits this contract. Carry `accepted` into your consumer's `run` as explicit
domain input; do not reopen a file without checking it again. This snippet defines
an input validator, not an already implemented consumer plugin.

`readArtifactFile(context, ref, requirement, verify)` returns the value returned by
`verify(bytes, ref)`, which may be async. It checks exact selection, Task and optional
producer identity, type/version/status, real file containment and SHA-256 before
calling the domain verifier. It does not select, publish, or mark consumption.
For inline payloads, implement the domain's explicit inline validation policy.

For the separate CLI Task input snapshot, use
`await readTaskInput(store, parse)`; `parse(value)` returns a checked domain value
or throws. Task input, per-Invoke `request.data`, instruction text and upstream
Artifact references are four distinct input channels. Do not silently interchange them.

## Plugin-specific behavior is an explicit contract

For **any** plugin, document these before claiming that its adapter is usable:

- Package/version, native entry and additional resource directories.
- Native tools or commands invoked, required arguments and output schemas.
- Initialization acceptance criteria and the exact supplied domain context.
- Successful and failed result criteria, output locations and publication status.
- Configuration, authentication, network access and timeout/cancellation behavior.
- Native event hooks or explicit aspect trigger, input scope and evidence.
- If it starts a subprocess: executable resolution on the supported OS, inherited
  model/configuration, output capture, completion and failure handling.

These vary by plugin. The framework exposes a stable place to implement them;
it cannot invent undocumented native contracts. A built-in event hook, an
`afterRun` callback and a separate CLI subprocess are different integration modes.
Do not treat one successful callback as proof that all three were exercised.
