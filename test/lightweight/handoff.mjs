import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { relative, isAbsolute, sep } from 'node:path';
import { resolveTaskPath } from '../../packages/container-core/src/index.ts';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function httpSnapshot(result, requestedUrl) {
  assert(result && !result.isError, 'HTTP tool failed');
  const d = result.details;
  assert(d?.httpStatusCode >= 200 && d.httpStatusCode < 300, 'HTTP response unsuccessful');
  assert.equal(d.url, requestedUrl, 'Unexpected request URL');
  assert.equal(d.appliedStripMethod, 'html2md', 'Expected native HTML conversion');
  assert.equal(d.truncated, false, 'Truncated source cannot be READY');
  const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  const boundary = text.indexOf('\n---\n');
  assert(boundary >= 0, 'Native HTTP body delimiter missing');
  const body = text.slice(boundary + 5);
  assert(body.trim().length > 0, 'Empty source');
  return { body, requested_url: requestedUrl, final_url: d.finalUrl,
    http_status: d.httpStatusCode, content_type: d.contentType };
}

export async function containedFile(root, path) {
  const resolved = await realpath(resolveTaskPath(root, path));
  const rel = relative(await realpath(root), resolved);
  assert(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'File escapes Task');
  return resolved;
}

export async function acceptHandoff(root, artifact) {
  assert.equal(artifact.type, 'web.source');
  assert.equal(artifact.version, '1');
  assert.equal(artifact.verification.status, 'READY');
  assert.equal(artifact.producer.plugin_id, 'web-source');
  assert.equal(artifact.payload_ref.kind, 'file');
  const bytes = await readFile(await containedFile(root, artifact.payload_ref.path));
  assert.equal(sha256(bytes), artifact.sha256, 'Handoff digest mismatch');
  const handoff = JSON.parse(bytes.toString('utf8'));
  assert.equal(handoff.schema_version, 'loom-web-source-v1');
  assert.equal(handoff.task_id, artifact.task_id);
  assert.equal(handoff.producer_session_id, artifact.producer.session_id);
  assert.equal(handoff.status, 'READY');
  assert.equal(handoff.native_tool, 'http_fetch');
  assert(handoff.http_status >= 200 && handoff.http_status < 300);
  assert.equal(handoff.truncated, false);
  const source = await readFile(await containedFile(root, handoff.markdown.path));
  assert.equal(sha256(source), handoff.markdown.sha256, 'Source digest mismatch');
  assert.equal(source.length, handoff.markdown.bytes);
  const resultBytes = await readFile(await containedFile(root, handoff.native_result.path));
  assert.equal(sha256(resultBytes), handoff.native_result.sha256, 'Native result digest mismatch');
  const native = httpSnapshot(JSON.parse(resultBytes), handoff.requested_url);
  assert.equal(native.body, source.toString('utf8'), 'Source differs from native output');
  assert.equal(native.final_url, handoff.final_url);
  assert.equal(native.http_status, handoff.http_status);
  assert.equal(native.content_type, handoff.content_type);
  return { handoff, source };
}
