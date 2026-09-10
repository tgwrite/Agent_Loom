import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectTask, taskInspectionView } from '../../packages/container-core/src/index.ts';
import { artifact, fixture, session, timestamp } from '../helpers.ts';

test('Core inspection interprets legacy and native facts without altering JSON or persisted evidence', async t => {
  const { store, root } = await fixture(t);
  await store.startSession({ ...session(), profile_id: 'test-observing', runtime_session_id: 'native-producer',
    plugin_ids: ['test-domain', 'test-observer'], aspect_plugin_ids: ['test-observer'] });
  await store.publishArtifact({ ...artifact(), producer_phase: 'domain-run', native_runtime_session_id: 'native-producer' });
  await store.recordObserverFailure('producer', 'test-observer', { code: 'ObserverFailed',
    message: 'Synthetic failure.', source: 'test-observer', timestamp }, { phase: 'after-run', failure_class: 'aspect-execution' });
  const path = join(root, '.agent-loom/sessions/producer/events.jsonl');
  const events = await store.listEvents('producer');
  const legacy = { ...events.at(-1)!, id: 'legacy-observer', payload: { plugin_id: 'test-observer',
    failure: { code: 'ObserverFailed', message: 'Historical failure.', source: 'test-observer', timestamp } } };
  await appendFile(path, JSON.stringify(legacy) + '\n');
  const persisted = await readFile(path, 'utf8');
  const snapshot = await inspectTask(store), original = JSON.stringify(snapshot);
  const view = taskInspectionView(snapshot).sessions[0]!;
  assert.deepEqual(view.aspect_failures.map(f => f.context), [
    [{ name: 'phase', value: 'after-run' }, { name: 'failure_class', value: 'aspect-execution' }],
    [{ name: 'contract', value: 'legacy' }],
  ]);
  assert.deepEqual(view.produced[0]!.native_provenance, [
    { name: 'producer_phase', value: 'domain-run' }, { name: 'native_runtime_session_id', value: 'native-producer' },
  ]);
  assert.equal(view.plugin_artifact_counts['test-domain']?.SyntheticHandoff, 1);
  assert.equal(view.plugin_artifact_counts['test-observer']?.SyntheticCheckpoint, undefined);
  assert.equal(JSON.stringify(snapshot), original);
  assert.equal(await readFile(path, 'utf8'), persisted);
});
