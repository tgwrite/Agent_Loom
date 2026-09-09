# Web source Handoff v1

This protocol belongs to the reusable v0.1 test Application. It is not a protocol
provided by either upstream Plugin and does not change Loom Core's domain rules.

The producer executes the real `pi-http-util` `http_fetch` tool with GET and
`strip=html2md`. The adapter accepts a successful 2xx, nonempty, untruncated result.
It stores the native tool result and the exact converted Markdown body without
asking a model to reproduce that body. All files are written exclusively under
the producer Session's own Task-relative directory.

The indexed Artifact has type `web.source`, version `1`, status `READY`, a file
reference to the Handoff JSON, its SHA-256, and the actual producer Session ID.

```json
{
  "schema_version": "loom-web-source-v1",
  "status": "READY",
  "task_id": "web-report-test",
  "producer_session_id": "producer-session",
  "native_tool": "http_fetch",
  "requested_url": "<runtime input>",
  "final_url": "<native result>",
  "fetched_at": "<ISO timestamp>",
  "http_status": 200,
  "content_type": "text/html",
  "truncated": false,
  "markdown": { "path": "producer/session/source.md", "sha256": "<digest>", "bytes": 123 },
  "native_result": { "path": "producer/session/http-result.json", "sha256": "<digest>" }
}
```

The consumer requires exactly one matching Artifact. Its initializer verifies the
Handoff digest, Task and producer identities, contained paths including symlinks,
the Markdown/result digests, and equality with the native converted body. It then
stages the verified source in the consumer workspace. Only successful initialization
permits Loom to record consumption; lookup and failed validation do not.

The second Session uses native artifact scaffolding and HTML export. Its report
receipt binds the consumed Handoff ID/digest to the native artifact ID and exported
file digest. A native export success is required; assistant completion alone is
insufficient. `READY` describes transport and conversion, not the truth of webpage
claims. Web content is untrusted data, never execution instructions.

Task, native logs, page snapshots, reports, paths, URLs and metrics are runtime
outputs and must stay outside version control. Public regression inputs are
synthetic. Real website output is never promoted to a public fixture.
