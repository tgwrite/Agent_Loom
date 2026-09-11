# Inspect results and diagnose an integration

Use the same project-local Loom version and explicit Task root throughout. Follow
[Getting started](START_HERE.md) for the command sequence and the
[API reference](ADAPTER_API.md) for fields. Diagnose the first failed layer; do not
substitute an unrelated demo or relabel partial execution as complete integration.

## Identify the layer

| Observation | Meaning and next step |
| --- | --- |
| Wrong CLI version | Use `npx --no-install loom --version` from the application project; check the local dependency before testing APIs |
| `InvalidDefinition` | Inspect `error.details.path` and `rule`; check named exports, required entry fields, roles and matching binding keys |
| Host import/export readiness failure | Check the saved Host location, native dependencies and `createSessionHost` / `validateNativeApplication` exports |
| SDK, entry or resource readiness failure | Match the pinned Pi version and each documented native entry/resource; do not disable a check |
| Preflight passes, Invoke fails before domain execution | Model configuration, authentication or adapter factories may still be untested; preflight did not call them |
| `MISSING_DEPENDENCY` / `PreconditionNotSatisfied` | Produce or select a verified Artifact in this Task explicitly; no producer will be scheduled |
| `AMBIGUOUS_BINDING` / `BindingConflict` | Select the intended artifact ID and bind it through the requirement's input name |
| Task creation says name already registered | Use a fresh Task name or the intended project-local `LOOM_STATE_DIR`; another root alone does not bypass the locator index |
| `REQUEST_REJECTED` / `InvalidArguments` | Check the Describe schema, Task/entry IDs, named input keys and supported instruction/data mapping |
| Input digest, location or contract diagnostic | Inspect the chosen reference and bytes; do not replace it with a newer file or mark it READY manually |
| Domain execution fails | Inspect the adapter's domain criteria and local native diagnostics; final model prose alone is not tool success |
| Primary completes, aspect fails or is unobserved | Inspect the specific plugin's output and phase; primary success does not prove aspect success |
| `TASK_WRITER_BUSY` | A writer or retained uncertain attempt owns the Task; inspect and reconcile before another write |
| `TASK_OUTCOME_UNCONFIRMED` / `OUTCOME_UNCONFIRMED` | Existing evidence cannot confirm the prior outcome; do not assume a stored running Session is alive or safe to retry |
| Governance storage failure | Preserve evidence; partial writes can leave an unknown outcome. Do not edit Session/Event/Artifact records to force success |

Request/definition errors generally go to stderr with exit code 1. Agent Check
blockers and Invoke receipts use stdout and return exit code 1 for blocked/noncompleted
execution. Successful commands use stdout. Capture both streams separately; do not
parse only stderr and conclude that an empty stream means success.

## Inspect without invoking again

For the Task created in the native tutorial:

```sh
npx --no-install loom agent inspect --task text-task --root ./text-task --json
npx --no-install loom task inspect text-task --root ./text-task --summary --json
```

Agent inspection projects outcomes, selected/consumed inputs, artifacts and aspect
observations. The summary provides output paths. Use full legacy
`task inspect text-task --root ./text-task --json` only when detailed local records
are needed; it can include request content. These commands do not retry a Session.

## Read each fact separately

| Fact | What to verify |
| --- | --- |
| `execution.status` | Confirmed completion/failure versus `unknown`; a persisted record is not a liveness probe |
| `observation.history` | `not-checked` means no read was attempted; `unreadable` means an attempted read/validation failed |
| `observation.outcome_confirmed` | Whether terminal evidence is consistent; do not infer confirmation from a filename |
| `resolved_inputs` | What was selected for initialization, not proof of successful consumption |
| `consumed` | The accepted artifact ID/digest and producer/consumer identity after initialization succeeded |
| `artifacts` | Indexed outputs with provenance; open the exact referenced Task-relative file for domain validation |
| `participants` / `aspect_failures` | Domain and aspect observations can differ; `not-observed` is not success |
| `business_acceptance` | Remains `not-evaluated`; application-defined references are evidence to inspect, not a Loom verdict |

Publication status such as READY or COMPLETED is assigned by the domain adapter.
The framework checks provenance and files, not arbitrary business claims. Validate
all required outputs using their respective plugin contracts.

## Diagnostics and summary additions in alpha.7

The fields in this section are available in alpha.7. Existing alpha.6 installations
and historical records may omit
them; absence does not establish a phase or a Plugin origin.

Safe `diagnostic.phase` identifies the Host operation that failed:
`host-validation`, `host-launch`, `configuration`, `adapter-creation`,
`initialization`, `resource-loading`, `session-creation`, `extension-binding`,
`domain-run`, `publication`, `shutdown`, `finalization` or `disposal`.
It is separate from the CLI's outer command phase and from a native lifecycle
event name. `diagnostic.check` continues to identify a native readiness check.
`diagnostic.plugin_id`, when present, identifies a known Plugin binding; an unknown
origin stays absent. A runtime failure is not automatically an aspect failure.
Raw native messages, paths and stacks are not copied into these fields.

For example, a native command can report an error through Pi's extension error
callback while the adapter returns its publications. The domain phase can then be
`completed`, but the Session is `failed`. Its diagnostic can be
`NATIVE_EXTENSION_FAILED` with `phase: domain-run`; the phase describes where Loom
observed the failure, not a claim that the model or every native tool failed.
If shutdown throws after a successful domain phase, the diagnostic instead
identifies `shutdown`. Inspect `execution`, `participants` and `diagnostic` together.
A later disposal error does not replace an earlier shutdown error; required
governance storage failure remains fatal.

`task inspect --summary --json` now includes each Session's `execution`,
`observation`, `participants`, `diagnostic` and `business_acceptance` references,
using the same projection as Agent Inspect. The existing `status` field remains
the stored status for compatibility: use `execution.status` and
`observation.outcome_confirmed` when assessing the outcome. Text summaries show
an unconfirmed outcome as `unknown`, even if the stored status is `completed`.

Summary outputs include their recorded `sha256` alongside `payload_ref`, producer
and native provenance. Consumption rows include their record ID, consumer Session,
consumer Plugin and timestamp. This lets an application locate the exact output,
hash its current bytes and compare it with the publication and accepted input
digest. Inspection reports recorded evidence; it does not rehash payload files or
perform business verification. These queries do not invoke a Session.

## Retrying and upgrading

A repeated request ID starts a new attempt; it is not an idempotency key. Repeated
`session start` also creates a Session. A timeout does not establish that external
effects stopped. Inspect before retrying; a retained lock is never expired by Loom.
Only after stopping writers and reconciling effects should an operator consider
manual lock removal. Removing the lock alone does not settle an unknown Session.

Tasks retain Application snapshots. Use a fresh Task for a changed definition;
do not rewrite a Task's stored definition to make new code fit. A snapshot does not
freeze the executable Host or npm dependencies, so pin and retain them with the
application. Read version compatibility notes before changing an existing install.

## Report an actionable documentation blocker

Record the installed version, documentation page/section, exact command, last
successful layer, exit code and safe diagnostic fields. State the missing contract:
for example entry resolution, callback arguments, result schema, credential setup
or evidence path. Distinguish “not documented”, “not read yet”, “not supported” and
“executed and failed”. Keep raw credentials, local paths, transcripts and business
data in local records rather than public reports.
