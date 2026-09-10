# Governance parity and mutation result

Governance has observable effects on reliable completion, failure independence
and context contents. This campaign found no relative detection advantage for
Loom over the independent shared control. The result supports keeping the proven
guarantees and simplifying internal propagation, rather than adding governance
concepts. It does not establish a drop-in replacement for every Loom API or UI.

## Evidence

- Both arms passed G1-G18: 50 shared cases per arm, including the actual common
  domain initializer. Public root checks run 49 per arm without optional packages.
- The actual Pi matrix passed 42 Tasks / 84 business Sessions / 294 Artifacts,
  with 252 local review HTTP requests and 201 driver commands.
- All model decisions were deterministic. Commercial model requests were zero.
  Plugins were loaded explicitly at startup; global Pi configuration fingerprints
  and the previous business integration/plugin fingerprints stayed unchanged.
- All 34 executable source mutants were detected. Removing the shared-domain M06
  leaves 16 matched governance mutants per arm: 16/16 detected, 13/16 first found
  at shared tests, two at legacy tests and one at product inspection. Both arms
  had exactly the same first failing test for each executable mutant.
- M18 was structurally inapplicable in both arms: there was no real C-only
  governance migration branch. No branch was invented or counted as a detection.
- Post-campaign actual Pi probes ran another 18 Tasks / 30 business Sessions.
  Both arms exhibited failed valid work under M10, false completion under M11,
  and governance Task snapshots in actual main provider inputs under M16.

M03-M05 were detected while remaining validators still prevented invalid native
provenance from entering the registry. A regression failure is not evidence that
all runtime protection was bypassed. M06 belongs to the common C domain adapter,
not Loom. M17 lost fields from the top-level Artifact projection; Session-produced
entries retained them, so it was not total loss of inspect recoverability.

The M16 native matrix first failed on aspect Artifact counts. Independent captured
provider inputs established the context violation; the frozen G17 primitive
assertion had already detected the mutation directly. These are separate facts.

## Defect and cost

Parity exposed a real Loom ordering defect: a failed or blocked terminal event
write could leave an already-visible completed Session. The store now writes the
required event before publishing terminal state. This is live-process ordering,
not power-loss transactionality or automatic recovery.

The independent control grew from the earlier narrow CLI into a three-file,
308-line implementation. The broader Loom Core/Runtime/CLI footprint was 23 files
and 1,724 physical lines; these are different total product surfaces, so that
ratio alone is not an economic verdict. The fixed observer and native-provenance
responsibility chains required 4 and 5 propagation locations in Loom, versus
3 and 3 in control. This campaign observed no detection benefit from the extra
locations. Shared domain, loading and experimental infrastructure are additional
costs and are not credited exclusively to either arm.

The root check passed 58 tests, type/build checks and the publication scan.
Native evidence is from Windows. The campaign was not blinded and does not
measure long-term review time, natural AI error rates, scale, security sandboxing,
LLM quality or complete v0.1 acceptance.

See [README.md](README.md) for reproduction and the boundaries of the comparison.
