import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { executeSession, inspectTask, LocalTaskStore, prepareSession, readNativeProvenance } from '../../packages/container-core/src/index.ts';
import type { ApplicationDefinition, SessionPlan } from '../../packages/container-core/src/index.ts';
import { createPiHostModule, readArtifactFile } from '../../packages/runtime-pi/src/index.ts';
import type { PiAdapterRegistration, PiApplicationContext, PiSdk } from '../../packages/runtime-pi/src/index.ts';
import { summarizeTask } from '../../packages/cli/src/experience.ts';

async function setup(t: TestContext, domain: 'measurement' | 'catalog' = 'measurement') {
  const root = await mkdtemp(join(tmpdir(), 'loom-experience-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entries = Object.fromEntries(['producer', 'consumer', 'observer'].map(id => [id, join(root, `${id}.mjs`)]));
  for (const entry of Object.values(entries)) await writeFile(entry, 'export default () => {};');
  const application: ApplicationDefinition = { id: domain, version: '1', runtime: { id: 'pi', version: 'synthetic' },
    plugins: ['producer', 'consumer', 'observer'].map(id => ({ id, role: id === 'observer' ? 'aspect' : 'domain',
      native: { runtime: 'pi', binding_key: id }, capabilities: [],
      produces: id === 'producer' ? [{ type: `${domain}.input`, version: '1' }] : [] })),
    profiles: [{ id: 'produce', primary: 'producer', aspects: [], requirements: [] },
      { id: 'consume', primary: 'consumer', aspects: ['observer'], requirements: [
        { type: `${domain}.input`, version: '1', verification_status: 'READY' }] },
      { id: 'reuse', primary: 'consumer', aspects: [], requirements: [
        { type: `${domain}.input`, version: '1', verification_status: 'READY' }] }],
  };
  const store = await LocalTaskStore.create(join(root, 'task'), { schema_version: 2, id: 'sample-task',
    application_id: application.id, application, title: 'Synthetic adapter integration', created_at: new Date().toISOString() });
  const calls = { allocated: 0, configured: 0, initialized: 0, executed: 0, verified: 0, created: 0 };
  const settings: Record<string, unknown>[] = [];
  let extraExtension = false;
  const sdk: PiSdk = {
    SettingsManager: { inMemory(value) { settings.push(value); return value; } },
    SessionManager: { create() { calls.allocated++; return { getSessionId: () => randomUUID() }; } },
    DefaultResourceLoader: class {
      options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) { this.options = options; }
      async reload() { assert.equal(this.options.noExtensions, true); assert.equal(this.options.noSkills, true); }
      getExtensions() { return { errors: [], extensions: [
        ...(this.options.additionalExtensionPaths as string[]).map(resolvedPath => ({ resolvedPath })),
        ...(extraExtension ? [{ resolvedPath: join(root, 'unexpected.mjs') }] : [])] }; }
    },
    async createAgentSession() { return { session: {
      async prompt() { throw new Error('Synthetic fixture never calls a model'); }, async abort() {}, async bindExtensions() {},
      extensionRunner: { async emit() {} }, dispose() {},
    } }; },
  };
  let rejectDomain = false, failAspect = false;
  const adapters: Record<string, PiAdapterRegistration> = {
    producer: { entry: entries.producer!, create() { calls.created++; return {
      async initialize() {}, async run(_session, context) {
        const value = domain === 'measurement' ? { samples: [2, 3], unit: 'm' } : { entries: [{ key: 'item-one' }] };
        const path = `input-${context.session_id}.json`;
        await writeFile(join(context.task_root, path), JSON.stringify(value));
        return [{ type: `${domain}.input`, version: '1', verification_status: 'READY', path }];
      },
    }; } },
    consumer: { entry: entries.consumer!, create() { calls.created++; return {
      async initialize(context, artifacts) {
        const value = await readArtifactFile(context, artifacts[0]!, application.profiles[1]!.requirements[0]!, bytes => {
          calls.verified++;
          const value = JSON.parse(new TextDecoder().decode(bytes));
          if (domain === 'measurement') { assert(value.samples.every(Number.isFinite)); assert.equal(value.unit, 'm'); }
          else { assert.equal(typeof value.entries[0].key, 'string'); assert.equal(value.samples, undefined); }
          if (rejectDomain) throw new Error('Domain policy rejects structurally valid input');
          return value;
        });
        assert(value); calls.initialized++;
      },
      async run() { assert.equal((await store.listConsumptions()).length, calls.initialized); calls.executed++; return []; },
    }; } },
    observer: { entry: entries.observer!, create: () => ({ async afterRun() {
      if (failAspect) throw new Error('Synthetic aspect failure'); return [];
    } }) },
  };
  const options = { sdk, sdkVersion: 'synthetic', preflightDirectory: join(root, 'preflight'), adapters,
    configure() { calls.configured++; return { settings: { packages: ['unselected'] }, modelRuntime: {} }; } };
  const module = createPiHostModule(options);
  const run = async (profile: string) => {
    const plan = await prepareSession(store, profile);
    return executeSession(store, plan, await module.createSessionHost({ store }), { id: 'operator' });
  };
  return { root, store, application, options, module, run, calls, settings,
    rejectDomain: () => { rejectDomain = true; }, failAspect: () => { failAspect = true; }, extra: () => { extraExtension = true; } };
}

for (const domain of ['measurement', 'catalog'] as const) test(`shared Host and input helper preserve lineage for ${domain}`, async t => {
  const f = await setup(t, domain);
  await f.module.validateNativeApplication({ application: f.application });
  assert.equal(f.calls.configured, 0); assert.equal(f.calls.created, 0); assert.equal(f.calls.allocated, 0);
  await assert.rejects(f.run('consume'), { code: 'PreconditionNotSatisfied' });
  assert.equal(f.calls.configured, 0);
  const producer = await f.run('produce');
  const consumer = await f.run('consume');
  const reused = await f.run('reuse');
  const snapshot = await inspectTask(f.store);
  assert.equal(snapshot.artifacts.length, 1);
  assert.equal(snapshot.artifacts[0]!.producer.session_id, producer.id);
  assert.equal(readNativeProvenance(snapshot.artifacts[0]!)?.native_runtime_session_id, producer.runtime_session_id);
  assert.deepEqual(snapshot.artifacts[0]!.consumers.map(record => record.session_id), [consumer.id, reused.id]);
  assert.equal(f.calls.verified, 2); assert.equal(f.calls.executed, 2);
  assert(f.settings.every(settings => !Object.hasOwn(settings, 'packages')));
  const before = await readFile(join(f.store.taskRoot, '.agent-loom', 'artifacts.jsonl'));
  const summary = summarizeTask(snapshot);
  assert.deepEqual(summary.counts, { sessions: 3, artifacts: 1, consumptions: 2, aspect_failures: 0 });
  assert.equal(summary.business_acceptance, 'not-evaluated');
  assert.equal(summary.sessions.find(s => s.id === consumer.id)!.consumed[0]!.producer.session_id, producer.id);
  assert.deepEqual(await readFile(join(f.store.taskRoot, '.agent-loom', 'artifacts.jsonl')), before);
});

test('input helper rejects changed bytes and domain policy before consumption or execution', async t => {
  for (const kind of ['bytes', 'policy']) {
    const f = await setup(t); await f.run('produce');
    if (kind === 'policy') f.rejectDomain();
    else {
      const artifact = (await f.store.listArtifacts())[0]!;
      assert.equal(artifact.payload_ref.kind, 'file');
      if (artifact.payload_ref.kind === 'file') await writeFile(join(f.store.taskRoot, artifact.payload_ref.path), '{}');
    }
    await assert.rejects(f.run('consume'), { code: 'NativeExecutionFailed' });
    assert.equal((await f.store.listConsumptions()).length, 0); assert.equal(f.calls.executed, 0);
    assert.equal(f.calls.verified, kind === 'policy' ? 1 : 0);
    assert.equal((await f.store.listSessions()).find(s => s.profile_id === 'consume')!.status, 'failed');
  }
});

test('input helper rejects forged identity, contract and symlink escape without calling verifier', async t => {
  const f = await setup(t); await f.run('produce');
  const plan = await prepareSession(f.store, 'consume');
  const context: PiApplicationContext = { plan, task_id: plan.task_id, task_root: f.store.taskRoot,
    session_id: 'hypothetical', workspace: f.store.taskRoot };
  const artifact = plan.artifacts[0]!;
  let verified = 0;
  const verify = () => { verified++; };
  const requirement = f.application.profiles[1]!.requirements[0]!;
  await assert.rejects(readArtifactFile(context, { ...artifact, sha256: 'a'.repeat(64) }, requirement, verify), { code: 'InvalidRecord' });
  await assert.rejects(readArtifactFile(context, artifact, { ...requirement, version: 'other' }, verify), { code: 'InvalidRecord' });
  await assert.rejects(readArtifactFile(context, artifact, { ...requirement, producer_plugin_id: 'other' }, verify), { code: 'InvalidRecord' });
  await assert.rejects(readArtifactFile({ ...context, task_id: 'other-task' }, artifact, requirement, verify), { code: 'InvalidRecord' });
  const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'payload.json'), '{}');
  await symlink(outside, join(f.store.taskRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const escaped = { ...artifact, payload_ref: { kind: 'file' as const, path: 'escape/payload.json' } };
  const escapedPlan: SessionPlan = { ...plan, artifacts: [escaped] };
  await assert.rejects(readArtifactFile({ ...context, plan: escapedPlan }, escaped, requirement, verify), { code: 'InvalidRecord' });
  assert.equal(verified, 0); assert.equal((await f.store.listConsumptions()).length, 0);
});

test('new Host preserves aspect attribution and never presents completion as acceptance', async t => {
  const f = await setup(t); await f.run('produce'); f.failAspect();
  const session = await f.run('consume'); assert.equal(session.status, 'completed');
  const summary = summarizeTask(await inspectTask(f.store));
  assert.equal(summary.counts.aspect_failures, 1);
  const inspected = summary.sessions.find(s => s.id === session.id)!;
  assert.equal(inspected.aspect_failures[0]!.plugin_id, 'observer');
  assert(inspected.aspect_failures[0]!.context.some(fact => fact.name === 'failure_class' && fact.value === 'aspect-execution'));
  assert.equal(summary.business_acceptance, 'not-evaluated');
});

test('preflight rejects version mismatch and unexpected extensions without allocating Sessions', async t => {
  const f = await setup(t);
  const wrong = structuredClone(f.application); wrong.runtime.version = 'other';
  await assert.rejects(f.module.validateNativeApplication({ application: wrong }), { code: 'NativeIntegrationNotReady' });
  f.extra();
  await assert.rejects(f.module.validateNativeApplication({ application: f.application }), { code: 'NativeIntegrationNotReady' });
  assert.equal(f.calls.allocated, 0); assert.equal(f.calls.configured, 0); assert.equal(f.calls.created, 0);
  assert.equal((await f.store.listSessions()).length, 0);
});
