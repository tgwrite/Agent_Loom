import assert from 'node:assert/strict';
import test from 'node:test';
import type { EventEnvelope } from '../../packages/container-core/src/index.ts';
import { artifact, fixture, session, timestamp } from '../helpers.ts';

test('Events preserve Task and Session provenance and remain independent of payload files', async (t) => {
  const { store } = await fixture(t);
  await store.startSession(session());
  const event: EventEnvelope = { id: 'observed-event', type: 'runtime.turn.completed', timestamp,
    task_id: 'task-one', session_id: 'producer', actor_id: 'test-actor', source: 'synthetic-observer',
    correlation_id: 'producer', payload: { synthetic: true } };
  await store.appendEvent(event);
  await assert.rejects(store.appendEvent({ ...event, id: 'other-event', actor_id: 'other-actor' }), { code: 'InvalidRecord' });
  await assert.rejects(store.appendEvent(event), { code: 'BindingConflict' });
  await assert.rejects(store.appendEvent({ ...event, type: 'session.failed' }), { code: 'InvalidRecord' });
  await store.publishArtifact(artifact());
  const events = await store.listEvents('producer');
  assert.deepEqual(events.map((item) => item.type), ['session.started', 'runtime.turn.completed', 'artifact.published']);
  assert.ok(events.every((item) => item.task_id === 'task-one' && item.session_id === 'producer'));
});
