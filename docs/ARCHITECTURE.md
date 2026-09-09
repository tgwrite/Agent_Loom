# Architecture

## Responsibility boundaries

`container-core` defines Application, Task, Session Run, Actor, Capability, Artifact,
Event, context, failure, and Runtime contracts. It imports no Pi APIs or domain code.
Its local store owns governance metadata only.

`runtime-pi` will translate the minimal required Pi Host surface and lifecycle events.
The package currently exports the proposed reference target and configuration types.
It is not yet a working Pi extension or Runtime implementation.

`adapters` currently describes the reference Plugin roles. Native loading bindings
must be supplied locally at runtime. Real publication discovery, initialization, and
verification hooks require the Phase 0 evidence before they can be implemented.

```text
Application + Session Profile
              |
       Task governance
       /             \
Session Run A      Session Run B
       |             |
       +-- Artifact -+
              |
       existing payload file
```

The Artifact edge carries a dependency, not a scheduling instruction. Ambiguous
matches fail instead of silently selecting the newest Artifact. An explicit Artifact
ID may disambiguate a requirement.

## Current local store

```text
.agent-container/
  task.json
  artifacts.jsonl
  sessions/
    <session-id>/
      session.json
      events.jsonl
  invocations/
```

Task identity is immutable after creation. Sessions transition from running to
completed or failed exactly once. Artifact publication checks Task, Session, Plugin,
and executor provenance, and records supplied verification metadata. It does not
interpret domain proofs or revalidate payloads. Resolution returns the original
reference and digest; a domain consumer must still perform its own trust checks.

File payload references are relative to the Task root in this first foundation.
Files outside that root are unsupported at present; Phase 0 must establish whether
real Plugin integration needs a wider reference mechanism. No payload files are copied.

The first store uses one writer per Task; callers must serialize mutations, including
within one process. JSON replacement uses a temporary sibling file and rename.
JSONL append is not a multi-file transaction. Corrupt records fail
closed as `StorageFailure`; there is no automatic repair, locking, or crash recovery.
Symlink-resistant filesystem confinement and hostile Task directories are out of
scope; use a trusted local Task root. Runtime logs may contain sensitive information
and are excluded from public version control.

## Context and failures

Core persistence does not invoke a model or mutate Agent Context. Runtime contracts
separate Plugin private state, explicit effects, and isolated completion with no
tools. Their real enforcement, observer containment, and guard preservation remain
Phase 2 and Phase 6 acceptance work.
