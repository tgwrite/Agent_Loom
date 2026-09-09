import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalTaskStore, inspectTask, prepareSession } from '../../packages/container-core/src/index.ts';
import { artifact, fixture, requirement, session, timestamp } from '../helpers.ts';

test('resolving and planning do not mark consumption; accepted bindings survive reopening', async (t) => {
  const { root, store } = await fixture(t);
  await store.startSession(session());
  await store.publishArtifact(artifact());
  await store.settleSession('producer', 'completed', timestamp);
  const reference = await store.resolveArtifact(requirement);
  assert.equal(reference.producer.session_id, 'producer');
  await prepareSession(store, 'test-consumer');
  assert.deepEqual(await store.listConsumptions(), []);
  await store.startSession({ ...session('consumer'), profile_id: 'test-consumer', workspace: 'consumer' });
  const receipt = { id: 'accepted', task_id: 'task-one', session_id: 'consumer', consumer_plugin_id: 'test-domain',
    artifact_id: reference.id, sha256: reference.sha256, consumed_at: timestamp };
  await store.recordConsumption(receipt);
  const duplicate = await store.recordConsumption({ ...receipt, id: 'retried' });
  assert.equal(duplicate.id, 'accepted');
  await store.settleSession('consumer', 'completed', timestamp);
  const snapshot = await inspectTask(await LocalTaskStore.open(root));
  assert.equal(snapshot.artifacts[0]?.consumers.length, 1);
  assert.equal(snapshot.sessions.find((item) => item.id === 'consumer')?.consumed[0]?.producer.session_id, 'producer');
  assert.equal(snapshot.sessions.find((item) => item.id === 'consumer')?.workspace, 'consumer');
  assert.equal((await store.listEvents('consumer')).filter((event) => event.type === 'artifact.consumed').length, 1);
});

test('consumption rejects wrong digests, Tasks, unloaded Plugins and missing Artifacts', async (t) => {
  const { store } = await fixture(t);
  await store.startSession(session());
  await store.publishArtifact(artifact());
  await store.startSession(session('consumer'));
  const receipt = { id: 'accepted', task_id: 'task-one', session_id: 'consumer', consumer_plugin_id: 'test-domain',
    artifact_id: 'artifact-one', sha256: 'a'.repeat(64), consumed_at: timestamp };
  await assert.rejects(store.recordConsumption({ ...receipt, sha256: 'b'.repeat(64) }), { code: 'InvalidRecord' });
  await assert.rejects(store.recordConsumption({ ...receipt, task_id: 'other' }), { code: 'InvalidRecord' });
  await assert.rejects(store.recordConsumption({ ...receipt, consumer_plugin_id: 'other' }), { code: 'InvalidRecord' });
  await assert.rejects(store.recordConsumption({ ...receipt, artifact_id: 'missing' }), { code: 'PreconditionNotSatisfied' });
  assert.deepEqual(await store.listConsumptions(), []);
});

test('consumer startup itself rejects missing dependencies before writing a Session', async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.startSession({ ...session('consumer'), profile_id: 'test-consumer', workspace: 'consumer' }),
    { code: 'PreconditionNotSatisfied' });
  assert.deepEqual(await store.listSessions(), []);
});
