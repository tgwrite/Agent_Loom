import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as core from '../../dist/packages/container-core/src/index.js';
import { connectLoom, createRequest } from '../../dist/packages/container-core/src/agent.js';

async function fixture(t, mode = '', names = ['source']) {
  const root = await mkdtemp(join(tmpdir(), 'loom-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const application = { id: 'synthetic-app', version: '1', runtime: { id: 'synthetic', version: '1' },
    plugins: [{ id: 'domain', role: 'domain', native: { runtime: 'synthetic', binding_key: 'domain' },
      capabilities: [], produces: [{ type: 'sample', version: '1' }] }],
    profiles: [{ id: 'producer', primary: 'domain', aspects: [], requirements: [] },
      { id: 'consumer', primary: 'domain', aspects: [], requirements: names.map(input_name =>
        ({ input_name, type: 'sample', version: '1', verification_status: 'READY' })) }] };
  const store = await core.LocalTaskStore.create(root, { schema_version: 2, id: 'task-one', application_id: application.id,
    application, title: 'Synthetic contract Task', created_at: new Date().toISOString() });
  const state = { mode, runs: 0, native: 0 };
  const rejected = core.registerSafeDiagnostics('domain', ['DOMAIN_REJECTED']);
  const binding = { actor: { id: 'synthetic-actor' }, createHost({ store: active }) {
    if (state.mode === 'once') {
      const append = active.appendEvent.bind(active); let injected = false;
      active.appendEvent = async event => {
        if (!injected && event.type === 'runtime.loom.domain-started') {
          injected = true; throw new core.ContainerFailure('StorageFailure', 'Synthetic failure.');
        }
        return append(event);
      };
    }
    if (state.mode === 'settle') active.settleSession = async () => { throw new core.ContainerFailure('StorageFailure', 'Synthetic failure.'); };
    if (state.mode === 'partial-consumption') {
      const record = active.recordConsumption.bind(active); let count = 0;
      active.recordConsumption = async value => {
        if (++count === 2) throw new core.ContainerFailure('StorageFailure', 'Synthetic failure.');
        return record(value);
      };
    }
    return { request_mapping: 'v1', runtime: { id: 'synthetic', name: 'synthetic', version: '1' },
      async validate() {}, async launch() {
        if (state.mode === 'launch') throw new Error('synthetic-error-canary');
        return { runtime_session_id: 'synthetic-native', async initialize() {
          if (state.mode === 'initialize') throw rejected('DOMAIN_REJECTED');
        }, async run() {
          state.runs++;
          if (state.mode === 'throw') throw rejected('DOMAIN_REJECTED');
          if (['return', 'clone', 'forged'].includes(state.mode)) {
            let failure = core.createNativeFailure(rejected('DOMAIN_REJECTED'));
            if (state.mode === 'clone') failure = structuredClone(failure);
            if (state.mode === 'forged') failure = { ...failure, message: 'synthetic-error-canary', diagnostic: {
              diagnostic_version: 1, boundary: 'domain', reason_code: 'FORGED', retry_safety: 'not-established' } };
            return { status: 'failed', failure };
          }
          return { status: 'completed' };
        }, async close() {} };
      } };
  } };
  const loom = await connectLoom({ taskRoot: root, taskId: store.task.id, host: binding });
  const request = (profile = 'producer', inputs) => ({ ...createRequest(store.task.id, profile), ...(inputs ? { inputs } : {}) });
  const cold = () => connectLoom({ taskRoot: root, taskId: store.task.id });
  async function publish(id) {
    const stamp = new Date().toISOString();
    await store.startSession({ id: `producer-${id}`, task_id: store.task.id, profile_id: 'producer', workspace: '.',
      primary_plugin_id: 'domain', aspect_plugin_ids: [], plugin_ids: ['domain'], actor: binding.actor,
      runtime: { id: 'synthetic', name: 'synthetic', version: '1' }, status: 'running', started_at: stamp });
    await store.publishArtifact({ id, task_id: store.task.id, type: 'sample', version: '1',
      producer: { session_id: `producer-${id}`, plugin_id: 'domain', capability_id: 'publish' },
      executor: { actor_id: binding.actor.id, runtime_id: 'synthetic' }, verification: { status: 'READY' },
      payload_ref: { kind: 'file', path: 'synthetic.json' }, sha256: 'a'.repeat(64), created_at: stamp });
    await store.settleSession(`producer-${id}`, 'completed', stamp);
  }
  return { root, store, state, binding, loom, request, cold, publish };
}

test('receipts and cold queries agree after one-shot and persistent settlement failures', async t => {
  for (const mode of ['once', 'settle']) {
    const f = await fixture(t, mode); const result = await f.loom.invoke(f.request());
    const expected = mode === 'once' ? 'failed' : 'unknown';
    assert.equal(result.execution.status, expected);
    for (const reader of [f.loom, await f.cold()]) {
      const queried = (await reader.inspect({ session_id: result.session_id })).sessions[0];
      assert.deepEqual(queried.execution, result.execution);
      assert.deepEqual(queried.diagnostic, result.diagnostic);
      assert.deepEqual(queried.observation, result.observation);
    }
    assert.equal(result.observation.recorded_session_status, mode === 'once' ? 'failed' : 'running');
    assert.equal(result.observation.outcome_confirmed, mode === 'once');
    assert.equal(f.state.runs, mode === 'once' ? 0 : 1);
  }
});

test('resolved names and successful consumptions survive changed candidates and initialization rejection', async t => {
  const f = await fixture(t); await f.publish('source-one');
  const first = await f.loom.invoke(f.request('consumer'));
  await f.publish('source-two');
  const second = await f.loom.invoke(f.request('consumer', { source: { artifact_id: 'source-two' } }));
  f.state.mode = 'initialize';
  const refused = await f.loom.invoke(f.request('consumer', { source: { artifact_id: 'source-one' } }));
  const reader = await f.cold();
  for (const [receipt, id] of [[first, 'source-one'], [second, 'source-two']]) {
    const cold = (await reader.inspect({ session_id: receipt.session_id })).sessions[0];
    assert.equal(cold.resolved_inputs.status, 'recorded');
    assert.equal(cold.resolved_inputs.bindings[0].artifact_id, id);
    assert.equal(cold.consumed[0].artifact_id, id);
    assert.equal(cold.consumed[0].accepted_sha256, 'a'.repeat(64));
    assert.equal(cold.consumed[0].producer_session_id, `producer-${id}`);
    assert.deepEqual(cold.consumed[0].input_names, ['source']);
    assert.deepEqual(cold, receipt);
  }
  assert.equal(refused.resolved_inputs.bindings[0].artifact_id, 'source-one');
  assert.deepEqual(refused.consumed, []);
  const related = await reader.inspect({ artifact_id: 'source-one' });
  assert(related.sessions.some(s => s.session_id === refused.session_id));
  assert.equal(related.artifacts[0].consumers.length, 1);
  assert.equal(related.artifacts[0].consumers[0].consumer_session_id, first.session_id);
});

test('Check reports attempted failures independently from skipped or unsupported checks', async t => {
  const f = await fixture(t);
  for (const mode of ['bindings', 'native', 'unsupported', 'passed']) {
    const loom = await connectLoom({ taskRoot: f.root, taskId: f.store.task.id, host: { ...f.binding,
      async checkBindings() { if (mode === 'bindings') throw new Error('synthetic-error-canary'); },
      ...(mode === 'unsupported' ? {} : { async nativePreflight() {
        f.state.native++; if (mode === 'native') throw new Error('synthetic-error-canary');
      } }) } });
    const result = await loom.check(f.request(), { native_preflight: true });
    assert.equal(result.host.bindings, mode === 'bindings' ? 'failed' : 'passed');
    assert.equal(result.native_preflight.status, ['bindings', 'unsupported'].includes(mode) ? 'not-checked' : mode === 'native' ? 'failed' : 'passed');
    assert.equal(result.native_preflight.effect_scope, ['bindings', 'unsupported'].includes(mode) ? 'none' : 'trusted-native-code-may-load');
    assert.equal(JSON.stringify(result).includes('synthetic-error-canary'), false);
  }
  assert.equal(f.state.native, 2);
});

test('trusted return and throw failures retain equal reasons; clones and forgeries do not gain trust', async t => {
  for (const mode of ['throw', 'return', 'clone', 'forged']) {
    const f = await fixture(t, mode); const receipt = await f.loom.invoke(f.request());
    assert.equal(receipt.execution.status, 'failed');
    assert.equal(receipt.diagnostic.reason_code, ['throw', 'return'].includes(mode) ? 'DOMAIN_REJECTED' : 'NATIVE_EXECUTION_FAILED');
    const cold = await (await f.cold()).inspect({ session_id: receipt.session_id });
    assert.deepEqual(cold.sessions[0].diagnostic, receipt.diagnostic);
    assert.equal(JSON.stringify(await f.store.getSession(receipt.session_id)).includes('synthetic-error-canary'), false);
  }
});

test('CLI preserves cold lineage, reports unreadable history nonzero, and attributes loading failures', async t => {
  const f = await fixture(t); const receipt = await f.loom.invoke(f.request());
  const cli = args => spawnSync(process.execPath, [resolve('bin/loom.mjs'), ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, LOOM_STATE_DIR: join(f.root, 'index') } });
  const args = ['agent', 'inspect', '--task', f.store.task.id, '--root', f.root];
  const good = cli(args); assert.equal(good.status, 0);
  assert.deepEqual(JSON.parse(good.stdout).sessions[0], receipt);
  const missing = cli(['agent', 'inspect', '--task', 'missing', '--root', join(f.root, 'missing')]);
  const error = JSON.parse(missing.stderr);
  assert.equal(error.diagnostic.command, 'agent inspect'); assert.equal(error.diagnostic.phase, 'task-loading');
  await writeFile(join(f.root, '.agent-loom', 'sessions', receipt.session_id, 'events.jsonl'), 'malformed');
  const broken = cli(args); assert.equal(broken.status, 1); assert.equal(JSON.parse(broken.stdout).history, 'unreadable');
});

test('conflicting terminal events and allocated but unrecorded launches cannot confirm an outcome', async t => {
  const f = await fixture(t); const receipt = await f.loom.invoke(f.request());
  const file = join(f.root, '.agent-loom', 'sessions', receipt.session_id, 'events.jsonl');
  const events = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  events.find(e => e.type === 'session.completed').type = 'session.failed';
  await writeFile(file, events.map(JSON.stringify).join('\n') + '\n');
  const changed = (await (await f.cold()).inspect()).sessions[0];
  assert.equal(changed.execution.status, 'unknown'); assert.equal(changed.observation.recorded_session_status, 'completed');
  const g = await fixture(t, 'launch'); const launched = await g.loom.invoke(g.request());
  assert.equal(launched.execution.status, 'unknown'); assert(launched.session_id);
  assert.equal((await g.store.listSessions()).length, 0);
});

test('multiple input names share a consumption record without losing bindings', async t => {
  const f = await fixture(t, '', ['left', 'right']); await f.publish('source-one');
  const receipt = await f.loom.invoke(f.request('consumer'));
  assert.equal(receipt.resolved_inputs.bindings.length, 2);
  assert.equal(receipt.consumed.length, 1);
  assert.deepEqual(receipt.consumed[0].input_names, ['left', 'right']);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { connectLoom } from './dist/packages/container-core/src/agent.js'; const loom = await connectLoom({taskRoot:process.argv[1],taskId:'task-one'}); console.log(JSON.stringify(await loom.inspect({session_id:process.argv[2]})));",
    f.root, receipt.session_id], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(child.status, 0); assert.deepEqual(JSON.parse(child.stdout).sessions[0], receipt);
});

test('partial consumption failure exposes only durable accepts and does not run the domain', async t => {
  const f = await fixture(t, 'partial-consumption', ['left', 'right']);
  await f.publish('source-one'); await f.publish('source-two');
  const receipt = await f.loom.invoke(f.request('consumer', { left: { artifact_id: 'source-one' }, right: { artifact_id: 'source-two' } }));
  assert.equal(receipt.execution.status, 'failed'); assert.equal(f.state.runs, 0);
  assert.equal(receipt.resolved_inputs.bindings.length, 2);
  assert.deepEqual(receipt.consumed.map(c => c.artifact_id), ['source-one']);
  assert.deepEqual((await (await f.cold()).inspect({ session_id: receipt.session_id })).sessions[0], receipt);
});

test('startup rejects forged binding snapshots and cold queries detect changed digests', async t => {
  const f = await fixture(t); await f.publish('source-one');
  const good = await f.loom.invoke(f.request('consumer'));
  const record = await f.store.getSession(good.session_id);
  const forged = { ...record, id: 'forged', status: 'running', finished_at: undefined,
    resolved_inputs: { binding_version: 1, bindings: [{ requirement_index: 0, input_name: 'source', artifact_id: 'source-one', sha256: 'b'.repeat(64) }] } };
  await assert.rejects(f.store.startSession(forged), { code: 'InvalidRecord' });
  assert.equal((await f.store.listSessions()).length, 2);
  const file = join(f.root, '.agent-loom', 'sessions', record.id, 'session.json');
  await writeFile(file, JSON.stringify({ ...record, resolved_inputs: forged.resolved_inputs }));
  const invalid = await (await f.cold()).inspect();
  assert.equal(invalid.history, 'unreadable');
  assert.equal(invalid.diagnostic.boundary, 'governance-storage');
  assert.equal(invalid.diagnostic.reason_code, 'GOVERNANCE_RECORD_INVALID');
  assert.equal(JSON.stringify(invalid).includes('b'.repeat(64)), false);
  const rejected = await f.loom.invoke(f.request());
  assert.equal(rejected.execution.status, 'unknown');
  assert.equal(rejected.diagnostic.reason_code, 'GOVERNANCE_RECORD_INVALID');
  await assert.rejects(f.loom.invoke({ ...f.request(), task_id: 'another-task' }), error => {
    assert.equal(error.code, 'InvalidRecord');
    assert.equal(core.diagnosticFor(error, 'request').reason_code, 'REQUEST_REJECTED');
    return true;
  });
});

test('old Sessions retain consumption facts without inventing historical input names', async t => {
  const f = await fixture(t); await f.publish('source-one');
  const receipt = await f.loom.invoke(f.request('consumer'));
  const record = await f.store.getSession(receipt.session_id);
  delete record.resolved_inputs;
  const file = join(f.root, '.agent-loom', 'sessions', record.id, 'session.json');
  await writeFile(file, JSON.stringify(record));
  const historical = (await (await f.cold()).inspect({ session_id: record.id })).sessions[0];
  assert.equal(historical.resolved_inputs.status, 'unavailable');
  assert.equal(historical.consumed[0].artifact_id, 'source-one');
  assert.equal(historical.consumed[0].input_names, null);
  delete record.request;
  await writeFile(file, JSON.stringify(record));
  const legacy = (await (await f.cold()).inspect({ session_id: record.id })).sessions[0];
  assert.equal(legacy.request_id, null); assert.equal(legacy.consumed[0].artifact_id, 'source-one');
  assert.equal(legacy.consumed[0].input_names, null);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), record);
});
