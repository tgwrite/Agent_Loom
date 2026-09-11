# Agent service regression

`npm run check` includes the Agent SDK/CLI behavior probes and existing synthetic
G1-G18 governance contracts. The local package verifier also runs three fresh
process-driven Tasks for each of the two bundled synthetic domains.

After a passing check, run `node test/agent-services/mutate.mjs` to compile isolated
copies with the existing 16 matched Loom governance mutations and execute the 49
synthetic probes for each. M06 remains shared domain policy and M18 remains
structurally inapplicable. The manifest retains the original mutant semantics;
M10/M15 target the updated failure/settlement statements, and M13/M17 target their
current semantic owners. Compilation failure is not credited as detection.

Source fingerprints and raw results stay in ignored `.test-tmp/agent-services/`.
`node test/agent-services/contracts-mutate.mjs` separately checks seven mutations
of receipt state, binding capture, consumption projection, startup digest checks,
preflight status, returned reasons and diagnostic trust. Each must compile and
execute the contract tests before a failing assertion counts as detection.

This synthetic campaign does not replace the native parity campaign, reproduce
an earlier Agent baseline, or demonstrate better Agent decisions. Independent
sensor/stock Agent blind trials require their own fair baseline and evidence.
