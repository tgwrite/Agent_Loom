# Fifth-plugin infrastructure reuse experiment

Baseline: `44fd7f2`. This experiment tests whether the existing `afterRun`, aspect
publication and failure-attribution interfaces can accept one more native aspect
without changing Core, Pi Runtime, CLI or any existing integration.

It extends the four-plugin Application with `session-audit`, a test-local native
Pi extension. Each business Session loads one domain and three aspects. Audit
registers a native `session_start` hook and `session-audit` command, reads Pi's
current branch and writes a JSON summary. It can also fail independently.

The plugin has no Loom imports, identities, contracts, registry, event persistence
or SHA calculation. Its summary contains a native Pi Session ID, structural message
counts and a caller-reported execution outcome. That outcome is not an independently
verified quality verdict. The adapter invokes the command and returns file facts;
the unchanged Loom Host supplies provenance, hashing, indexing and settlement.

This deliberately small plugin tests one interface shape. It is not an external
marketplace compatibility result. Original business and review model responses
remain deterministic; the new audit makes no model requests. No actual LLM
reasoning or review quality is evaluated.

## Run

Use the prerequisites from `../composite/README.md`: Windows, Node 24.15 or newer,
the local Pi 0.85.1 dependencies and the Windows C# compiler used by the review
launcher. No additional package installation or global Pi change is needed.

```sh
npm ci
npm ci --prefix test/lightweight
npm ci --prefix test/composite --legacy-peer-deps --ignore-scripts
npm run build
node test/reuse/probe.mjs
node test/reuse/run.mjs --smoke
node test/reuse/run.mjs
```

The standalone probe loads the audit through the real Pi API without a Loom store.
The smoke case runs one normal Loom Task. The full experiment runs seven cases in
two actual orders for Loom and the original control, followed by two targeted
checks of a minimally repaired control lifecycle.

## Hypotheses and freeze

`freeze.mjs` checks the working tree against `44fd7f2`, including staged changes,
committed changes and new untracked files under these protected directories:

```text
packages/container-core/
packages/runtime-pi/
packages/cli/
test/lightweight/
test/composite/
```

The check runs before each Task and after the matrix. Native dependency package
fingerprints, the new audit source and global Pi configuration are checked before
and after execution. A frozen-path change rejects the experiment as a Primitive
Gap; fixing production code and still claiming zero infrastructure changes is not
allowed. A future source revision outside this freeze is a different experiment.

H1 and H2 require zero production and existing-integration changes. H3 requires
the new adapter to inherit governance, not reimplement it. H4 has two separate
questions: whether Loom's marginal shared code falls to zero, and whether the
control still needs new governance. The latter is an observation, not a required
positive result. A generic control may also reuse its prior code.

## Scenarios

| Case | Required observation |
| --- | --- |
| normal | Two business, four review and two audit artifacts; both Sessions complete |
| audit-failure | Native audit command throws; audit failures recorded; business and reviews succeed |
| invalid-escape | Adapter publication path is changed to an escaping path; no audit indexed |
| invalid-contract | Adapter publication type is changed to an undeclared type; no audit indexed |
| invalid-missing | Adapter publication points to a missing file; no audit indexed |
| review-failure | Native review provider fails; audit still publishes; business completes |
| domain-failure | Existing native export failure fixture; report Session fails, audit receives `failed` and publishes |

Invalid-publication cases modify returned facts in the shared test setup after
the native audit wrote a valid file. They exercise Host validation, not native
file generation. Neither the driver nor that setup writes Loom governance state.

Order A is telemetry, review, audit. Order B is audit, review, telemetry. Tests
check actual Pi extension paths and semantic outcomes. Raw audit message counts
can differ: the unchanged prior review instrumentation adds a continuation turn,
so audit observes a different branch length before versus after that test turn.
This is not an ordering failure or a reason to introduce an ordering primitive.

Normal operator actions remain create, fetch start, report start and inspect.
There are no audit-path, audit-plugin, audit-output or ordering CLI parameters.
Additional human-readable inspect calls in the harness are acceptance assertions,
not new required business steps.

## Fair control and lifecycle gap

`control-baseline.mjs` runs the frozen previous control module with only its setup
import redirected to the shared five-plugin setup. This is adapter registration
wiring; the original resolver, failure handling, publication and inspection code
are not edited. It is tested across all fourteen scenarios.

The original control source skips all aspects when domain execution throws. The
runner explicitly checks and reports that gap in both orders, rather than calling
it a passing audit-on-failure scenario. `control.mjs` is a copy with a minimal
generic outcome-handling repair. Only those two gap cases are rerun against it.
This cost is recorded as repair of pre-existing lifecycle coverage, not a cost that
every new plugin intrinsically imposes. Common normal and aspect-failure scenarios
can demonstrate zero governance changes in both implementations.

## Evidence

Raw data is retained under ignored `.test-tmp/reuse/`: command output, native
reports, JSON inspections, model requests, freeze results and source fingerprints.
The full summary distinguishes passed Loom gates, successful control cases,
observed original-control gaps and repaired-control cases. Do not flatten these
into a claim that all original-control cases passed.

The reusable publication protocol is in [HANDOFF.md](HANDOFF.md). This experiment
does not establish a security sandbox, actual LLM analysis, compaction/checkpoint
compatibility, interactive Pi acceptance or complete v0.1 product acceptance.
Observed gate results and the comparative change ledger are in [RESULT.md](RESULT.md).
