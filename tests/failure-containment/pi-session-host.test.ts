import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { executeSession, LocalTaskStore, prepareSession } from '../../packages/container-core/src/index.ts';
import { createPiSessionHost } from '../../packages/runtime-pi/src/index.ts';
import type { PiSdk, PiSessionHostOptions } from '../../packages/runtime-pi/src/index.ts';
import { artifact, session, testApplication, timestamp } from '../helpers.ts';

async function setup(t: TestContext, fault?: 'primary' | 'aspect' | 'shutdown' | 'load' | 'extra') {
  const root = await mkdtemp(join(tmpdir(), 'loom-pi-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const application = structuredClone(testApplication);
  application.runtime = { id: 'pi', version: 'test' };
  for (const plugin of application.plugins) plugin.native.runtime = 'pi';
  const store = await LocalTaskStore.create(root, { schema_version: 2, id: 'task-one',
    application_id: application.id, application, title: 'Synthetic bridge test', created_at: timestamp });
  const entry = join(root, 'domain.mjs');
  const aspect = join(root, 'aspect.mjs');
  await writeFile(entry, 'export default () => {};');
  await writeFile(aspect, 'export default () => {};');
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
    bindings: { 'test-domain': { entry }, 'test-observer': { entry: aspect } },
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
