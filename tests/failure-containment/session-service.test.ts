import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { executeSession, LocalTaskStore, prepareSession } from '../../packages/container-core/src/index.ts';
import type { SessionHost } from '../../packages/container-core/src/index.ts';
import { artifact, fixture, session, timestamp } from '../helpers.ts';

test('failed native initialization records failure but never consumption or domain execution', async (t) => {
  const { store } = await fixture(t);
  await store.startSession(session());
  await store.publishArtifact(artifact());
  await store.settleSession('producer', 'completed', timestamp);
  let ran = false;
  let closed = false;
  const host: SessionHost = {
    runtime: { id: 'test-runtime', name: 'synthetic', version: '1' },
    async validate() {},
    async launch(plan, workspace, binding) {
      assert.equal(workspace, join(store.taskRoot, 'consumer'));
      assert.equal(binding.task_root, store.taskRoot);
      assert.ok(binding.session_id);
      assert.equal(plan.artifacts.length, 1);
      return { runtime_session_id: 'native-test-session',
        async initialize() { throw new Error('Do not propagate native diagnostic text.'); },
        async run() { ran = true; return { status: 'completed' }; },
        async close() { closed = true; },
      };
    },
  };
  await assert.rejects(executeSession(store, await prepareSession(store, 'test-consumer'), host, { id: 'consumer' }),
    { code: 'NativeExecutionFailed', message: 'Native initialization or execution failed.' });
  assert.equal(ran, false);
  assert.equal(closed, true);
  assert.deepEqual(await store.listConsumptions(), []);
  const consumer = (await store.listSessions()).find((record) => record.id !== 'producer');
  assert.equal(consumer?.status, 'failed');
  assert.equal(consumer?.failure?.code, 'NativeExecutionFailed');
});

test('a mismatched or unavailable Runtime leaves no fabricated Session', async (t) => {
  const { store } = await fixture(t);
  const host: SessionHost = { runtime: { id: 'test-runtime', name: 'wrong-runtime', version: '1' },
    async validate() { throw new Error(); }, async launch() { throw new Error(); } };
  await assert.rejects(executeSession(store, await prepareSession(store, 'test-profile'), host, { id: 'actor' }),
    { code: 'NativeIntegrationNotReady' });
  assert.deepEqual(await store.listSessions(), []);
});

test('legacy stores are detected explicitly and never silently split', async (t) => {
  const { root, store } = await fixture(t);
  await mkdir(join(root, '.agent-container'));
  await assert.rejects(LocalTaskStore.open(root), { code: 'LegacyStoreDetected' });
  await assert.rejects(LocalTaskStore.create(root, store.task), { code: 'LegacyStoreDetected' });
});

test('native cleanup failure settles execution as failed without leaking native diagnostics', async (t) => {
  const { store } = await fixture(t);
  let closes = 0;
  const host: SessionHost = { runtime: { id: 'test-runtime', name: 'synthetic', version: '1' },
    async validate() {}, async launch() {
      return { runtime_session_id: 'native-test', async initialize() {},
        async run() { return { status: 'completed' }; },
        async close() { closes += 1; throw new Error('Unpublished native diagnostic.'); } };
    } };
  await assert.rejects(executeSession(store, await prepareSession(store, 'test-profile'), host, { id: 'actor' }),
    { code: 'NativeExecutionFailed' });
  assert.equal(closes, 1);
  assert.equal((await store.listSessions())[0]?.status, 'failed');
});

test('failure shutdown observations flush while the Session is still running', async (t) => {
  const { store } = await fixture(t);
  let currentId = '';
  const host: SessionHost = { runtime: { id: 'test-runtime', name: 'synthetic', version: '1' },
    async validate() {}, async launch(_plan, _workspace, binding) {
      currentId = binding.session_id;
      return { runtime_session_id: 'native-test', async initialize() {},
        async run() { throw new Error('Synthetic failure.'); },
        async close() {
          assert.equal((await store.getSession(currentId)).status, 'running');
          await store.appendEvent({ id: 'shutdown-observation', type: 'runtime.session.shutdown',
            timestamp: new Date().toISOString(), task_id: store.task.id, session_id: currentId,
            actor_id: 'actor', source: 'synthetic-bridge', correlation_id: currentId, payload: {} });
        } };
    } };
  await assert.rejects(executeSession(store, await prepareSession(store, 'test-profile'), host, { id: 'actor' }),
    { code: 'NativeExecutionFailed' });
  assert.deepEqual((await store.listEvents(currentId)).map((event) => event.type),
    ['session.started', 'runtime.session.shutdown', 'session.failed']);
});
