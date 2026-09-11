import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile, appendFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LocalTaskStore, ContainerFailure, withTaskWriter } from '../../dist/packages/container-core/src/index.js';
import { connectLoom, createRequest } from '../../dist/packages/container-core/src/agent.js';

async function fixture(t, mode = 'completed') {
  const root = await mkdtemp(join(tmpdir(), 'loom-writer-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const application = { id: 'synthetic', version: '1', runtime: { id: 'synthetic', version: '1' },
    plugins: [{ id: 'domain', role: 'domain', native: { runtime: 'synthetic', binding_key: 'domain' }, capabilities: [], produces: [] }],
    profiles: [{ id: 'run', primary: 'domain', aspects: [], requirements: [], entry: {
      id: 'sample.run', purpose: 'Synthetic startup test', implementation: 'synthetic', request_mapping: 'v1', effect_declarations: [] } }] };
  const store = await LocalTaskStore.create(root, { schema_version: 2, id: 'task', application_id: application.id,
    application, title: 'Synthetic Task', created_at: new Date().toISOString() });
  const state = { factories: 0, launches: 0, runs: 0 };
  const host = { actor: { id: 'actor' }, async createHost({ store: active }) {
    state.factories++;
    await appendFile(join(root, 'startup-effects.txt'), 'startup\n');
    if (mode === 'factory') throw new Error('Synthetic factory failure');
    if (mode === 'registration') active.startSession = async () => { throw new ContainerFailure('StorageFailure', 'Synthetic registration failure'); };
    if (mode === 'settlement') active.settleSession = async () => { throw new ContainerFailure('StorageFailure', 'Synthetic settlement failure'); };
    if (mode === 'inspection') active.readInspectionRecords = async () => { throw new ContainerFailure('StorageFailure', 'Synthetic read failure'); };
    return { runtime: { id: 'synthetic', name: 'synthetic', version: '1' }, request_mapping: 'v1',
      async validate() { if (mode === 'validate') throw new Error('Synthetic validation failure'); },
      async launch() {
        state.launches++;
        if (mode === 'launch') throw new Error('Synthetic launch failure');
        return { runtime_session_id: 'synthetic-native', async initialize() {},
          async run() { state.runs++; return { status: mode === 'failed' ? 'failed' : 'completed' }; }, async close() {} };
      } };
  } };
  return { root, store, state, host, lock: join(root, '.agent-loom', 'writer.lock'),
    request: () => ({ ...createRequest(store.task.id, 'sample.run'), instruction: 'private-instruction-canary', data: { value: 'private-data-canary' } }),
    connect: () => connectLoom({ taskRoot: root, taskId: store.task.id, host, writer_policy: 'exclusive' }) };
}

test('unknown startup remains blocked in the same and new connections before and after Session registration', async t => {
  for (const mode of ['factory', 'validate', 'launch', 'registration', 'settlement', 'inspection']) {
    for (const reconnect of [false, true]) {
      const f = await fixture(t, mode); const loom = await f.connect(); const request = f.request();
      const first = await loom.invoke(request);
      assert.equal(first.execution.status, 'unknown', mode);
      assert.equal(first.observation.outcome_confirmed, false);
      assert.equal(first.observation.history, mode === 'inspection' ? 'unreadable' : 'readable');
      if (mode === 'registration') assert.equal(first.diagnostic.reason_code, 'GOVERNANCE_STORAGE_FAILED');
      const sessions = await f.store.listSessions();
      assert.equal(sessions.length, ['settlement', 'inspection'].includes(mode) ? 1 : 0);
      const raw = await readFile(f.lock, 'utf8'); const lock = JSON.parse(raw);
      assert.equal(lock.task_id, 'task'); assert.equal(lock.request_id, request.request_id); assert.equal(lock.entry_id, request.entry_id);
      assert.doesNotMatch(raw, /private-instruction-canary|private-data-canary/);
      const before = { ...f.state };
      const next = await (reconnect ? await f.connect() : loom).invoke(f.request());
      assert.equal(next.execution.status, 'not-started');
      assert.equal(next.observation.history, 'not-checked');
      assert.equal(next.diagnostic.reason_code, 'TASK_WRITER_BUSY');
      assert.deepEqual(f.state, before);
      assert.equal(await readFile(join(f.root, 'startup-effects.txt'), 'utf8'), 'startup\n');
    }
  }
});

test('confirmed success, confirmed failure and pre-Host rejection permit normal lock cleanup', async t => {
  for (const mode of ['completed', 'failed']) {
    const f = await fixture(t, mode); const loom = await f.connect();
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await loom.invoke(f.request());
      assert.equal(result.execution.status, mode); assert.equal(result.observation.outcome_confirmed, true);
      await assert.rejects(readFile(f.lock), { code: 'ENOENT' });
    }
    assert.equal(f.state.runs, 2);
  }
  const f = await fixture(t);
  const unavailable = await connectLoom({ taskRoot: f.root, taskId: 'task', writer_policy: 'exclusive' });
  assert.equal((await unavailable.invoke(f.request())).execution.status, 'not-started');
  await assert.rejects(readFile(f.lock), { code: 'ENOENT' });
  assert.equal(f.state.factories, 0);
});

test('retention survives callback exceptions and can be cleared only during its owning callback', async t => {
  const f = await fixture(t); let saved;
  await withTaskWriter(f.store, async lease => { saved = lease; lease.retainOnExit(); lease.releaseOnExit(); });
  await assert.rejects(readFile(f.lock), { code: 'ENOENT' });
  assert.throws(() => saved.retainOnExit(), { code: 'InvalidTransition' });
  const original = new Error('Synthetic operation failure');
  await assert.rejects(withTaskWriter(f.store, async lease => { lease.retainOnExit(); throw original; }), error => error === original);
  await assert.rejects(withTaskWriter(f.store, async () => assert.fail('Must remain blocked')), { code: 'TaskWriterBusy' });
});

test('failure to persist lock ownership never enters Host or claims to have read history', async t => {
  const f = await fixture(t); const loom = await f.connect();
  const handle = await open(join(f.root, 'prototype-probe'), 'wx');
  const prototype = Object.getPrototypeOf(handle); const descriptor = Object.getOwnPropertyDescriptor(prototype, 'sync');
  await handle.close();
  let result;
  try {
    Object.defineProperty(prototype, 'sync', { ...descriptor, value: async () => { throw new Error('Synthetic sync failure'); } });
    result = await loom.invoke(f.request());
  } finally { Object.defineProperty(prototype, 'sync', descriptor); }
  assert.equal(result.execution.status, 'not-started'); assert.equal(result.observation.history, 'not-checked');
  assert.equal(result.diagnostic.reason_code, 'GOVERNANCE_STORAGE_FAILED'); assert.equal(f.state.factories, 0);
});

test('history observation distinguishes no read, successful read and actual read failure', async t => {
  const f = await fixture(t); const loom = await f.connect();
  const original = LocalTaskStore.prototype.readInspectionRecords; let reads = 0;
  try {
    LocalTaskStore.prototype.readInspectionRecords = function (...args) { reads++; return original.apply(this, args); };
    const busy = await withTaskWriter(f.store, () => loom.invoke(f.request()));
    assert.equal(busy.observation.history, 'not-checked'); assert.equal(reads, 0);
    assert.equal((await loom.inspect()).history, 'readable'); assert.equal(reads, 1);
    await writeFile(join(f.root, '.agent-loom', 'artifacts.jsonl'), '{truncated');
    const failed = await loom.invoke(f.request());
    assert.equal(failed.observation.history, 'unreadable'); assert.equal(reads, 2);
    assert.equal(failed.diagnostic.reason_code, 'GOVERNANCE_STORAGE_FAILED'); assert.equal(f.state.factories, 0);
  } finally { LocalTaskStore.prototype.readInspectionRecords = original; }
  const g = await fixture(t, 'registration');
  const direct = await connectLoom({ taskRoot: g.root, taskId: 'task', host: g.host });
  const receipt = await direct.invoke(g.request());
  assert.equal(receipt.execution.status, 'unknown'); assert.equal(receipt.observation.history, 'readable');
  assert.equal((await direct.inspect()).history, 'readable');
});

test('separate CLI processes retain unknown startup and report busy history as not checked', async t => {
  const f = await fixture(t); const file = join(f.root, 'request.json'); const host = join(f.root, 'host.mjs');
  await writeFile(file, JSON.stringify(f.request()));
  await writeFile(host, `import { appendFile } from 'node:fs/promises'; import { join } from 'node:path';
    export function createSessionHost({store}) { return { request_mapping:'v1', runtime:{id:'synthetic',name:'synthetic',version:'1'},
      async validate(){}, async launch(){ await appendFile(join(store.taskRoot,'cli-effects.txt'),'startup\\n'); throw new Error('Synthetic startup failure'); } }; }`);
  const args = [resolve('bin/loom.mjs'), 'agent', 'invoke', '--task', 'task', '--root', f.root,
    '--host-module', host, '--request', file, '--exclusive-writer', '--json'];
  const run = () => spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const first = run(); assert.equal(first.status, 1, first.stderr);
  assert.equal(JSON.parse(first.stdout).execution.status, 'unknown');
  const second = run(); assert.equal(second.status, 1, second.stderr);
  const blocked = JSON.parse(second.stdout);
  assert.equal(blocked.diagnostic.reason_code, 'TASK_WRITER_BUSY'); assert.equal(blocked.observation.history, 'not-checked');
  assert.equal(await readFile(join(f.root, 'cli-effects.txt'), 'utf8'), 'startup\n');
  assert.deepEqual(await f.store.listSessions(), []);
});
