import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fixture, artifact } from '../helpers.ts';
import { executeSession, prepareSession, registerSafeDiagnostics, createNativeFailure, inspectTask,
  diagnosticFor, ContainerFailure, safeNativeFailure, readSafeDiagnostic } from '../../packages/container-core/src/index.ts';
import type { SessionHost } from '../../packages/container-core/src/index.ts';
import { connectLoom, createRequest } from '../../packages/container-core/src/agent.ts';
import { summarizeTask } from '../../packages/cli/src/experience.ts';

const reject = registerSafeDiagnostics('domain', ['DOMAIN_REJECTED']);
const audit = registerSafeDiagnostics('aspect', ['AUDIT_REJECTED']);

test('actual request-free SDK Sessions expose domain and aspect failures without inventing identity', async t => {
  for (const mode of ['domain', 'aspect']) {
    const { store, root } = await fixture(t);
    const host: SessionHost = { runtime: { id: 'test-runtime', name: 'synthetic', version: '1' }, async validate() {},
      async launch(_plan, _workspace, binding) {
        return { runtime_session_id: 'synthetic-native', async initialize() {}, async run() {
          if (mode === 'domain') throw reject('DOMAIN_REJECTED');
          const output = artifact();
          await store.publishArtifact({ ...output, producer: { ...output.producer, session_id: binding.session_id } });
          const failure = createNativeFailure(audit('AUDIT_REJECTED'));
          // Historical raw fields remain local and must not enter the Agent view.
          failure.message = 'synthetic-history-error-canary';
          await store.recordObserverFailure(binding.session_id, 'test-observer', failure,
            { phase: 'after-run', failure_class: 'aspect-execution' });
          return { status: 'completed' };
        }, async close() {} };
      } };
    const plan = await prepareSession(store, 'test-observing');
    assert.equal(plan.request, undefined);
    if (mode === 'domain') await assert.rejects(executeSession(store, plan, host, { id: 'test-actor' }), { code: 'NativeExecutionFailed' });
    else await executeSession(store, plan, host, { id: 'test-actor' });
    const record = (await store.listSessions())[0]!;
    assert.equal(record.request, undefined);
    const files = ['task.json', 'artifacts.jsonl', 'consumptions.jsonl', `sessions/${record.id}/session.json`, `sessions/${record.id}/events.jsonl`];
    const fingerprints = () => Promise.all(files.map(async file => createHash('sha256')
      .update(await readFile(join(root, '.agent-loom', file))).digest('hex')));
    const before = await fingerprints(), canonical = await inspectTask(store);
    const loom = await connectLoom({ taskRoot: root, taskId: store.task.id });
    for (const reader of [loom, loom, await connectLoom({ taskRoot: root, taskId: store.task.id })]) {
      const facts = await reader.inspect({ session_id: record.id });
      assert.equal(facts.history, 'readable');
      const session = facts.sessions[0]!;
      assert.equal(session.request_id, null);
      assert.equal('entry_id' in session, false);
      assert.equal('identity_migration' in session && session.identity_migration, 'not-inferred');
      assert.equal(session.execution.status, mode === 'domain' ? 'failed' : 'completed');
      // Narrow through the shared facts, including request-free history.
      assert('observation' in session && session.observation.outcome_confirmed);
      if (mode === 'domain') assert('diagnostic' in session && session.diagnostic?.reason_code === 'DOMAIN_REJECTED');
      else {
        assert('aspect_failures' in session);
        assert.deepEqual(session.aspect_failures, [{ plugin_id: 'test-observer', reason_code: 'AUDIT_REJECTED' }]);
        assert('artifacts' in session && session.artifacts[0]?.id === 'artifact-one');
        assert.equal(session.execution.domain_execution_started, 'unknown');
      }
      assert.equal(JSON.stringify(facts).includes('synthetic-history-error-canary'), false);
    }
    assert.deepEqual(await fingerprints(), before);
    assert.deepEqual(await inspectTask(store), canonical);
  }
});

test('request-free and request-bearing Sessions share confirmation rules for conflicting or missing terminal evidence', async t => {
  for (const condition of ['conflicting', 'missing', 'running']) for (const withRequest of [false, true]) {
    const { store, root } = await fixture(t);
    const host: SessionHost = { request_mapping: 'v1', runtime: { id: 'test-runtime', name: 'synthetic', version: '1' },
      async validate() {}, async launch() { return { runtime_session_id: 'synthetic-native', async initialize() {},
        async run() { return { status: 'completed' }; }, async close() {} }; } };
    const request = withRequest ? createRequest(store.task.id, 'test-profile') : undefined;
    const record = await executeSession(store, await prepareSession(store, 'test-profile', undefined, request), host, { id: 'test-actor' });
    const eventsFile = join(root, '.agent-loom', 'sessions', record.id, 'events.jsonl');
    const recordFile = join(root, '.agent-loom', 'sessions', record.id, 'session.json');
    let events = (await store.listEvents(record.id));
    if (condition === 'conflicting') events.find(e => e.type === 'session.completed')!.type = 'session.failed';
    else events = events.filter(e => e.type !== 'session.completed');
    if (condition === 'running') await writeFile(recordFile, JSON.stringify({ ...record, status: 'running', finished_at: undefined }));
    await writeFile(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    const before = await readFile(eventsFile, 'utf8');
    const facts = await (await connectLoom({ taskRoot: root, taskId: store.task.id })).inspect({ session_id: record.id });
    const session = facts.sessions[0]!;
    assert.equal(session.execution.status, 'unknown');
    assert('observation' in session && session.observation.outcome_confirmed === false);
    assert.equal(session.observation.recorded_session_status, condition === 'running' ? 'running' : 'completed');
    assert('diagnostic' in session && session.diagnostic?.reason_code === 'OUTCOME_UNCONFIRMED');
    assert.equal(session.request_id, request?.request_id ?? null);
    const summary = summarizeTask(await inspectTask(store)).sessions[0]!;
    assert.equal(summary.status, condition === 'running' ? 'running' : 'completed');
    assert.deepEqual(summary.execution, session.execution);
    assert.deepEqual(summary.observation, session.observation);
    assert.equal(summary.diagnostic?.reason_code, 'OUTCOME_UNCONFIRMED');
    assert.equal(await readFile(eventsFile, 'utf8'), before);
  }
});

test('InvalidRecord diagnosis distinguishes persisted governance facts from caller rejection', () => {
  const error = new ContainerFailure('InvalidRecord', 'synthetic-raw-error-canary');
  const historical = diagnosticFor(error, 'governance-storage');
  assert.equal(historical.reason_code, 'GOVERNANCE_RECORD_INVALID');
  assert.equal(historical.boundary, 'governance-storage');
  assert.equal(diagnosticFor(error, 'request').reason_code, 'REQUEST_REJECTED');
  assert.equal(diagnosticFor(error, 'native').reason_code, 'REQUEST_REJECTED');
  assert.equal(JSON.stringify(historical).includes('synthetic-raw-error-canary'), false);
});

test('failure context survives wrapping without trusting native properties, clones or mutated messages', () => {
  const original = safeNativeFailure(reject('DOMAIN_REJECTED'), { phase: 'publication', plugin_id: 'test-domain' });
  original.message = 'synthetic-message-canary';
  const wrapped = safeNativeFailure(original, { phase: 'domain-run', plugin_id: 'outer-plugin' });
  assert.equal(diagnosticFor(wrapped, 'native').phase, 'publication');
  assert.equal(diagnosticFor(wrapped, 'native').plugin_id, 'test-domain');
  assert.equal(diagnosticFor(wrapped, 'native').reason_code, 'DOMAIN_REJECTED');
  assert.doesNotMatch(wrapped.message, /synthetic-message-canary/);
  for (const untrusted of [structuredClone(original), { diagnostic: original.details.diagnostic,
    plugin_id: 'forged-owner', phase: 'publication', message: 'synthetic-message-canary' }]) {
    const safe = diagnosticFor(safeNativeFailure(untrusted, { phase: 'domain-run' }), 'native');
    assert.equal(safe.phase, 'domain-run');
    assert.equal(safe.plugin_id, undefined);
    assert.equal(safe.reason_code, 'NATIVE_EXECUTION_FAILED');
  }
  const unknown = safeNativeFailure(new Error(), { phase: 'resource-loading' });
  assert.equal(diagnosticFor(safeNativeFailure(unknown, { phase: 'initialization', plugin_id: 'outer-plugin' }), 'native').plugin_id, undefined);
  const stored = diagnosticFor(wrapped, 'native');
  assert.deepEqual(readSafeDiagnostic(JSON.parse(JSON.stringify(stored))), stored);
  assert.equal(readSafeDiagnostic({ ...stored, phase: 'unreviewed-phase' }), undefined);
  assert.equal(readSafeDiagnostic({ ...stored, plugin_id: '../outside' }), undefined);
});
