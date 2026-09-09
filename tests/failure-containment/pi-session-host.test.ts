import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { executeSession, LocalTaskStore, prepareSession } from '../../packages/container-core/src/index.ts';
import { createPiApplicationHost, createPiSessionHost } from '../../packages/runtime-pi/src/index.ts';
import type { PiSdk, PiSessionHostOptions } from '../../packages/runtime-pi/src/index.ts';
import { artifact, session, testApplication, timestamp } from '../helpers.ts';
import { createHash } from 'node:crypto';

async function setup(t: TestContext, fault?: 'primary' | 'aspect' | 'shutdown' | 'load' | 'extra', twoAspects = false) {
  const root = await mkdtemp(join(tmpdir(), 'loom-pi-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const application = structuredClone(testApplication);
  application.runtime = { id: 'pi', version: 'test' };
  for (const plugin of application.plugins) plugin.native.runtime = 'pi';
  if (twoAspects) {
    application.plugins = [...application.plugins, { ...structuredClone(application.plugins[1]!), id: 'second-observer',
      native: { runtime: 'pi', binding_key: 'second-observer' } }];
    const profile = application.profiles.find(p => p.id === 'test-observing')!;
    profile.aspects = [...profile.aspects, 'second-observer'];
  }
  const store = await LocalTaskStore.create(root, { schema_version: 2, id: 'task-one',
    application_id: application.id, application, title: 'Synthetic bridge test', created_at: timestamp });
  const entry = join(root, 'domain.mjs');
  const aspect = join(root, 'aspect.mjs');
  await writeFile(entry, 'export default () => {};');
  await writeFile(aspect, 'export default () => {};');
  const secondAspect = join(root, 'second-aspect.mjs');
  if (twoAspects) await writeFile(secondAspect, 'export default () => {};');
  const order: string[] = [];
  let loaderOptions: Record<string, unknown> = {};
  let loadedSettings: Record<string, unknown> = {};
  const sdk: PiSdk = {
    SettingsManager: { inMemory(settings) { loadedSettings = settings; return {}; } },
    SessionManager: { create(_cwd, sessionDir) {
      // Pi creates this directory eagerly, before Core persists its Session record.
      mkdirSync(sessionDir, { recursive: true });
      order.push('allocate'); return { getSessionId: () => 'native-session' };
    } },
    DefaultResourceLoader: class {
      constructor(options: Record<string, unknown>) { loaderOptions = options; }
      async reload() { order.push('load'); }
      getExtensions() { return { errors: fault === 'load' ? ['private diagnostic'] : [],
        extensions: [...(loaderOptions.additionalExtensionPaths as string[]).map(resolvedPath => ({ resolvedPath })),
          ...(fault === 'extra' ? [{ resolvedPath: join(root, 'unselected.mjs') }] : [])] }; }
    },
    async createAgentSession() {
      order.push('create');
      return { session: {
        async prompt() {}, async abort() {},
        async bindExtensions(options) {
          order.push('bind');
          if (fault === 'primary' || fault === 'aspect') options.onError({
            extensionPath: fault === 'primary' ? entry : aspect, error: 'private diagnostic', event: 'session_start',
          });
        },
        extensionRunner: { async emit() { order.push('shutdown'); if (fault === 'shutdown') throw new Error('private diagnostic'); } },
        dispose() { order.push('dispose'); },
      } };
    },
  };
  const options: PiSessionHostOptions = {
    sdk, sdkVersion: 'test', expectedVersion: 'test', agentDir: root,
    settings: { packages: ['unselected-package'], extensions: ['unselected-extension'], defaultModel: 'test-model' }, modelRuntime: {},
    bindings: { 'test-domain': { entry }, 'test-observer': { entry: aspect },
      ...(twoAspects ? { 'second-observer': { entry: secondAspect } } : {}) },
    async initialize(context) {
      assert.equal((await store.getSession(context.session_id)).status, 'running');
      order.push('initialize');
    },
    async run(_session, context) {
      assert.equal((await store.getSession(context.session_id)).runtime_session_id, 'native-session');
      order.push('run'); return { status: 'completed' };
    },
    async observe(event) { order.push(`observe:${event}`); },
  };
  const run = async (profile = 'test-observing') => executeSession(store, await prepareSession(store, profile), createPiSessionHost(options), { id: 'actor' });
  return { root, store, options, order, run, loaderOptions: () => loaderOptions, loadedSettings: () => loadedSettings };
}

test('Pi host binds a native ID, initializes before discovery and flushes shutdown before settlement', async t => {
  const f = await setup(t);
  assert.equal((await f.run()).status, 'completed');
  assert.deepEqual(f.order, ['allocate', 'initialize', 'load', 'create', 'bind', 'observe:started', 'run', 'shutdown', 'observe:shutdown', 'dispose']);
  assert.equal(f.loaderOptions().noExtensions, true);
  assert.deepEqual(f.loaderOptions().additionalExtensionPaths, await Promise.all([
    realpath(f.options.bindings['test-domain']!.entry), realpath(f.options.bindings['test-observer']!.entry),
  ]));
  assert.deepEqual(f.loadedSettings(), { defaultModel: 'test-model' });
});

test('Application host derives publication provenance and lifecycle from the active Session', async t => {
  const f = await setup(t);
  const bytes = 'Native adapter output';
  const host = createPiApplicationHost({ ...f.options, store: f.store, adapters: {
    'test-domain': { entry: f.options.bindings['test-domain']!.entry,
      async initialize(context) { assert.equal(context.task_id, f.store.task.id); },
      async run(_native, context) {
        await writeFile(join(context.task_root, 'native-output.txt'), bytes);
        return [{ type: 'SyntheticHandoff', version: '3', path: 'native-output.txt', verification_status: 'READY' }];
      } },
    'test-observer': f.options.bindings['test-observer']!,
  } });
  const result = await executeSession(f.store, await prepareSession(f.store, 'test-observing'), host, { id: 'actual-operator' });
  const [published] = await f.store.listArtifacts();
  assert.equal(published!.producer.session_id, result.id);
  assert.equal(published!.producer.plugin_id, 'test-domain');
  assert.equal(published!.producer_phase, 'domain-run');
  assert.equal(published!.native_runtime_session_id, result.runtime_session_id);
  assert.deepEqual(published!.executor, { actor_id: 'actual-operator', runtime_id: 'pi' });
  assert.equal(published!.sha256, createHash('sha256').update(bytes).digest('hex'));
  const events = await f.store.listEvents(result.id);
  assert(events.some(event => event.type === 'runtime.pi.started' && event.actor_id === 'actual-operator'));
  assert(events.some(event => event.type === 'runtime.pi.shutdown'));
});

test('Application host rejects an invalid publication without indexing success', async t => {
  const f = await setup(t);
  const host = createPiApplicationHost({ ...f.options, store: f.store, adapters: {
    'test-domain': { entry: f.options.bindings['test-domain']!.entry,
      async initialize() {}, async run() {
        return [{ type: 'SyntheticHandoff', version: '3', path: '../outside.txt', verification_status: 'READY' }];
      } },
    'test-observer': f.options.bindings['test-observer']!,
  } });
  await assert.rejects(executeSession(f.store, await prepareSession(f.store, 'test-profile'), host, { id: 'actor' }),
    { code: 'NativeExecutionFailed' });
  assert.equal((await f.store.listArtifacts()).length, 0);
  assert.equal((await f.store.listSessions())[0]!.status, 'failed');
});

test('Application host contains two independent aspect failures and attributes surviving native output', async t => {
  const f = await setup(t, 'aspect', true);
  const host = createPiApplicationHost({ ...f.options, store: f.store, adapters: {
    'test-domain': { ...f.options.bindings['test-domain']!, async initialize() {}, async run() { return []; } },
    'test-observer': { ...f.options.bindings['test-observer']!, async afterRun(_session, context) {
      await writeFile(join(context.task_root, 'review.md'), 'Native review');
      return [{ type: 'SyntheticCheckpoint', version: '1', path: 'review.md', verification_status: 'COMPLETED' }];
    } },
    'second-observer': { ...f.options.bindings['second-observer']!, async afterRun() { throw new Error('private diagnostic'); } },
  } });
  const result = await executeSession(f.store, await prepareSession(f.store, 'test-observing'), host, { id: 'operator' });
  assert.equal(result.status, 'completed');
  const [artifact] = await f.store.listArtifacts();
  assert.equal(artifact!.producer.plugin_id, 'test-observer');
  assert.equal(artifact!.producer_phase, 'aspect-after-run');
  assert.equal(artifact!.native_runtime_session_id, result.runtime_session_id);
  assert.equal(artifact!.producer.session_id, result.id);
  const events = await f.store.listEvents(result.id);
  const failures = events.filter(e => e.type === 'observer.failed');
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map(e => (e.payload as { failure_class: string }).failure_class), ['native-hook', 'aspect-execution']);
  assert.deepEqual(failures.map(e => (e.payload as { phase: string }).phase), ['session_start', 'after-run']);
  assert.deepEqual(failures.map(e => (e.payload as { plugin_id: string }).plugin_id), ['test-observer', 'second-observer']);
  assert(JSON.stringify(failures).includes('session_start'));
  assert(JSON.stringify(failures).includes('after-run'));
  assert(!JSON.stringify(events).includes('private diagnostic'));
  assert.equal(events.at(-1)!.type, 'session.completed');
});

test('Invalid aspect output is not indexed and does not prevent the next aspect from running', async t => {
  const f = await setup(t, undefined, true);
  let secondRan = false;
  const host = createPiApplicationHost({ ...f.options, store: f.store, adapters: {
    'test-domain': { ...f.options.bindings['test-domain']!, async initialize() {}, async run() { return []; } },
    'test-observer': { ...f.options.bindings['test-observer']!, async afterRun() {
      return [{ type: 'SyntheticCheckpoint', version: '1', path: '../escape.md', verification_status: 'COMPLETED' }];
    } },
    'second-observer': { ...f.options.bindings['second-observer']!, async afterRun() { secondRan = true; return []; } },
  } });
  const result = await executeSession(f.store, await prepareSession(f.store, 'test-observing'), host, { id: 'operator' });
  assert.equal(result.status, 'completed');
  assert(secondRan);
  assert.deepEqual(await f.store.listArtifacts(), []);
  const failures = (await f.store.listEvents(result.id)).filter(e => e.type === 'observer.failed');
  assert.equal(failures.length, 1);
  assert.equal((failures[0]!.payload as { failure_class: string }).failure_class, 'publication-validation');
});

test('Aspect publication storage rejection stays fatal and records its class when diagnostic storage survives', async t => {
  const f = await setup(t);
  f.store.publishArtifact = async () => { throw new Error('Storage write rejected'); };
  const host = createPiApplicationHost({ ...f.options, store: f.store, adapters: {
    'test-domain': { ...f.options.bindings['test-domain']!, async initialize() {}, async run() { return []; } },
    'test-observer': { ...f.options.bindings['test-observer']!, async afterRun(_native, context) {
      await writeFile(join(context.task_root, 'review.txt'), 'Native review');
      return [{ type: 'SyntheticCheckpoint', version: '1', path: 'review.txt', verification_status: 'COMPLETED' }];
    } },
  } });
  await assert.rejects(executeSession(f.store, await prepareSession(f.store, 'test-observing'), host, { id: 'operator' }),
    { code: 'NativeExecutionFailed' });
  const [session] = await f.store.listSessions();
  assert.equal(session!.status, 'failed');
  assert.deepEqual(await f.store.listArtifacts(), []);
  const failures = (await f.store.listEvents(session!.id)).filter(e => e.type === 'observer.failed');
  assert.equal(failures.length, 1);
  assert.equal((failures[0]!.payload as { failure_class: string }).failure_class, 'governance-storage');
});

test('Required aspect governance persistence failure cannot be hidden by optional native observation', async t => {
  const f = await setup(t, 'aspect');
  f.store.recordObserverFailure = async () => { throw new Error('Storage unavailable'); };
  const host = createPiApplicationHost({ ...f.options, store: f.store, adapters: {
    'test-domain': { ...f.options.bindings['test-domain']!, async initialize() {}, async run() { return []; } },
    'test-observer': f.options.bindings['test-observer']!,
  } });
  await assert.rejects(executeSession(f.store, await prepareSession(f.store, 'test-observing'), host, { id: 'operator' }),
    { code: 'NativeExecutionFailed' });
  assert.equal((await f.store.listSessions())[0]!.status, 'failed');
});

test('Pi native initializer rejection cannot load extensions, run, or record consumption', async t => {
  const f = await setup(t);
  f.options.initialize = async () => { throw new Error('private diagnostic'); };
  await assert.rejects(f.run(), { code: 'NativeExecutionFailed', message: 'Native initialization or execution failed.' });
  assert.deepEqual(f.order, ['allocate']);
  assert.deepEqual(await f.store.listConsumptions(), []);
  assert.equal((await f.store.listSessions())[0]?.status, 'failed');
});

test('Pi consumer records the accepted digest only between native initialization and execution', async t => {
  const f = await setup(t);
  const producer = session();
  producer.runtime = { id: 'pi', name: 'pi', version: 'test' };
  await f.store.startSession(producer);
  const handoff = artifact();
  handoff.executor.runtime_id = 'pi';
  await f.store.publishArtifact(handoff);
  await f.store.settleSession(producer.id, 'completed', timestamp);
  f.options.initialize = async (_context, artifacts) => {
    assert.equal(artifacts[0]?.sha256, handoff.sha256);
    assert.deepEqual(await f.store.listConsumptions(), []);
  };
  f.options.run = async () => {
    const consumptions = await f.store.listConsumptions();
    assert.equal(consumptions.length, 1);
    assert.equal(consumptions[0]?.sha256, handoff.sha256);
    return { status: 'completed' };
  };
  assert.equal((await f.run('test-consumer')).status, 'completed');
});

test('Pi primary startup and load failures never enter execution', async t => {
  for (const fault of ['primary', 'load', 'extra'] as const) {
    const f = await setup(t, fault);
    await assert.rejects(f.run(), { code: 'NativeExecutionFailed' });
    assert(!f.order.includes('run'));
    assert.equal((await f.store.listSessions())[0]?.status, 'failed');
    if (fault === 'primary') assert.equal(f.order.filter(item => item === 'dispose').length, 1);
  }
});

test('Pi aspect event errors and failing observers are isolated from primary execution', async t => {
  const f = await setup(t, 'aspect');
  const events: string[] = [];
  f.options.observe = async event => { events.push(event); throw new Error('observer diagnostic'); };
  assert.equal((await f.run()).status, 'completed');
  assert.deepEqual(events, ['aspect-error', 'started', 'shutdown']);
  assert(f.order.includes('run'));
});

test('Pi shutdown failure disposes once and leaves a failed Session', async t => {
  const f = await setup(t, 'shutdown');
  await assert.rejects(f.run(), { code: 'NativeExecutionFailed' });
  assert.equal(f.order.filter(item => item === 'dispose').length, 1);
  assert.equal((await f.store.listSessions())[0]?.status, 'failed');
});

test('Pi version mismatch or missing explicit entry allocates no native Session', async t => {
  for (const fault of ['version', 'entry']) {
    const f = await setup(t);
    if (fault === 'version') f.options.sdkVersion = 'other';
    else f.options.bindings = {};
    await assert.rejects(f.run(), { code: fault === 'version' ? 'NativeIntegrationNotReady' : 'NativeExecutionFailed' });
    assert.deepEqual(f.order, []);
    assert.deepEqual(await f.store.listSessions(), []);
  }
});
