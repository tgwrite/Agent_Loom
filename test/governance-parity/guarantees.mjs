import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { arms } from './arms.mjs';
import { task, session, artifact, failure, fakeOptions, interceptIO, writeKind, barrier, stamp } from './probes.mjs';
import { containedFile, sha256 } from '../lightweight/handoff.mjs';

const cases = [];
function check(g, name, action) { cases.push({ id: `${g}:${name}`, guarantee: g, action }); }
const publication = (path = 'payload.txt') => ({ type: 'source', version: '1', path, verification_status: 'READY' });
async function start(f, behavior = {}, profile = 'producer') {
  const native = await fakeOptions(f.root, behavior); f.native = native;
  return f.arm.run(f.store, await f.arm.prepare(f.store, profile), native.options);
}
async function seed(f, native = true) {
  await fs.writeFile(join(f.root, 'payload.txt'), 'original'); await f.store.startSession(session());
  const a = artifact(); a.sha256 = sha256('original');
  if (!native) { delete a.producer_phase; delete a.native_runtime_session_id; }
  await f.store.publishArtifact(a); return a;
}
async function corrupt(f, kind, edit) {
  if (f.name === 'control') {
    const path = join(f.root, '.control/state.json'); const state = JSON.parse(await fs.readFile(path));
    const values = kind === 'session' ? state.sessions : kind === 'artifact' ? state.artifacts : kind === 'consumption' ? state.consumptions : state.events;
    edit(values); await fs.writeFile(path, JSON.stringify(state));
  } else {
    const path = join(f.root, '.agent-loom', kind === 'session' ? 'sessions/producer/session.json' : kind === 'artifact' ? 'artifacts.jsonl'
      : kind === 'consumption' ? 'consumptions.jsonl' : 'sessions/producer/events.jsonl');
    const values = kind === 'session' ? [JSON.parse(await fs.readFile(path))] : (await fs.readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    edit(values); await fs.writeFile(path, kind === 'session' ? JSON.stringify(values[0]) : values.map(v => JSON.stringify(v) + '\n').join(''));
  }
}
check('G1', 'foreign-task-no-schedule', async f => {
  const otherRoot = join(f.root, 'other'); await fs.mkdir(otherRoot);
  const other = await f.arm.create(otherRoot, task('task-two')); await other.startSession(session('task-two'));
  await other.publishArtifact(artifact('task-two'));
  await assert.rejects(f.arm.prepare(f.store, 'consumer'), { code: 'PreconditionNotSatisfied' });
  assert.equal((await f.store.listSessions()).length, 0);
});
for (const kind of ['session', 'artifact', 'event', 'consumption']) check('G1', `persisted-${kind}`, async f => {
  const a = await seed(f);
  if (kind === 'consumption') await f.store.recordConsumption({ id: 'consumed', task_id: 'task-one', session_id: 'producer', consumer_plugin_id: 'domain', artifact_id: a.id, sha256: a.sha256, consumed_at: stamp });
  await corrupt(f, kind, rows => { rows[0].task_id = 'task-two'; }); await assert.rejects(f.arm.inspect(f.store));
});
check('G2', 'snapshot-and-plan', async f => {
  const saved = f.store.task;
  f.definition.application.profiles[0].aspects = []; f.definition.application.runtime.version = 'changed';
  f.definition.application.profiles[1].requirements = [];
  assert.deepEqual((await f.arm.open(f.root)).task, saved);
  const plan = await f.arm.prepare(f.store, 'producer'); plan.aspect_plugin_ids = [];
  const native = await fakeOptions(f.root); await assert.rejects(f.arm.run(f.store, plan, native.options));
  assert.equal(native.trace.length, 0);
});
for (const invalid of ['producer', 'type', 'version', 'verification']) check('G3', invalid, async f => {
  await f.store.startSession(session()); const a = artifact();
  if (invalid === 'producer') a.producer.plugin_id = 'foreign'; else if (invalid === 'verification') a.verification.status = '';
  else a[invalid] = 'undeclared';
  await assert.rejects(f.store.publishArtifact(a)); assert.equal((await f.store.listArtifacts()).length, 0);
});
for (const pathKind of ['absolute', 'escape', 'link', 'missing', 'valid']) check('G4', pathKind, async f => {
  await fs.writeFile(join(f.root, 'payload.txt'), 'source');
  let path = pathKind === 'absolute' ? join(f.root, 'payload.txt') : pathKind === 'escape' ? '../outside.txt' : pathKind === 'missing' ? 'absent.txt' : 'payload.txt';
  if (pathKind === 'link') {
    const outside = await fs.mkdtemp(join(resolve(f.root, '..'), 'link-target-')); await fs.writeFile(join(outside, 'payload.txt'), 'foreign');
    await fs.symlink(outside, join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); path = 'linked/payload.txt';
  }
  const run = start(f, { run: async () => [publication(path)] });
  if (pathKind === 'valid') { await run; assert.equal((await f.store.listArtifacts()).length, 1); }
  else { await assert.rejects(run); assert.equal((await f.store.listArtifacts()).length, 0); }
});
check('G5', 'publication-bytes', async f => {
  await fs.writeFile(join(f.root, 'payload.txt'), 'original');
  await start(f, { run: async () => [{ ...publication(), sha256: 'f'.repeat(64) }] });
  assert.equal((await f.store.listArtifacts())[0].sha256, createHash('sha256').update('original').digest('hex'));
});
for (const tamper of [false, true]) check('G5', `consumer-bytes-${tamper}`, async f => {
  const a = await seed(f); if (tamper) await fs.writeFile(join(f.root, a.payload_ref.path), 'modified');
  // Shared domain initializer: this protection belongs to the domain boundary, not either governance owner.
  const run = start(f, { initialize: async (_c, inputs) => {
    const bytes = await fs.readFile(await containedFile(f.root, inputs[0].payload_ref.path));
    assert.equal(sha256(bytes), inputs[0].sha256, 'Accepted bytes differ from registry');
  } }, 'consumer');
  if (tamper) { await assert.rejects(run); assert.equal((await f.store.listConsumptions()).length, 0); assert(!f.native.trace.includes('domain')); }
  else { await run; assert.equal((await f.store.listConsumptions()).length, 1); }
});
for (const kind of ['missing-id', 'wrong-id', 'wrong-role', 'correct']) check('G6', kind, async f => {
  await f.store.startSession(session()); const a = artifact();
  if (kind === 'missing-id') delete a.native_runtime_session_id;
  if (kind === 'wrong-id') a.native_runtime_session_id = 'native-other';
  if (kind === 'wrong-role') a.producer_phase = 'aspect-after-run';
  if (kind === 'correct') { await f.store.publishArtifact(a); assert.equal((await f.store.listArtifacts())[0].native_runtime_session_id, 'native-producer'); }
  else await assert.rejects(f.store.publishArtifact(a));
});
check('G6', 'native-producer-fields', async f => {
  await fs.writeFile(join(f.root, 'payload.txt'), 'original');
  await start(f, { run: async () => [publication()], observer: async () => [{ ...publication(), type: 'review' }] });
  const [s] = await f.store.listSessions();
  for (const a of await f.store.listArtifacts()) {
    assert.equal(a.native_runtime_session_id, s.runtime_session_id);
    assert.equal(a.producer_phase, a.producer.plugin_id === 'domain' ? 'domain-run' : 'aspect-after-run');
    assert.equal(a.task_id, s.task_id); assert.equal(a.producer.session_id, s.id);
    assert.deepEqual(a.executor, { actor_id: s.actor.id, runtime_id: s.runtime.id });
  }
});
check('G7', 'resolve-await-accept-reject', async f => {
  await seed(f); await f.arm.prepare(f.store, 'consumer'); assert.equal((await f.store.listConsumptions()).length, 0);
  const entered = barrier(), release = barrier();
  const run = start(f, { initialize: async () => { entered.resolve(); await release.promise; throw new Error('Rejected'); } }, 'consumer');
  const rejection = assert.rejects(run); await entered.promise;
  try { assert.equal((await f.store.listConsumptions()).length, 0); }
  finally { release.resolve(); await rejection; }
  assert.equal((await f.store.listConsumptions()).length, 0);
});
check('G5', 'shared-real-pipeline-initializer', async f => {
  const { pipelineAdapters } = await import('../cross-application/pipeline-adapters.mjs');
  const original = 'INPUT_CANARY_original\n## Status\nPending review.\n';
  await fs.writeFile(join(f.root, 'payload.txt'), original);
  const input = { ...artifact(), type: 'source.snapshot', sha256: sha256(original) };
  await fs.writeFile(join(f.root, 'payload.txt'), original.replace('Pending review.', 'Modified content.'));
  const context = { workspace: join(f.root, 'consumer'), task_root: f.root, session_id: 'consumer' };
  await assert.rejects(pipelineAdapters({}).normalize.initialize(context, [input]));
  await assert.rejects(fs.readFile(join(context.workspace, 'normalized.md')));
});
check('G7', 'accepted-domain-failed', async f => {
  await seed(f); await assert.rejects(start(f, { domainFailure: true }, 'consumer')); assert.equal((await f.store.listConsumptions()).length, 1);
});
check('G8', 'ambiguity', async f => { await seed(f); await f.store.publishArtifact(artifact('task-one', 'second'));
  await assert.rejects(f.arm.prepare(f.store, 'consumer'), { code: 'BindingConflict' }); assert.equal((await f.store.listSessions()).length, 1); });
check('G9', 'missing', async f => { await assert.rejects(f.arm.prepare(f.store, 'consumer'), { code: 'PreconditionNotSatisfied' }); assert.equal((await f.store.listSessions()).length, 0); });
for (const kind of ['session_start', 'tool_execution_end', 'after-run', 'publication-validation']) check('G10', kind, async f => {
  await fs.writeFile(join(f.root, 'payload.txt'), 'original');
  await start(f, kind === 'after-run' ? { observerFailure: true } : kind === 'publication-validation'
    ? { observer: async () => [publication()] } : { hook: kind });
  const view = await f.arm.inspect(await f.arm.open(f.root));
  const e = view.sessions[0].events.find(e => e.type === 'observer.failed'); assert(e);
  assert.equal(e.payload.plugin_id, 'observer'); assert.equal(e.payload.failure.source, 'observer');
  assert.equal(e.payload.phase, kind === 'publication-validation' ? 'after-run' : kind);
  assert.equal(e.payload.failure_class, kind === 'after-run' ? 'aspect-execution' : kind === 'publication-validation' ? kind : 'native-hook');
  assert.equal(e.payload.failure.code, 'NativeAspectFailed'); assert(Number.isFinite(Date.parse(e.timestamp)));
});
for (const double of [false, true]) check('G11', `independence-${double}`, async f => {
  await start(f, { observerFailure: true, auditFailure: double }); const view = await f.arm.inspect(f.store);
  assert.equal(view.sessions[0].status, 'completed'); assert.equal(view.sessions[0].events.filter(e => e.type === 'observer.failed').length, double ? 2 : 1);
  assert(f.native.trace.includes('audit:completed'));
});
check('G12', 'preserved', async f => { await assert.rejects(start(f, { domainFailure: true }));
  assert.equal((await f.store.listSessions())[0].status, 'failed'); assert(f.native.trace.includes('audit:failed')); });
for (const target of ['start', 'consumption', 'artifact', 'observer', 'terminal']) check('G13', target, async f => {
  if (target === 'consumption') await seed(f);
  await fs.writeFile(join(f.root, 'payload.txt'), 'original'); let injected = 0;
  const restore = interceptIO((name, args) => { if (writeKind(name, args) === target) { injected++; throw Object.assign(new Error('Synthetic I/O failure'), { code: 'EIO' }); } });
  try { await assert.rejects(start(f, { observerFailure: target === 'observer', run: async () => target === 'artifact' ? [publication()] : [] }, target === 'consumption' ? 'consumer' : 'producer')); }
  finally { restore(); }
  assert(injected > 0);
  try { const view = await f.arm.inspect(await f.arm.open(f.root)); assert(view.sessions.every(s => s.status !== 'completed')); }
  catch (e) { if (e.code === 'ERR_ASSERTION') throw e; /* explicit unreadable state is not a successful inspection */ }
});
check('G13', 'real-invalid-file-target', async f => {
  await f.store.startSession(session());
  if (f.name === 'loom') { const path = join(f.root, '.agent-loom/artifacts.jsonl'); await fs.rename(path, path + '.saved'); await fs.mkdir(path); }
  else { await fs.rename(f.store.file, f.store.file + '.saved'); await fs.mkdir(f.store.file); }
  await assert.rejects(f.store.publishArtifact(artifact()));
});
check('G13', 'aspect-artifact-diagnostic-survives', async f => {
  await fs.writeFile(join(f.root, 'payload.txt'), 'original');
  const restore = interceptIO((name, args) => { if (writeKind(name, args) === 'artifact') throw new Error('Synthetic storage unavailable'); });
  try { await assert.rejects(start(f, { observer: async () => [{ ...publication(), type: 'review' }] })); } finally { restore(); }
  const view = await f.arm.inspect(f.store); assert.equal(view.sessions[0].status, 'failed');
  assert(view.sessions[0].events.some(e => e.type === 'observer.failed' && e.payload.failure_class === 'governance-storage'));
});
check('G14', 'legacy-observer-read-only', async f => {
  await f.store.startSession(session());
  const legacy = JSON.parse(await fs.readFile(new URL('./fixtures/legacy/observer-v1.json', import.meta.url)));
  await corrupt(f, 'event', rows => rows.push(legacy));
  const before = await fileHashes(f.root), view = await f.arm.inspect(await f.arm.open(f.root));
  const e = view.sessions[0].events.find(e => e.type === 'observer.failed');
  assert.equal(e.payload.phase, undefined); assert.equal(e.payload.failure_class, undefined); assert.deepEqual(await fileHashes(f.root), before);
});
check('G15', 'legacy-artifact-read-only', async f => {
  await f.store.startSession(session());
  const legacy = JSON.parse(await fs.readFile(new URL('./fixtures/legacy/artifact-v1.json', import.meta.url)));
  await corrupt(f, 'artifact', rows => rows.push(legacy));
  await f.store.publishArtifact({ ...artifact('task-one', 'new-artifact') });
  const before = await fileHashes(f.root), view = await f.arm.inspect(await f.arm.open(f.root));
  const a = view.artifacts.find(a => a.id === legacy.id); assert.equal(a.producer_phase, undefined); assert.equal(a.native_runtime_session_id, undefined);
  assert.deepEqual(await fileHashes(f.root), before);
});
for (const target of ['event', 'terminal']) for (const rejected of [false, true]) check('G16', `${target}-${rejected}`, async f => {
  const entered = barrier(), release = barrier(); let hit = false;
  const restore = interceptIO(async (name, args) => {
    if (!hit && writeKind(name, args) === target) { hit = true; entered.resolve(); await release.promise; if (rejected) throw new Error('Delayed storage failure'); }
  });
  let result; const run = start(f).then(value => { result = { value }; }, error => { result = { error }; });
  try {
    await Promise.race([entered.promise, run.then(() => { throw new Error('Execution ended before the write barrier'); })]); assert.equal(result, undefined);
    assert((await f.store.listSessions()).every(s => s.status === 'running'));
  } finally { release.resolve(); await run; restore(); }
  if (rejected) assert(result.error); else assert.equal(result.value.status, 'completed');
});
check('G17', 'external-context-oracle', async f => {
  await start(f, { hook: 'session_start', observerFailure: true });
  await f.native.native.prompt('Continue.');
  assert(f.native.requests.length >= 2); assert(!JSON.stringify(f.native.requests).includes('PRIVATE_'));
  assert.equal(f.native.native.systemPrompt, 'Synthetic policy'); assert.deepEqual(f.native.native.messages, []);
});
check('G18', 'separate-process-inspect', async f => {
  await fs.writeFile(join(f.root, 'payload.txt'), 'original');
  await start(f, { run: async () => [publication()], observerFailure: true });
  await start(f, {}, 'consumer');
  const child = spawnSync(process.execPath, [new URL('./inspect.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'), f.name, f.root], { cwd: f.root, encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0, child.stderr); const view = JSON.parse(child.stdout);
  assert.equal(view.sessions.length, 2); assert(view.sessions.every(s => s.status === 'completed' && s.aspect_plugin_ids.length === 2));
  assert.equal(view.artifacts.length, 1); assert.equal(view.artifacts[0].producer_phase, 'domain-run'); assert(view.artifacts[0].native_runtime_session_id);
  assert.equal(view.sessions.flatMap(s => s.consumed).length, 1);
  assert(view.sessions.some(s => s.events.some(e => e.type === 'observer.failed' && e.payload.phase === 'after-run')));
});
export async function fileHashes(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }), result = {};
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) for (const [path, hash] of Object.entries(await fileHashes(join(root, e.name)))) result[`${e.name}/${path}`] = hash;
    else result[e.name] = sha256(await fs.readFile(join(root, e.name)));
  }
  return result;
}
export async function runGuarantees(output, selectedArms = ['loom', 'control'], filter = '', includeNativeBoundary = true) {
  const results = [];
  for (const name of selectedArms) for (const test of cases.filter(c => (!filter || c.id.startsWith(filter))
    && (includeNativeBoundary || c.id !== 'G5:shared-real-pipeline-initializer'))) {
    const root = resolve(output, `${name}-${test.id.replaceAll(':', '-')}`); await fs.mkdir(root, { recursive: true });
    const definition = task();
    if (test.guarantee === 'G17') definition.title = 'PRIVATE_METADATA_CANARY';
    const arm = arms[name], store = await arm.create(root, definition);
    const started = performance.now(); let error;
    try { await test.action({ root, name, definition, arm, store }); } catch (e) { error = { code: e.code, message: e.message, stack: e.stack }; }
    const row = { arm: name, id: test.id, guarantee: test.guarantee, passed: !error, duration_ms: performance.now() - started,
      elapsed_ms: performance.now(), ...(error ? { error } : {}) };
    results.push(row); console.log(`${row.passed ? 'PASS' : 'FAIL'} ${name} ${row.id}`);
    await fs.writeFile(join(output, 'guarantees.local.json'), JSON.stringify(results, null, 2));
  }
  return results;
}
