# Four-Plugin governance result

The native experiment passed on Windows with Pi 0.85.1. It uses the pinned packages
and protocol in [README.md](README.md), with deterministic model responses and a
local page. It does not evaluate the quality of a real website summary or review.

| Check | Observed result |
| --- | --- |
| Matrix | 16/16 Task cases passed: 8 Loom, 8 no-Loom control |
| Execution | 32 independent business Sessions; 16 successful source consumptions |
| Normal Task | 2 business artifacts and 4 native review artifacts |
| Review failure Task | 2 business artifacts; no successful review artifacts |
| Independent errors | Telemetry, review and simultaneous failures attributed correctly; business completed |
| Input scope | One current Session projected and read; other Session/Task canaries absent |
| Main context | History, tools and system unchanged by review; continuation request contains no private review content |
| Ordering | Actual extension load order reversed; same semantic assertions passed |
| Existing code | Existing domain/telemetry adapters and runtime setup unchanged; native package fingerprints unchanged |
| Global configuration | Pi configuration fingerprints unchanged; no global plugin installation |
| Model cost | 64 local review requests across the matrix; zero commercial model requests |

The normal native review starts two real Pi subprocesses: one reads the current
native log and writes a session review, and the other synthesizes improvements.
The native plugin writes both Markdown artifacts. Loom does not write their content.

## Change cost and interpretation

| Responsibility | Change in this experiment |
| --- | --- |
| Existing domain plugins and adapters | Zero |
| Existing telemetry plugin and adapter | Zero |
| Container Core | Zero |
| Pi runtime source | Net +59 lines, including comments and types |
| CLI inspection | +4 lines for readable aspect failure attribution |
| New review adapter | 76 lines: input binding, isolated configuration, native command and output checks |
| New Application definitions | 12 lines across the normal and reversed variants |
| New Loom host module | 9 lines, using the shared generic Host |
| Custom no-Loom governance | 127 to 140 lines: net +13 for this tested matrix |

The shared provider, executable launcher, instrumentation, CLI driver, probe and
fingerprint helper are experimental infrastructure. They are additional code and
not a governance saving. The shared setup wraps existing adapters to observe
provider requests; the underlying domain and telemetry adapter files are unchanged.
The control reuses that exact setup and review adapter. Line counts are descriptive,
not a normalized measure of complexity or maintenance cost.

This demonstrates that existing Core contracts can represent a new aspect and that
the generic Host can own native producer attribution, independent failure records
and terminal flushing. Domain integrations did not need to absorb those changes.
Input projection is still adapter work, and Pi supplies native event fan-out,
exception handling and separate review subprocesses.

The control also passed. Its incremental governance code is smaller than this
round's general Host work. Therefore this experiment does not establish lower total
implementation cost, fewer operator steps or faster execution with Loom. Reuse of
the generic Host across additional integrations remains a future measurement.

## Validation limits

The native regression with the original three-plugin application also passed,
including a missing-input gate and telemetry failure containment. Root checks pass
53 behavioral tests, TypeScript validation and publication scanning.

This result covers explicit review commands and cooperative input scope. It does
not establish a filesystem security sandbox, automatic checkpoint/compaction
behavior, timeout and late-result handling, normal interactive Pi usage, the
original reference business acceptance or complete v0.1 product acceptance.

Raw reports, native prompts, provider requests, local paths and full logs remain
under the ignored experiment directory. Only this synthetic result summary is public.
