# Internal simplification experiment

This optional local experiment compares Loom before and after internal refactoring.
It retains the [governance parity](../governance-parity/README.md) guarantees,
original test order, matched mutations, Applications, adapters and native setup.
See [RESULT.md](RESULT.md) for the reviewed outcome.

The baseline is public revision `2da7b8a`. Baseline native, parity and mutation
evidence must first be produced using that revision's experiment instructions.
Keep those Tasks available for read-only inspection throughout the refactor.
Copy this experiment directory into the baseline checkout before freezing; the
tools do not apply production refactors or manufacture earlier stage evidence.

From the repository root, after `npm run check`:

```powershell
node test/internal-simplification/experiment.mjs freeze $nativeResult $paritySummary $mutationResults
$env:PANDOC_PATH = $pandocExecutable
node test/internal-simplification/experiment.mjs stage S1
```

The three freeze arguments are paths to the prior passing native result, parity
summary and mutation results. Variables above are local configuration, not files
to commit. Native prerequisites are the same pinned optional dependencies and real
Pandoc used by the earlier experiment. Plugins load on startup; no global install
is performed. Native acceptance currently requires Windows and uses deterministic
models with real Pi, tools, files and local review processes.

Implement each stage separately and run its checkpoint before starting the next:

| Stage | Change | Native A/B/C scenarios |
| --- | --- | --- |
| S1 | Observer semantics | All seven |
| S2 | Record to reference | Normal |
| S3 | Artifact shape | Invalid aspect publication |
| S4 | Native provenance | Normal and domain failure |
| S5 | Core inspection and CLI formatting | All seven |

Replace `S1` in the command with `S2` through `S5` as each change is ready. Every
checkpoint runs root checks, all 50 Loom primitive cases, 16 executable matched
mutants, relevant native A/B/C scenarios and baseline CLI comparisons. Mutants
run in isolated copies, use unchanged test order, and must compile before a
behavioral failure earns detection credit. Only M13 and M17 patch file locations
are retargeted after their production owners move. M06 is shared domain policy;
M18 remains structurally inapplicable. Neither enters the 16 matched mutations.

The CLI comparison covers human Task output and Task/Session/Artifact JSON from
an unrelated working directory. It verifies that governance files are unchanged
after reads. Mutation records include root semantics, first failure/layer,
reviewed diagnostic relevance and secondary failures. Changed first failures
require explicit review rather than silent reclassification.

After the final checkpoint:

```powershell
node test/internal-simplification/ledger.mjs
```

Raw outputs, snapshots, local paths and source hashes stay in ignored
`.test-tmp/internal-simplification/`. Native and primitive runs also keep evidence
under the existing ignored parity directory. Never publish raw evidence. A fresh
checkout without the optional evidence can still run `npm run check`; public CI
does not claim to reproduce the native experiment.
