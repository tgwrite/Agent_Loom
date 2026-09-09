import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { LocalTaskStore } from '../../packages/container-core/src/index.ts';
import { artifact, fixture, requirement, session, timestamp } from '../helpers.ts';

test('a new store resolves the original reference after producer Session exit', async (t) => {
  const { root, store } = await fixture(t);
  await store.startSession(session());
  const original = artifact();
  await store.publishArtifact(original);
  await store.settleSession('producer', 'completed', timestamp);
  const consumer = await LocalTaskStore.open(root);
  await consumer.startSession(session('consumer'));
  const resolved = await consumer.resolveArtifact(requirement);
  assert.deepEqual(resolved.payload_ref, original.payload_ref);
  assert.equal(resolved.sha256, original.sha256);
  assert.equal((await consumer.listArtifacts())[0]?.producer.session_id, 'producer');
  assert.equal((await consumer.listSessions()).length, 2);
  assert.match(await readFile(join(root, '.agent-container', 'artifacts.jsonl'), 'utf8'), /artifact-one/);
});

test('missing, non-READY and different-version dependencies do not create Sessions', async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.resolveArtifact(requirement), { code: 'PreconditionNotSatisfied' });
  assert.deepEqual(await store.listSessions(), []);
  await store.startSession(session());
  await store.publishArtifact({ ...artifact(), verification: { status: 'PENDING' } });
  await assert.rejects(store.resolveArtifact(requirement), { code: 'PreconditionNotSatisfied' });
  await assert.rejects(store.resolveArtifact({ ...requirement, version: '4' }), { code: 'PreconditionNotSatisfied' });
  assert.equal((await store.listSessions()).length, 1);
});

test('multiple matching Artifacts require an explicit identity', async (t) => {
  const { store } = await fixture(t);
  await store.startSession(session());
  await store.publishArtifact(artifact('first'));
  await store.publishArtifact(artifact('second'));
  await assert.rejects(store.resolveArtifact(requirement), { code: 'BindingConflict' });
  assert.equal((await store.resolveArtifact({ ...requirement, artifact_id: 'second' })).id, 'second');
  await assert.rejects(store.publishArtifact(artifact('second')), { code: 'BindingConflict' });
});

test('cross-Task records and mismatched executor or Plugin provenance are rejected', async (t) => {
  const { store } = await fixture(t);
  await store.startSession(session());
  await assert.rejects(store.publishArtifact({ ...artifact(), task_id: 'another-task' }), { code: 'InvalidRecord' });
  await assert.rejects(store.publishArtifact({ ...artifact(), executor: { actor_id: 'other', runtime_id: 'test-runtime' } }), { code: 'InvalidRecord' });
  await assert.rejects(store.publishArtifact({ ...artifact(), producer: { ...artifact().producer, plugin_id: 'other' } }), { code: 'InvalidRecord' });
  assert.equal((await store.listArtifacts()).length, 0);
});

test('inline metadata is supported and Task-relative references cannot escape', async (t) => {
  const { store } = await fixture(t);
  await store.startSession(session());
  await assert.rejects(store.publishArtifact({ ...artifact(), payload_ref: { kind: 'file', path: '../outside.json' } }), { code: 'InvalidRecord' });
  await store.publishArtifact({ ...artifact(), payload_ref: { kind: 'inline', value: { synthetic: true } } });
  assert.deepEqual((await store.resolveArtifact(requirement)).payload_ref, { kind: 'inline', value: { synthetic: true } });
});
