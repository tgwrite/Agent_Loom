# Cross-Application domain contracts

The domain adapter verifies native facts before returning a publication. Loom and
the shared control resolve, attribute, hash and index those publications. Neither
the native plugins nor domain adapters write governance records.

| Contract | Native producer | Payload | Consumer |
| --- | --- | --- | --- |
| `local.result@1` | `json_query` | Snapshot of the plugin's queried JSON value | None |
| `source.snapshot@1` | `fetch_webpage` | Unchanged native Markdown response | Markdown normalization |
| `normalized.data@1` | `md_edit` | Native edited Markdown file | HTML publication |
| `final.output@1` | `preview_export` | Native HTML export, viewer disabled | None |

All four use `COMPLETED`. A keeps its existing web contracts. Aspect contracts
remain those of the previous experiments, without additional consumers.

The JSON adapter supplies a local fixture file to the published JSON query tool.
The compatibility entry translates its old call signature and return shape only.
The query and resulting value are evaluated by the market package.

Capture uses direct HTTP to a synthetic local page, with the optional remote
conversion service disabled. Its native output is persisted byte for byte; normal
Markdown escaping is not silently rewritten. The normalization adapter copies the
accepted source bytes into a new workspace and calls `md_inspect` followed by
`md_edit` to replace the Status paragraph. Export copies the accepted normalized
bytes and invokes the plugin's HTML export with a real Pandoc binary.

Each consumer checks the input contract, Task-contained file, accepted digest and
fixture marker before initialization succeeds. There are two explicit handoffs in
C and none in B. A missing or altered input must not be counted as consumed.

Failure injection is identical in both arms: the existing telemetry wrapper's
native hook throws, native audit execution throws, the shared setup returns an
undeclared audit contract, or the final domain tool receives a missing file/ID.
An audit can report the failed domain outcome without converting that Session
into success. Its structural summary is not an independent business quality verdict.

Native outputs and tool events remain in ignored experiment directories. Published
results contain aggregate observations only. Model decisions are scripted; no
actual LLM quality is claimed.
