import assert from 'node:assert/strict';
import test from 'node:test';
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
