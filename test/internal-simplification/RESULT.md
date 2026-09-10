# Internal simplification result

The bounded behavior was preserved while two semantic responsibility chains
became smaller. This supports retaining the refactor; it does not establish lower
total code volume, faster human maintenance, improved diagnosis or full v0.1
acceptance. The comparison baseline is public revision `2da7b8a`.

| Accepted stage | G1–G18 | Matched mutations | Shared early detection | Native Tasks / Sessions | Identical CLI outputs |
| --- | --- | --- | --- | --- | --- |
| S1 | 18/18 | 16/16 | 13/16 | 21 / 42 | 239 |
| S2 | 18/18 | 16/16 | 13/16 | 3 / 6 | 239 |
| S3 | 18/18 | 16/16 | 13/16 | 3 / 6 | 239 |
| S4 | 18/18 | 16/16 | 13/16 | 6 / 12 | 239 |
| S5 | 18/18 | 16/16 | 13/16 | 21 / 42 | 239 |

Each stage ran 50 primitive cases and 16 independently compiled mutations. The
accepted stages total 80 mutant executions / 4,000 primitive mutation cases,
54 native Tasks / 108 Sessions / 381 Artifacts, 324 local review requests and
1,195 CLI comparisons against 239 baseline outputs from 23 existing Tasks.
Native testing used Windows, real Pi 0.85.1 and the pinned plugins/tools with
deterministic models; commercial LLM requests were zero. Applications, adapters,
Runtime Pi source, original tests, plugin packages and global Pi configuration
were unchanged. Public root checks passed 60 tests plus type/build/privacy checks.

Observer contract types, payload construction and validation now share one Core
module; the accepted class list also derives the public context type. Runtime
classification remains separate. Using the prior chain-responsibility convention,
this is **4 to 2**. Native provenance types, validation and reference projection
derive from one reader; Runtime supplies facts and Store checks Session/role
invariants. That chain is **5 to 3**. Storage and lifecycle behavior remain intact.

These are reductions in independent definitions, not credit for file relocation.
The exact hypothetical addition of a failure-class value would touch three old
sites (type, runtime classification, allowed-value validation) and two new sites
(semantic definition and runtime); the old generic writer already passed values
through. A hypothetical native field with no new cross-record rule would touch
the old type, runtime, shape validator, reference copier and human renderer; it
now needs the semantic reader and runtime. New contextual invariants would still
belong in Store. Neither hypothetical was implemented.

Core now prepares named inspection facts and resolves producer relationships;
CLI formats those facts without parsing versions, legacy payloads or native
field names. Existing JSON schemas, output bytes and persisted legacy evidence
were preserved. Artifact references still exclude unknown record extensions and
remain detached from stored objects.

There was **no localization improvement**: all first failures and complete failing
test lists matched baseline. Reviewed relevance remained Exact 10, Near 2,
Indirect 4, Misleading 0, with 34 secondary failures per campaign. This rating is
manual and was not blinded. M17 still failed at product inspection.

The Core/Runtime/CLI footprint grew from **23 files / 1,724 physical lines** to
**26 files / 1,780 lines**. New semantic/read-model modules add explicit boundaries;
test infrastructure is additional cost. No maintenance-time or throughput benefit
was measured. Declaration review also caught an intermediate phase type widening
that runtime tests missed. That S4 attempt was rejected, a compile-time contract
guard was added, and S4 was rerun; its extra 6 Tasks / 12 Sessions and 16 mutants
are excluded from the accepted totals above.
