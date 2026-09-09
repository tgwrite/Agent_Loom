# Pi Runtime boundary

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
