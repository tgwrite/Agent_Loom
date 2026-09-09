import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectTask } from '../../packages/container-core/src/index.ts';
import { artifact, fixture, session, timestamp } from '../helpers.ts';

test('observer failures and artifact counts remain attributable without failing the domain Session', async (t) => {
  const { store } = await fixture(t);
  await store.startSession({ ...session(), profile_id: 'test-observing',
    plugin_ids: ['test-domain', 'test-observer'], aspect_plugin_ids: ['test-observer'] });
  await store.recordObserverFailure('producer', 'test-observer', { code: 'CheckpointFailed',
    message: 'Synthetic observer failure.', source: 'test-observer', timestamp });
  assert.equal((await store.getSession('producer')).status, 'running');
  await store.publishArtifact({ ...artifact(), type: 'SyntheticCheckpoint', version: '1',
    producer: { ...artifact().producer, plugin_id: 'test-observer' } });
  const snapshot = await inspectTask(store);
  assert.equal(snapshot.sessions[0]?.plugin_artifact_counts['test-observer']?.SyntheticCheckpoint, 1);
  assert.equal(snapshot.sessions[0]?.events.filter((event) => event.type === 'observer.failed').length, 1);
  await store.settleSession('producer', 'completed', timestamp);
  assert.equal((await store.getSession('producer')).failure, undefined);
});

test('observer contract migration preserves V1 evidence and emits structured V2 for legacy callers', async t => {
  const { root, store } = await fixture(t);
  await store.startSession({ ...session(), profile_id: 'test-observing',
    plugin_ids: ['test-domain', 'test-observer'], aspect_plugin_ids: ['test-observer'] });
  await store.recordObserverFailure('producer', 'test-observer', { code: 'ObserverFailed',
    message: 'Synthetic failure.', source: 'test-observer', timestamp });
  const path = join(root, '.agent-loom/sessions/producer/events.jsonl');
  const original = await readFile(path, 'utf8');
  const rows = original.trim().split('\n').map(line => JSON.parse(line));
  const failure = rows.find(row => row.type === 'observer.failed');
  assert.equal(failure.payload.contract_version, 2);
  assert.equal(failure.payload.phase, 'unknown');
  assert.equal(failure.payload.failure_class, 'unspecified');
  delete failure.payload.contract_version; delete failure.payload.phase; delete failure.payload.failure_class;
  const legacy = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  await writeFile(path, legacy);
  const events = await store.listEvents('producer');
  assert.equal((events.at(-1)!.payload as { phase?: string }).phase, undefined);
  assert.equal(await readFile(path, 'utf8'), legacy, 'Reading must not rewrite historical evidence');
  failure.payload.contract_version = 2;
  failure.payload.phase = 'after-run';
  await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  await assert.rejects(store.listEvents('producer'), { code: 'StorageFailure' });
});
