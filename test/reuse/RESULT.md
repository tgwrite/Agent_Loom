# Fifth-plugin reuse result

The experiment completed on Windows with Pi 0.85.1. The frozen baseline is
`44fd7f2`. The fifth plugin is an independent test-local native session auditor,
not a marketplace plugin. Business and review responses are deterministic test
responses; no real LLM inference was performed.

## Results

| Arm | Cases | Passed | Unmet requirements |
| --- | ---: | ---: | ---: |
| Loom, unchanged shared infrastructure | 14 | 14 | 0 |
| Original control, new adapter binding only | 14 | 12 | 2 |
| Control with minimal lifecycle repair | 2 targeted reruns | 2 | 0 |

There were 30 Task cases, 60 business Sessions, 134 driver commands and 158 local
review-model HTTP requests. Audit made no model requests. The two original-control
gaps are observed unmet requirements, not passing audit-on-domain-failure cases.

Both representative orders were tested for normal execution, native audit failure,
escaping publication path, undeclared publication contract, missing publication
file, existing review failure and domain execution failure.

Loom passed all six gates: production freeze, existing-integration freeze, inherited
governance, failure independence, stable operator steps and load-order behavior.
The 64 protected tracked files match the baseline. Existing native package trees
and global Pi configuration fingerprints remained unchanged during the run.

Normal Tasks have eight artifacts: two business, four review and two audit. Audit
failure or invalid publication leaves six; review failure leaves four. When native
report export fails, Loom retains a failed report Session and still registers the
audit reporting `failed`, for seven total Task artifacts. It does not turn a domain
failure into success merely because auditing succeeds.

## Marginal change ledger

| Responsibility | This experiment |
| --- | ---: |
| Container Core | 0 |
| Pi Runtime | 0 |
| CLI | 0 |
| Existing four plugins/adapters | 0 |
| New native audit extension | 33 lines |
| New audit compatibility adapter | 27 lines |
| New Application variants | 12 lines total |
| New Loom host/preflight wiring | 17 lines |
| Shared observation/fault setup | 35 lines |
| Original-control module binding wrapper | 10 lines |
| Original-control normal/aspect governance changes | 0 |
| Control domain-failure lifecycle repair | Net +4 lines; 140 to 144 |

Line counts include comments. The driver, probe, freeze checks and documentation
are additional experimental cost. Adapter registration and module wiring are not
free merely because they do not modify shared infrastructure.

Loom's shared infrastructure increment fell from the previous +59 Runtime / +4 CLI
to zero for this interface shape. The new adapter returns native facts and leaves
identity, SHA, publication, failure persistence and settlement to the existing Host.
This is one concrete reuse observation, not evidence of a general scaling curve.

## What the control comparison means

The original control also reused its generic aspect iteration, indexing and failure
logic for twelve cases with zero governance edits. Therefore the expectation that
every additional plugin necessarily grows application-specific control governance
was not supported for those cases.

In both domain-failure cases, the original control skipped all afterRun callbacks,
so the failed report Session had no audit. A generic outcome-preserving repair of
four net lines passed the two targeted reruns. This closes an existing lifecycle
coverage gap; it is not evidence that every fifth-plugin integration costs more.

The observed distinction is that Loom already provided the requested failure-phase
semantics, and its production components did not need another extension. Lower
total development cost, lower operator cost relative to the control, faster runtime
and long-term maintenance savings remain unproven.

## Boundaries

The native audit reports structural counts and a supplied domain outcome, not an
independent quality verdict. It uses Pi APIs and writes its own file without a Loom
store. The standalone native probe passed. The full experiment uses the existing
HTTP, export, telemetry and review integrations unchanged. Root type checking,
53 behavioral tests and publication scanning passed.

Main history, tools and system prompt remain unchanged by the audit command.
Raw counts can vary by order because existing review test instrumentation adds a
continuation turn; comparison is of governance semantics, not byte-identical audit
reports. Security sandboxing, actual model analysis, compaction/checkpoints,
interactive usage, additional relationship types and complete v0.1 acceptance
remain outside this result.

See [README.md](README.md) for reproduction and [HANDOFF.md](HANDOFF.md) for the
publication protocol. Raw evidence remains in ignored experiment output directories.
