import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { LocalTaskStore } from '../../packages/container-core/src/index.ts';
import { artifact, fixture, requirement, session, timestamp } from '../helpers.ts';

test('Task creation is exclusive and identity survives attempted replacement', async (t) => {
  const { root, store } = await fixture(t);
  await assert.rejects(LocalTaskStore.create(root, { ...store.task, id: 'replacement' }), { code: 'StorageFailure' });
  assert.equal((await LocalTaskStore.open(root)).task.id, 'task-one');
  const copy = store.task;
  copy.id = 'mutated';
  assert.equal(store.task.id, 'task-one');
});

test('Session settlement is terminal and produces lifecycle Events', async (t) => {
  const { store } = await fixture(t);
  await store.startSession(session());
  await store.settleSession('producer', 'failed', timestamp);
  await assert.rejects(store.settleSession('producer', 'completed', timestamp), { code: 'InvalidTransition' });
  await assert.rejects(store.publishArtifact(artifact()), { code: 'InvalidRecord' });
  assert.deepEqual((await store.listEvents('producer')).map((event) => event.type), ['session.started', 'session.failed']);
});

test('invalid identifiers cannot escape the Session index', async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.getSession('../outside'), { code: 'InvalidRecord' });
  await assert.rejects(store.startSession(session('CON')), { code: 'InvalidRecord' });
  assert.deepEqual(await store.listSessions(), []);
});

test('truncated and malformed persisted data fail closed', async (t) => {
  const { root, store } = await fixture(t);
  await appendFile(join(root, '.agent-loom', 'artifacts.jsonl'), '{');
  await assert.rejects(store.resolveArtifact(requirement), { code: 'StorageFailure' });
  await writeFile(join(root, '.agent-loom', 'task.json'), JSON.stringify({ schema_version: 99 }));
  await assert.rejects(LocalTaskStore.open(root), { code: 'StorageFailure' });
});
