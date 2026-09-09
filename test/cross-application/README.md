# Cross-Application semantic ownership experiment

This experiment uses three different applications to test whether governance
semantics can be upgraded in one shared implementation. The baseline is `366d110`.
It permits an equally shared no-Loom control; independent control copies per
application are not required or introduced.

| App | Native domain plugins | Sessions | Handoffs |
| --- | --- | ---: | ---: |
| A | Existing HTTP utility and artifact exporter | 2 | 1 |
| B | `@artale/pi-json@1.1.0` | 1 | 0 |
| C | `pi-web-utils@0.1.1`, `@trycedar/pi-mdiff@0.4.0`, `pi-markdown-preview@0.16.0` | 3 | 2 |

Each Session also loads the existing telemetry, conversation review and session
audit aspects. A's Application and adapters are reused unchanged. B queries a
local JSON fixture. C captures a synthetic page, edits its Status paragraph and
exports HTML. The domain packages differ between applications; shared scripted
model and observation code is experimental infrastructure, not business logic.

The candidates were found through the Pi package directory and checked against
their published source. `pi-mdiff` was deprecated in favor of the scoped package.
The JSON plugin needs a small legacy-call compatibility entry. Preview needs native
theme initialization and Pandoc. These are counted as onboarding costs, not Loom
governance savings. Plugin source remains unchanged.

## Local requirements

Windows, Node 24.15 or newer, Pi 0.85.1 and the prerequisites of
`../composite/README.md` are required. Install dependencies only in test directories:

```sh
npm ci
npm ci --prefix test/lightweight
npm ci --prefix test/composite --legacy-peer-deps --ignore-scripts
npm ci --prefix test/cross-application --legacy-peer-deps --ignore-scripts
npm run build
```

Set `PANDOC_PATH` to a real local Pandoc executable; the recorded experiment uses
the official portable 3.11 release. No global plugin or settings change is needed.
The native HTML exporter writes files with `open: false`. PDF, browser interaction
and screenshots are not part of the experiment.

## Verify the current implementation

```sh
node test/cross-application/run.mjs --phase=verify --smoke
node test/cross-application/run.mjs --phase=verify
```

Verification runs the final V2 assertions without requiring local historical
checkpoints. It cannot recreate or claim the earlier migration/freeze evidence.
The full mode runs thirty Task cases; smoke runs three normal Loom Tasks.

## Sequential migration experiment

```sh
node test/cross-application/run.mjs --phase=a --smoke
node test/cross-application/run.mjs --phase=a
node test/cross-application/run.mjs --phase=m1
node test/cross-application/run.mjs --phase=m2
```

These commands describe an ordered development experiment, not three interchangeable
switches on the final source. Phase A must run before production changes. M1 follows
the observer-contract migration; M2 follows the provenance migration. Each full
phase saves an ignored checkpoint. Later phases require the previous checkpoint
and identical business integration hashes. Smoke output never satisfies that gate.
The final source therefore cannot honestly rerun the production-frozen A phase.
The first migration is preserved as commit `55c066e`. Reconstructing the original
sequence requires an isolated checkout with the corresponding production/control
source at each stage; do not overwrite an active development checkout to do this.

Phase A checks all three applications in both arms with no Core, Runtime, CLI or
previous-integration changes. Each migration runs normal execution, native-hook
failure, afterRun failure, invalid aspect publication and domain failure followed
by aspect execution across all three applications and both arms.

`control.mjs` starts from the previous generic, lifecycle-repaired control. All
three applications share that single module. This is a scoped experimental
comparator; it is not claimed to match every validation, storage or migration
guarantee in the production Loom implementation.

## Evidence and interpretation

The CLI driver never imports Core or writes governance records. Independent child
processes create, start and inspect Tasks. It checks native outputs, provenance,
handoffs, failures, final settlement, review isolation and unchanged native/global
configuration fingerprints. Raw data and checkpoint files stay under ignored
`.test-tmp/cross-application/`.

Economic accounting separates semantic owners, implementation/contract/compatibility
review files, logical migration patch groups, shared regressions, application
compatibility runs and shared code changes. Shared control is allowed to tie Loom.
No measured human review time or long-term economic curve is inferred from LOC.

Pi, plugins, tools, HTTP, local review-provider requests and files execute normally.
Model responses are deterministic fixtures. No real LLM reasoning, quality,
performance, security sandbox or complete v0.1 acceptance is established here.

See [HANDOFF.md](HANDOFF.md) for native domain contracts and
[MIGRATIONS.md](MIGRATIONS.md) for failure/provenance compatibility semantics.
The measured outcomes and comparative ledger are in [RESULT.md](RESULT.md).
