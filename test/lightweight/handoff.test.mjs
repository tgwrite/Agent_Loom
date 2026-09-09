import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptHandoff, httpSnapshot, sha256 } from './handoff.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'loom-handoff-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'producer'));
  const source = '# Synthetic page\n';
  const result = { content: [{ type: 'text', text: `HTTP 200\n---\n${source}` }],
    details: { url: 'fixture:page', finalUrl: 'fixture:page', httpStatusCode: 200,
      contentType: 'text/html', appliedStripMethod: 'html2md', truncated: false } };
  const resultBytes = Buffer.from(JSON.stringify(result));
  await writeFile(join(root, 'producer/source.md'), source);
  await writeFile(join(root, 'producer/native.json'), resultBytes);
  const handoff = { schema_version: 'loom-web-source-v1', status: 'READY', task_id: 'task',
    producer_session_id: 'producer', native_tool: 'http_fetch', requested_url: 'fixture:page',
    final_url: 'fixture:page', http_status: 200, content_type: 'text/html', truncated: false,
    markdown: { path: 'producer/source.md', sha256: sha256(source), bytes: Buffer.byteLength(source) },
    native_result: { path: 'producer/native.json', sha256: sha256(resultBytes) } };
  const artifact = { type: 'web.source', version: '1', task_id: 'task', verification: { status: 'READY' },
    producer: { plugin_id: 'web-source', session_id: 'producer' },
    payload_ref: { kind: 'file', path: 'producer/handoff.json' } };
  const save = async () => {
    const bytes = JSON.stringify(handoff); artifact.sha256 = sha256(bytes);
    await writeFile(join(root, 'producer/handoff.json'), bytes);
  };
  await save();
  return { root, source, result, handoff, artifact, save };
}

test('web Handoff accepts only the exact indexed native body and producer', async t => {
  const f = await fixture(t);
  assert.equal((await acceptHandoff(f.root, f.artifact)).source.toString(), f.source);
  f.artifact.producer.session_id = 'different-producer';
  await assert.rejects(acceptHandoff(f.root, f.artifact));
});

test('web Handoff rejects tampered source even when its manifest is consistently rehashed', async t => {
  const f = await fixture(t);
  const changed = '# Changed';
  await writeFile(join(f.root, 'producer/source.md'), changed);
  await assert.rejects(acceptHandoff(f.root, f.artifact), /Source digest/);
  f.handoff.markdown.sha256 = sha256(changed);
  f.handoff.markdown.bytes = Buffer.byteLength(changed);
  await f.save();
  await assert.rejects(acceptHandoff(f.root, f.artifact), /differs from native/);
});

test('web Handoff rejects path escape and changed Handoff bytes', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'producer/handoff.json'), '{}');
  await assert.rejects(acceptHandoff(f.root, f.artifact), /Handoff digest/);
  f.handoff.markdown.path = '../outside.md';
  await f.save();
  await assert.rejects(acceptHandoff(f.root, f.artifact));
});

test('native failed, empty and truncated responses cannot become READY', async t => {
  const f = await fixture(t);
  for (const patch of [{ httpStatusCode: 503 }, { truncated: true }, { appliedStripMethod: 'none' }]) {
    assert.throws(() => httpSnapshot({ ...f.result, details: { ...f.result.details, ...patch } }, 'fixture:page'));
  }
  assert.throws(() => httpSnapshot({ ...f.result, isError: true }, 'fixture:page'));
  assert.throws(() => httpSnapshot({ ...f.result, content: [{ type: 'text', text: 'HTTP 200\n---\n' }] }, 'fixture:page'));
});
