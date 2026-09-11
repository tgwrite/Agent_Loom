# Pi Runtime boundary

Application users: start with the [user manual](../../manual/README.md),
[complete native tutorial](../../manual/NATIVE_INTEGRATION.md) and
[adapter API reference](../../manual/ADAPTER_API.md). This page describes the
implementation boundary, not the application installation sequence.

The host accepts an explicitly supplied Pi SDK and native entry bindings. It loads
only the selected Profile's plugins, initializes domain inputs before native
discovery, and closes Pi before Core settles the Session. The current native tests
pin Pi 0.85.1; other versions and complete product acceptance remain unverified.

`createPiApplicationHost` binds reusable adapters through Application
`native.binding_key` values. Domain adapters implement `initialize` and `run`.
Aspects may implement `afterRun(session, context, outcome)` to invoke an explicit
native command or collect native publications after domain execution. This phase
runs before shutdown, including after domain execution failure. It does not replace
Pi's own event lifecycle or introduce scheduling. Native load and domain
initialization failures do not enter this phase.

Publication facts contain a declared type/version, Task-relative file path and
native verification status. The host derives Plugin, Session, Actor and Runtime
identities, checks containment and hashes existing bytes. It does not generate
domain or review content. Native extension errors retain their bound Plugin and a
safe event phase; raw prompts, native diagnostics and stack traces stay outside Core.

Aspect execution and validation errors are recorded as `observer.failed` without
failing the primary domain. A failure to persist required governance remains fatal.
Host observations and publications share a write queue, drained before terminal
settlement. This is not a multi-process lock or crash-recovery mechanism: callers
still must serialize Task writers.

The SDK bridge tests are synthetic. The optional `test/composite` experiment runs
real native plugins with deterministic model responses and measures a specific
composition. It does not establish automatic checkpoint/compaction compatibility,
filesystem security isolation, normal interactive usage or complete v0.1 acceptance.


In alpha.3, `createPiHostModule` delays configure and adapter factories until a
selected Profile launches. `createPiApplicationHost` also reads only selected
adapter bindings and creates a Session-scoped governance writer. The new
`definePiApplicationModule` pairs each descriptor with its registration.

Primary adapters opting into `request_mapping: 'v1'` receive `context.request` and
`context.plan.named_artifacts`. Aspect factories and hooks receive request data
only when their registration explicitly opts in. Mapping is cooperative adapter
behavior, not a same-process sandbox. Safe registered diagnostics are preserved
through the native boundary; ordinary native error text remains hidden.

Alpha.5 preflight returns separate SDK, binding, resource and launcher statuses.
An optional `checkLauncher()` callback runs only during explicit native preflight;
configuration, models and credentials remain unchecked. Failures retain reviewed
stage codes and fixed next steps without native paths or raw diagnostics.

The application host also records the Runtime-independent participant observation
contract for domain completion and explicit aspect phases. Receipts can distinguish
these phase reports from Session settlement and business-acceptance evidence.
See the Agent guide for optional `writer_policy: 'exclusive'`: all mutating clients
must cooperate, and direct Store or legacy Session calls do not acquire that lock.
