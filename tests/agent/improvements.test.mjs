import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalTaskStore, validateApplication, prepareSession, withTaskWriter, recordParticipantObservation } from '../../dist/packages/container-core/src/index.js';
import { connectLoom, describeEntry, createRequest } from '../../dist/packages/container-core/src/agent.js';

function application(entry = {}) {
  return { id: 'sample', version: '1', runtime: { id: 'synthetic', version: '1' },
    plugins: [{ id: 'domain', role: 'domain', native: { runtime: 'synthetic', binding_key: 'domain' }, capabilities: [], produces: [] }],
    profiles: [{ id: 'run', primary: 'domain', aspects: [], requirements: [], entry: {
      id: 'sample.run', purpose: 'Synthetic operation', implementation: 'synthetic', request_mapping: 'v1', effect_declarations: [], ...entry } }] };
}
const schema = { type: 'object', required: ['sources'], additionalProperties: false,
  properties: { sources: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    limit: { type: 'integer', minimum: 1, maximum: 3 }, locale: { enum: ['zh', 'en'] } } };

async function fixture(t, app = application()) {
  const root = await mkdtemp(join(tmpdir(), 'loom-improvements-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await LocalTaskStore.create(root, { schema_version: 2, id: 'sample-task', application_id: app.id,
    application: app, title: 'Synthetic Task', created_at: new Date().toISOString() });
  let created = 0;
  const host = { actor: { id: 'synthetic-actor' }, async createHost() {
    created++;
    return { request_mapping: 'v1', runtime: { id: 'synthetic', name: 'synthetic', version: '1' }, async validate() {},
      async launch() { return { runtime_session_id: 'synthetic-session', async initialize() {},
        async run() { return { status: 'completed' }; }, async close() {} }; } };
  } };
  return { root, store, host, created: () => created, loom: await connectLoom({ taskRoot: root, taskId: store.task.id, host }),
    request: () => createRequest(store.task.id, 'sample.run') };
}

test('declared data contracts are discoverable and reject bad input before any Host or Session', async t => {
  const example = { sources: ['sample-page'], limit: 2, locale: 'zh' };
  const f = await fixture(t, application({ data_schema: schema, data_required: true, data_examples: [example] }));
  const described = f.loom.describe('sample.run');
  assert.deepEqual(described.request_schema.properties.data, schema);
  assert.ok(described.request_schema.required.includes('data'));
  assert.deepEqual(described.data_examples, [example]);
  for (const [data, path, rule] of [[undefined, 'data', 'required'], [{}, 'data.sources', 'required'],
    [{ sources: [42] }, 'data.sources[0]', 'type'], [{ sources: [] }, 'data.sources', 'minItems'],
    [{ sources: ['ok'], limit: 4 }, 'data.limit', 'maximum'],
    [{ sources: ['ok'], 'unknown-private-canary': 'secret-canary' }, 'data', 'additionalProperties']]) {
    const request = { ...f.request(), ...(data === undefined ? {} : { data }) };
    const matches = error => { assert.equal(error.code, 'InvalidArguments'); assert.deepEqual(error.details, { path, rule });
      assert.doesNotMatch(JSON.stringify(error), /private-canary|secret-canary/); return true; };
    await assert.rejects(f.loom.check(request), matches);
    await assert.rejects(f.loom.invoke(request), matches);
    await assert.rejects(prepareSession(f.store, 'run', undefined, request), matches);
  }
  await assert.rejects(prepareSession(f.store, 'run'), { code: 'InvalidArguments' });
  assert.equal(f.created(), 0); assert.deepEqual(await f.store.listSessions(), []);
  const request = { ...f.request(), data: example };
  assert.equal((await f.loom.check(request)).blockers.length, 0);
  assert.equal((await f.loom.invoke(request)).execution.status, 'completed');
});

test('Schema declarations reject unsupported features and inconsistent examples; old entries remain compatible', async t => {
  for (const data_schema of [{ $ref: 'private-canary' }, { type: ['string', 'null'] },
    { properties: { 'private/path': {} } }, { minLength: -1 }, { enum: [] }, { enum: [0, -0] }, new Date(), { items: { format: 'uri' } }]) {
    assert.throws(() => validateApplication(application({ data_schema })), error => {
      assert.equal(error.code, 'InvalidDefinition'); assert.doesNotMatch(JSON.stringify(error), /private-canary|private\/path/); return true;
    });
  }
  assert.throws(() => validateApplication(application({ data_schema: schema, data_examples: [{}] })), { code: 'InvalidDefinition' });
  const f = await fixture(t);
  assert.equal(describeEntry(f.store.task.application, 'sample.run').parameter_validation.data, 'application-owned');
  assert.equal((await f.loom.invoke({ ...f.request(), data: { free: 'value' } })).execution.status, 'completed');
  const unicode = await fixture(t, application({ data_schema: { type: 'string', minLength: 1, maxLength: 1 } }));
  assert.equal((await unicode.loom.check({ ...unicode.request(), data: '🌍' })).blockers.length, 0);
  const numbers = await fixture(t, application({ data_schema: { const: { zero: 0, values: [0, 1] } } }));
  assert.equal((await numbers.loom.check({ ...numbers.request(), data: { values: [-0, 1], zero: -0 } })).blockers.length, 0);
});

test('request ID queries summarize attempts without payloads and do not infer idempotency', async t => {
  const f = await fixture(t);
  const request = { ...f.request(), data: { label: 'private-data-canary', count: 1 }, instruction: 'private-instruction-canary' };
  assert.equal((await f.loom.inspect({ request_id: request.request_id })).operation.status, 'not-recorded');
  const first = await f.loom.invoke(request);
  await f.loom.invoke({ ...request, data: { count: 1, label: 'private-data-canary' } });
  const cold = await connectLoom({ taskRoot: f.root, taskId: f.store.task.id });
  const same = await cold.inspect({ request_id: request.request_id, session_id: first.session_id });
  assert.equal(same.sessions.length, 1); assert.equal(same.operation.attempt_count, 2);
  assert.equal(same.operation.request_consistency, 'same'); assert.equal(same.operation.status, 'all-confirmed');
  assert.equal(same.operation.idempotency, 'not-provided');
  assert.doesNotMatch(JSON.stringify(same), /private-data-canary|private-instruction-canary/);
  await f.loom.invoke({ ...request, data: { label: 'changed' } });
  assert.equal((await cold.inspect({ request_id: request.request_id })).operation.status, 'conflicting-requests');
});

test('exclusive invocation blocks competing writers and rechecks unconfirmed history under ownership', async t => {
  const f = await fixture(t);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const host = { ...f.host, async createHost(context) {
    const original = await f.host.createHost(context);
    return { ...original, async launch(...args) {
      const handle = await original.launch(...args);
      return { ...handle, async run() { entered(); await gate; return handle.run(); } };
    } };
  } };
  const loom = await connectLoom({ taskRoot: f.root, taskId: f.store.task.id, host, writer_policy: 'exclusive' });
  const first = loom.invoke(f.request());
  await started;
  try {
    const blocked = await loom.invoke(f.request());
    assert.equal(blocked.execution.status, 'not-started'); assert.equal(blocked.diagnostic.reason_code, 'TASK_WRITER_BUSY');
    assert.equal(f.created(), 1);
  } finally { release(); }
  const completed = await first;
  assert.equal(completed.execution.status, 'completed');
  await assert.rejects(readFile(join(f.root, '.agent-loom', 'writer.lock')), { code: 'ENOENT' });
  const record = await f.store.getSession(completed.session_id);
  const { finished_at, ...pending } = record;
  await withTaskWriter(f.store, () => f.store.startSession({ ...pending, id: 'pending', status: 'running' }));
  const denied = await loom.invoke(f.request());
  assert.equal(denied.diagnostic.reason_code, 'TASK_OUTCOME_UNCONFIRMED'); assert.equal(f.created(), 1);
  assert.equal((await loom.inspect({ request_id: record.request.request_id })).operation.status, 'unconfirmed');
});

test('writer ownership works across processes and cleanup never removes another owner', async t => {
  const f = await fixture(t);
  const module = new URL('../../dist/packages/container-core/src/index.js', import.meta.url).href;
  await withTaskWriter(f.store, async () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {LocalTaskStore,withTaskWriter} from ${JSON.stringify(module)};
       try { await withTaskWriter(await LocalTaskStore.open(process.argv[1]), async()=>{}); process.exitCode=2; }
       catch(e) { process.exitCode=e.code==='TaskWriterBusy'?0:3; }`, f.root], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
  });
  const original = new Error('operation failed');
  await assert.rejects(withTaskWriter(f.store, async () => { throw original; }), error => error === original);
  const lock = join(f.root, '.agent-loom', 'writer.lock');
  await assert.rejects(withTaskWriter(f.store, async () => { await writeFile(lock, 'another-owner'); }), { code: 'TaskWriterReleaseFailed' });
  assert.equal(await readFile(lock, 'utf8'), 'another-owner');
  await assert.rejects(withTaskWriter(f.store, async () => { assert.fail('must not run'); }), { code: 'TaskWriterBusy' });
});

test('lock release failure preserves confirmed execution and blocks subsequent writers', async t => {
  const f = await fixture(t);
  const host = { ...f.host, async createHost(context) {
    const original = await f.host.createHost(context);
    return { ...original, async launch(...args) {
      const handle = await original.launch(...args);
      return { ...handle, async close() { await handle.close(); await writeFile(join(f.root, '.agent-loom', 'writer.lock'), 'replacement-owner'); } };
    } };
  } };
  const loom = await connectLoom({ taskRoot: f.root, taskId: f.store.task.id, host, writer_policy: 'exclusive' });
  const result = await loom.invoke(f.request());
  assert.equal(result.execution.status, 'completed');
  assert.equal(result.call_diagnostic.reason_code, 'TASK_WRITER_RELEASE_FAILED');
  assert.deepEqual((await loom.inspect({ session_id: result.session_id })).sessions[0].execution, result.execution);
  assert.equal((await loom.invoke(f.request())).diagnostic.reason_code, 'TASK_WRITER_BUSY');
  assert.equal(f.created(), 1);
});

test('participant summaries distinguish observations and link only app-declared acceptance artifacts', async t => {
  const app = application({ acceptance_artifacts: [{ type: 'audit.report', version: '1', producer_plugin_id: 'audit' }] });
  app.plugins.push({ id: 'audit', role: 'aspect', native: { runtime: 'synthetic', binding_key: 'audit' }, capabilities: [],
    produces: [{ type: 'audit.report', version: '1' }, { type: 'audit.other', version: '1' }] });
  app.profiles[0].aspects.push('audit');
  const f = await fixture(t, app);
  for (const mode of ['absent', 'publication', 'completed', 'failed', 'incomplete']) {
    const request = f.request(); const stamp = new Date().toISOString();
    await f.store.startSession({ id: mode, task_id: f.store.task.id, profile_id: 'run', workspace: '.', request,
      primary_plugin_id: 'domain', aspect_plugin_ids: ['audit'], plugin_ids: ['domain', 'audit'], actor: { id: 'actor' },
      runtime: { id: 'synthetic', name: 'synthetic', version: '1' }, status: 'running', started_at: stamp });
    await assert.rejects(recordParticipantObservation(f.store, mode, { plugin_id: 'domain', phase: 'aspect-after-run', status: 'started' }), { code: 'InvalidRecord' });
    if (mode !== 'absent') for (const type of ['audit.report', 'audit.other']) await f.store.publishArtifact({
      id: `${mode}-${type.replace('.', '-')}`, type, version: '1', task_id: f.store.task.id,
      producer: { session_id: mode, plugin_id: 'audit', capability_id: 'publish' }, executor: { actor_id: 'actor', runtime_id: 'synthetic' },
      payload_ref: { kind: 'file', path: 'synthetic.json' }, sha256: 'a'.repeat(64), verification: { status: 'READY' }, created_at: stamp });
    if (mode === 'completed' || mode === 'incomplete') for (const phase of mode === 'completed' ? ['started', 'completed'] : ['completed'])
      await recordParticipantObservation(f.store, mode, { plugin_id: 'audit', phase: 'aspect-after-run', status: phase, extra: 'private-observation-canary' });
    if (mode === 'failed') await f.store.recordObserverFailure(mode, 'audit', {
      code: 'SyntheticFailure', message: 'Synthetic aspect failure.', source: 'audit', timestamp: stamp });
    await f.store.settleSession(mode, 'completed', stamp);
    assert.doesNotMatch(JSON.stringify(await f.store.listEvents(mode)), /private-observation-canary/);
    const receipt = (await f.loom.inspect({ request_id: request.request_id })).sessions[0];
    assert.equal(receipt.execution.status, 'completed');
    assert.equal(receipt.participants.aspects[0].status,
      { absent: 'not-observed', publication: 'publication-observed', completed: 'completed', failed: 'failed', incomplete: 'unconfirmed' }[mode]);
    assert.equal(receipt.business_acceptance.status, 'not-evaluated');
    assert.deepEqual(receipt.business_acceptance.references.map(ref => ref.type), mode === 'absent' ? [] : ['audit.report']);
  }
  const invalid = structuredClone(app); invalid.profiles[0].entry.acceptance_artifacts[0].producer_plugin_id = 'domain';
  assert.throws(() => validateApplication(invalid), { code: 'InvalidDefinition' });
});
