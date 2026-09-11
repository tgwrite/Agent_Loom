# Four-Plugin governance experiment

This is a contributor experiment, not a reusable adapter distribution or an
application onboarding guide. For general application development without reading
test implementations, use the [user manual](../../manual/README.md).

This optional experiment adds a native conversation review aspect to the existing
web task. The question is whether Loom absorbs composition, provenance and failure
bookkeeping while existing domain and telemetry adapters stay unchanged.

| Native package | Version | Role |
| --- | --- | --- |
| pi-http-util | 2.0.5 | Fetch Session primary |
| @jakeryderv/pi-artifacts | 0.11.0 | Report Session primary; consumes web.source |
| @spences10/pi-telemetry | 0.0.33 | Aspect in both Sessions |
| pi-conversation-retro | 0.2.0 | Explicit review aspect in both Sessions |

All four native plugin sources remain unmodified. The three existing adapters,
runtime setup, model decisions and Handoff logic are reused from `../lightweight`.
The new Application adds an aspect to each Profile and declares its two contracts.
Loom's Application Host invokes an optional aspect `afterRun` phase, records errors
and registers adapter-reported native files with the bound producer identity.

## Run

Use Node 24.15 or newer and Windows with the .NET Framework C# compiler. The current
composite runner requires Windows because it verifies export-store isolation through
the child process's profile environment. Other platforms are not yet validated.

```sh
npm ci
npm ci --prefix test/lightweight
npm ci --prefix test/composite --legacy-peer-deps --ignore-scripts
npm run build
node test/composite/probe.mjs
npm run test:composite
```

Neither `test:composite` nor direct `run.mjs` builds the CLI automatically. Both
check for its build output before starting fixture services and report
`npm run build` when it is missing. `probe.mjs` checks native prerequisites;
`run.mjs --smoke` runs one normal case; the default runner executes the full matrix.
Command failures retain their stderr in local diagnostics. Provider and fixture
cleanup runs even when Task creation or diagnostic persistence fails. Review
request logs are saved in the experiment root, including when no Task was created.

`node test/composite/run.mjs --smoke` runs only the normal forward-order Loom case.
No global Pi installation is used or changed. The extra package is test-local;
its older Pi peer dependencies are not installed because its only SDK reference
is an erased type import. Actual runtime compatibility must pass the probe.
Native entries are supplied explicitly at Session startup. The local launcher
maps the review plugin's literal `spawn("pi")` to the pinned Pi 0.85.1 CLI and
forwards its stdout/stderr. It does not synthesize reports or implement review.

The runner serves a small local page and a deterministic local model endpoint.
Original domain model decisions are scripted. Native HTTP conversion, artifact
export, telemetry hooks, review command, Pi child processes, log read tool and
Markdown file writes execute normally. A successful review uses three local model
requests: request a log read, produce its review, synthesize improvements. There
are no commercial model requests. This does not assess review or summary quality.
The fixture includes Chinese text and non-ASCII punctuation. The Windows launcher
uses explicit UTF-8 on both streams, and indexed native review files are checked
for exact transport of that text. A passing digest alone is not an encoding check.

## Pass conditions

The full matrix is four fault combinations (none, telemetry, review, both), two
actual load orders and two arms (Loom, no-Loom control): 16 Task cases and 32
independent business Sessions. Every start is a fresh process from an unrelated
operator directory, selected by Task and Profile.

| Value under examination | Required evidence |
| --- | --- |
| Adding an aspect without editing existing plugins | Unchanged existing adapter fingerprints and native source hashes; change ledger |
| Correct ownership | Every native review has the review Plugin, current Task/Session, actual Actor/Runtime and matching file hash |
| Independent failures | Both fault origins recorded independently; business Session completes and source consumption remains valid |
| Scoped inputs | One projected native log per review; actual provider tool result matches the current native Session; other Session/Task canaries absent |
| Main context unchanged | Compare history, active tools and system prompt before/after review; inspect a subsequent real provider input |
| Stable composition | Check actual Pi extension paths in both orders and identical semantic assertions |
| Understand governance cost | Same native adapters in the control, separately count control changes, generic Host changes and experimental infrastructure |

Each normal Task has two business artifacts and four native review artifacts, with
exactly one business consumption. Review failure leaves two business artifacts and
no successful review artifacts. No review is a required business input. The adapter
requires a new output directory, the expected source header and both native output
files; a return without those files is failure, including errors swallowed by the
native command. The mutable `latest` alias is checked but never indexed.

Each Session has one extra deterministic continuation for context inspection. Thus
telemetry sees four completed agent runs across two business Sessions. This extra
turn is an assertion aid, not another Loom Session or a business workflow step.

Loom alone writes its registry, lineage, observer failures and terminal Session
records. `run.mjs` performs CLI calls and assertions only. `retro-adapter.mjs` binds
the current log and validates native output; it has no Core imports or governance
store. `setup.mjs` adds the same observational instrumentation in both arms.
`control.mjs` is deliberately an experimental custom governance implementation.
If both arms pass, the result demonstrates ownership and measured change cost;
it does not prove that the task is impossible without Loom or that Loom is faster.

## Evidence and limits

Full logs, provider inputs, stdout/stderr, reports and command timings go under
ignored `.test-tmp/composite/`. The runner checks global Pi settings/auth/model and
telemetry configuration fingerprints without logging their values. Exporter files
are confined to the experiment's child profile. No real webpage is needed for the
governance matrix; expensive reference work is independent of this experiment.

Pi provides the native hook fan-out, native hook exception handling and isolated
review subprocess. Loom provides binding, durable attribution, publication metadata
and settlement. The adapter supplies a scoped input projection because this plugin
normally discovers historical logs. These are cooperative scope guarantees, not
a filesystem security sandbox: the native reviewer still has tools including bash.

The native review is command-triggered, not an automatic checkpoint observer.
Compaction, checkpoint callback ordering, timeout/late-result behavior, interactive
Pi and complete v0.1 product acceptance are not covered by this matrix.
See [HANDOFF.md](HANDOFF.md) for the reusable review contracts.
The observed results and change-cost ledger are in [RESULT.md](RESULT.md).
