import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { LocalTaskStore, ContainerFailure, prepareSession, executeSession, registerSafeDiagnostics, safeNativeFailure } from '../../dist/packages/container-core/src/index.js';
import { connectLoom, discoverEntries, describeEntry } from '../../dist/packages/container-core/src/agent.js';
import { definePiApplicationModule, createPiApplicationHost, readArtifactFile } from '../../dist/packages/runtime-pi/src/index.js';

const domainFailure = registerSafeDiagnostics('domain', ['DOMAIN_POLICY_REJECTED']);
const aspectFailure = registerSafeDiagnostics('aspect', ['AUDIT_REJECTED']);
const contract = { type: 'sensor.sample', version: '1' };
const requirement = { ...contract, verification_status: 'READY' };
async function setup(t, hostOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'loom-agent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = { factories: [], initialized: 0, executed: 0, configured: 0, loaded: 0, prompts: [], mode: '', requests: [] };
  const entry = id => ({ id: `sensor.${id}`, purpose: `Synthetic ${id} operation`, tags: ['sensor'],
    implementation: 'synthetic', request_mapping: 'v1', effect_declarations: ['task-files-write'] });
  const profiles = [
    { id: 'produce', primary: 'producer', aspects: [], requirements: [], entry: entry('produce') },
    { id: 'consume', primary: 'consumer', aspects: ['audit'], requirements: [
      { ...requirement, input_name: 'left' }, { ...requirement, input_name: 'right' }], entry: entry('consume') },
    { id: 'idle', primary: 'idle', aspects: [], requirements: [], entry: entry('idle') },
  ];
  const sdk = {
    SettingsManager: { inMemory: value => value },
    SessionManager: { create: () => ({ getSessionId: () => randomUUID() }) },
    DefaultResourceLoader: class {
      constructor(options) { this.options = options; }
      async reload() { state.loaded++; }
      getExtensions() { return { errors: [], extensions: this.options.additionalExtensionPaths.map(resolvedPath => ({ resolvedPath })) }; }
    },
    async createAgentSession() { return { session: {
      async prompt(text) { state.prompts.push(text); }, async abort() {}, async bindExtensions() {},
      extensionRunner: { async emit() {} }, dispose() {},
    } }; },
  };
  const plugins = [];
  for (const id of ['producer', 'consumer', 'audit', 'idle']) {
    const file = join(root, `${id}.mjs`); await writeFile(file, 'export default () => {};');
    plugins.push({ descriptor: { id, role: id === 'audit' ? 'aspect' : 'domain',
      native: { runtime: 'pi', binding_key: id }, capabilities: [],
      produces: id === 'producer' ? [contract] : id === 'consumer' ? [{ type: 'sensor.report', version: '1' }] : [] },
      adapter: { entry: file, ...(id === 'audit' ? {} : { request_mapping: 'v1' }),
        create({ store, plan }) {
          state.factories.push(id);
          if (id === 'idle') throw new Error('Unselected factory must not run');
          if (id === 'audit') {
            assert.equal(plan.request, undefined);
            return { async afterRun(_native, context) {
              assert.equal(context.request, undefined); assert.equal(context.plan.request, undefined);
              if (state.mode === 'aspect' || state.mode === 'domain-and-aspect') throw aspectFailure('AUDIT_REJECTED');
              return [];
            } };
          }
          let accepted;
          return {
            async initialize(context) {
              state.requests.push(structuredClone(context.request));
              if (id === 'consumer') {
                accepted = [];
                for (const name of ['left', 'right']) accepted.push(await readArtifactFile(context,
                  context.plan.named_artifacts[name], requirement, bytes => JSON.parse(new TextDecoder().decode(bytes))));
                if (state.mode === 'domain' || state.mode === 'domain-and-aspect') throw domainFailure('DOMAIN_POLICY_REJECTED');
              }
              state.initialized++;
            },
            async run(native, context) {
              state.executed++;
              if (state.mode === 'domain-run') throw domainFailure('DOMAIN_POLICY_REJECTED');
              if (state.mode === 'native') throw new Error('synthetic-private-error-canary');
              if (context.request?.instruction) await native.prompt(context.request.instruction);
              const values = id === 'producer' ? [{ value: 2 }, { value: 3 }] : [{ values: accepted.map(v => v.value), data: context.request?.data ?? null }];
              const publications = [];
              for (const [i, value] of values.entries()) {
                const path = `${context.session_id}-${i}.json`;
                await writeFile(join(store.taskRoot, path), JSON.stringify(value));
                publications.push({ ...(id === 'producer' ? contract : { type: 'sensor.report', version: '1' }), path, verification_status: 'READY' });
              }
              return publications;
            },
          };
        },
      },
    });
  }
  const module = definePiApplicationModule({ id: 'sensor-app', version: '1', profiles, plugins, sdk, sdkVersion: 'synthetic',
    preflightDirectory: root, configure() { state.configured++; return { settings: {}, modelRuntime: undefined }; }, ...hostOptions });
  const store = await LocalTaskStore.create(join(root, 'task'), { schema_version: 2, id: 'sensor-task', application_id: module.application.id,
    application: module.application, title: 'Synthetic sensor Task', created_at: new Date().toISOString() });
  const host = { actor: { id: 'trusted-executor' },
    async createHost({ store: active }) {
      if (state.mode === 'storage') active.settleSession = async () => { throw new ContainerFailure('StorageFailure', 'synthetic storage failure'); };
      if (state.mode === 'unreadable') active.listSessions = async () => { throw new ContainerFailure('StorageFailure', 'synthetic storage failure'); };
      return module.createSessionHost({ store: active });
    } };
  const loom = await connectLoom({ taskRoot: store.taskRoot, taskId: store.task.id, host });
  const request = (id = 'produce', fields = {}) => ({ schema_version: 1, request_id: randomUUID(), task_id: store.task.id, entry_id: `sensor.${id}`, ...fields });
  const sources = async () => {
    const result = await loom.invoke(request()); assert.equal(result.execution.status, 'completed');
    return result.artifacts.map(a => a.id);
  };
  const consume = ids => request('consume', { inputs: { right: { artifact_id: ids[1] }, left: { artifact_id: ids[0] } },
    instruction: 'domain-instruction-canary', data: { label: 'domain-data-canary' } });
  return { root, store, state, module, loom, request, sources, consume, host, sdk };
}

test('data discovery filters a single Profile source without loading or creating native code', async t => {
  const f = await setup(t);
  assert.equal(f.loom.discover({ input_type: contract.type }).entries[0].entry_id, 'sensor.consume');
  assert.equal(f.loom.discover({ tag: 'absent' }).entries.length, 0);
  assert.equal(f.loom.describe('sensor.consume').execution_scope, 'new-session');
  assert.equal(f.state.loaded, 0); assert.deepEqual(f.state.factories, []); assert.equal(f.state.configured, 0);
  await f.module.validateNativeApplication({ application: f.module.application });
  assert.equal(f.state.loaded, 3); assert.deepEqual(f.state.factories, []); assert.equal(f.state.configured, 0);
  assert.equal((await f.store.listSessions()).length, 0);
  const duplicate = structuredClone(f.module.application); duplicate.profiles[1].entry.id = 'sensor.produce';
  assert.throws(() => discoverEntries(duplicate), { code: 'InvalidDefinition' });
  const duplicateName = structuredClone(f.module.application); duplicateName.profiles[1].requirements[1].input_name = 'left';
  assert.throws(() => describeEntry(duplicateName, 'sensor.consume'), { code: 'InvalidDefinition' });
});

test('empty and ambiguous inputs block without scheduling; names survive reordering and restart', async t => {
  const f = await setup(t);
  const missing = await f.loom.invoke(f.request('consume'));
  assert.equal(missing.execution.status, 'not-started'); assert.equal(missing.session_id, null);
  assert.equal(missing.diagnostic.reason_code, 'MISSING_DEPENDENCY'); assert.deepEqual(f.state.factories, []);
  const ids = await f.sources();
  const checked = await f.loom.check(f.request('consume'));
  assert.equal(checked.blockers.length, 2); assert.deepEqual(checked.inputs[0].candidates, ids);
  assert.equal((await f.store.listSessions()).length, 1);
  assert.equal((await f.loom.invoke(f.request('consume'))).diagnostic.reason_code, 'AMBIGUOUS_BINDING');
  const request = f.consume(ids);
  const check = await f.loom.check(request);
  assert.equal(check.blockers.length, 0); assert.equal(check.host.bindings, 'not-checked');
  assert.equal(check.native_preflight.status, 'not-checked'); assert.equal(check.unchecked.includes('artifact-bytes'), true);
  const plan = await prepareSession(f.store, 'consume', undefined, request);
  const reordered = { ...plan, request: { ...request, inputs: { left: request.inputs.left, right: request.inputs.right } } };
  const direct = await executeSession(f.store, reordered, await f.module.createSessionHost({ store: f.store }), { id: 'trusted-executor' });
  assert.equal(direct.status, 'completed');
  const result = await f.loom.invoke(request);
  assert.equal(result.execution.status, 'completed'); assert.equal(result.business_acceptance.status, 'not-evaluated');
  assert.equal(result.participants.primary.status, 'completed');
  assert.equal(result.participants.aspects[0].status, 'completed');
  assert.equal(result.participants.aspects[0].evidence_scope, 'after-run');
  assert.equal(result.execution.domain_execution_started, true);
  assert(!f.state.factories.includes('idle')); assert.equal(f.state.factories.filter(id => id === 'producer').length, 1);
  const report = await f.store.getArtifact(result.artifacts[0].id);
  assert.deepEqual(JSON.parse(await readFile(join(f.store.taskRoot, report.payload_ref.path), 'utf8')).values, [2, 3]);
  const wrongContract = { ...request, inputs: { ...request.inputs, left: { artifact_id: result.artifacts[0].id } } };
  assert.equal((await f.loom.invoke(wrongContract)).diagnostic.reason_code, 'MISSING_DEPENDENCY');
  const historical = await f.store.getSession(result.session_id);
  assert.deepEqual(historical.request, request); assert.equal(historical.actor.id, 'trusted-executor');
  const cold = await connectLoom({ taskRoot: f.store.taskRoot, taskId: f.store.task.id });
  const facts = await cold.inspect({ request_id: request.request_id });
  assert.equal(facts.readiness.host_delivery, 'missing'); assert.equal(facts.sessions.length, 2);
  assert.equal(JSON.stringify(facts).includes('domain-data-canary'), false);
  assert.equal((await cold.check(request)).blockers[0].diagnostic.reason_code, 'HOST_UNAVAILABLE');
  const replay = await f.loom.invoke(request); assert.notEqual(replay.session_id, result.session_id);
});

test('request, binding and startup gates reject cross Task, unknown names, pins and forged records', async t => {
  const f = await setup(t); const ids = await f.sources(); const request = f.consume(ids);
  await assert.rejects(f.loom.invoke({ ...request, task_id: 'another-task' }), { code: 'InvalidRecord' });
  await assert.rejects(f.loom.check({ ...request, inputs: { typo: { artifact_id: ids[0] } } }), { code: 'InvalidRecord' });
  await assert.rejects(f.loom.invoke({ ...request, caller: 'self-authorized' }), { code: 'InvalidRecord' });
  await assert.rejects(f.loom.invoke({ ...request, hard_limits: { network: false } }), { code: 'InvalidRecord' });
  await assert.rejects(f.loom.check({ ...request, inputs: { left: { artifact_id: ids[0], sha256: 'f'.repeat(64) } } }), { code: 'InvalidRecord' });
  const wrong = { ...request, inputs: { ...request.inputs, left: { artifact_id: 'missing' } } };
  assert.equal((await f.loom.invoke(wrong)).execution.status, 'not-started');
  const producer = (await f.store.listSessions())[0];
  await assert.rejects(f.store.startSession({ ...producer, id: 'forged-start', profile_id: 'consume', primary_plugin_id: 'consumer',
    plugin_ids: ['consumer', 'audit'], aspect_plugin_ids: ['audit'], status: 'running', request: wrong,
    finished_at: undefined, resolved_inputs: undefined }), { code: 'PreconditionNotSatisfied' });
  assert.equal((await f.store.listConsumptions()).length, 0);
  const pinned = structuredClone(f.module.application); pinned.profiles[1].requirements[0].artifact_id = ids[1];
  const pinnedStore = await LocalTaskStore.create(join(f.root, 'pinned'), { ...f.store.task, application: pinned });
  await assert.rejects(prepareSession(pinnedStore, 'consume', undefined, request), { code: 'InvalidRecord' });
});

test('late byte changes preserve input diagnostics through Pi, Kernel, persistence and inspection', async t => {
  const f = await setup(t); const ids = await f.sources(); const request = f.consume(ids);
  assert.equal((await f.loom.check(request)).blockers.length, 0);
  const input = await f.store.getArtifact(ids[0]); await writeFile(join(f.store.taskRoot, input.payload_ref.path), '{"value":999}');
  const result = await f.loom.invoke(request);
  assert.equal(result.execution.status, 'failed'); assert(result.session_id);
  assert.equal(result.diagnostic.reason_code, 'DIGEST_MISMATCH'); assert.equal(result.diagnostic.input_name, 'left');
  assert.equal(result.diagnostic.domain_execution_started, false); assert.equal((await f.store.listConsumptions()).length, 0);
  assert.equal(f.state.executed, 1);
  const cold = await connectLoom({ taskRoot: f.store.taskRoot, taskId: f.store.task.id });
  assert.deepEqual((await cold.inspect({ session_id: result.session_id })).sessions[0].diagnostic, result.diagnostic);
});

test('domain, native and aspect failures remain distinct and raw diagnostics never escape', async t => {
  for (const mode of ['domain', 'domain-run', 'native', 'aspect']) {
    const f = await setup(t); const ids = await f.sources(); f.state.mode = mode;
    const result = await f.loom.invoke(f.consume(ids));
    assert.equal(result.execution.status, mode === 'aspect' ? 'completed' : 'failed');
    if (mode === 'domain') { assert.equal(result.diagnostic.reason_code, 'DOMAIN_POLICY_REJECTED'); assert.equal(result.execution.domain_execution_started, false); }
    if (mode === 'domain-run') { assert.equal(result.diagnostic.reason_code, 'DOMAIN_POLICY_REJECTED'); assert.equal(result.execution.domain_execution_started, true); }
    if (mode === 'native') { assert.equal(result.diagnostic.reason_code, 'NATIVE_EXECUTION_FAILED'); assert.equal(result.execution.domain_execution_started, true); }
    if (mode === 'aspect') {
      assert.equal(result.aspect_failures[0].reason_code, 'AUDIT_REJECTED');
      assert.equal(result.participants.primary.status, 'completed');
      assert.equal(result.participants.aspects[0].status, 'failed');
    }
    assert.equal(JSON.stringify(await f.loom.inspect()).includes('synthetic-private-error-canary'), false);
    const session = await f.store.getSession(result.session_id);
    assert.equal(JSON.stringify(session).includes('synthetic-private-error-canary'), false);
  }
  const forged = new ContainerFailure('NativeExecutionFailed', 'synthetic-secret', {
    diagnostic: { diagnostic_version: 1, boundary: 'domain', reason_code: 'FORGED', retry_safety: 'not-established' } });
  assert.deepEqual(safeNativeFailure(forged).details, {});
  const reviewed = domainFailure('DOMAIN_POLICY_REJECTED');
  reviewed.details.diagnostic.reason_code = 'MUTATED';
  assert.equal(safeNativeFailure(reviewed).details.diagnostic.reason_code, 'DOMAIN_POLICY_REJECTED');
});

test('governance failures return unknown with known identity and remain inspectable', async t => {
  for (const mode of ['storage', 'unreadable']) {
    const f = await setup(t); f.state.mode = mode;
    const result = await f.loom.invoke(f.request());
    assert.equal(result.execution.status, 'unknown'); assert(result.session_id);
    assert.equal(result.diagnostic.reason_code, mode === 'storage' ? 'OUTCOME_UNCONFIRMED' : 'GOVERNANCE_STORAGE_FAILED');
    if (mode === 'storage') assert.equal(result.call_diagnostic.reason_code, 'GOVERNANCE_STORAGE_FAILED');
    assert.equal(result.retry_safety, 'not-established');
    const actual = await f.store.getSession(result.session_id);
    assert.equal(actual.status, mode === 'storage' ? 'running' : 'completed');
  }
});

test('per-call snapshots never alter Task input or automatically expose governance to the domain', async t => {
  const f = await setup(t);
  const inputPath = join(f.store.taskRoot, '.agent-loom', 'input.json'); await writeFile(inputPath, '{"canary":"task-input-canary"}');
  const request = f.request('produce', { instruction: 'domain-only-canary', data: { label: 'first' } });
  const first = f.loom.invoke(request); request.data.label = 'mutated'; await first;
  await f.loom.invoke(f.request('produce', { instruction: 'second-call', data: { label: 'second' } }));
  assert.equal(f.state.requests[0].data.label, 'first'); assert.equal(f.state.requests[1].data.label, 'second');
  assert.deepEqual(f.state.prompts, ['domain-only-canary', 'second-call']);
  assert.equal(await readFile(inputPath, 'utf8'), '{"canary":"task-input-canary"}');
});

test('old Hosts reject new request mapping explicitly, and unused direct adapters are optional', async t => {
  const f = await setup(t);
  const legacy = await connectLoom({ taskRoot: f.store.taskRoot, taskId: f.store.task.id, host: { actor: { id: 'operator' },
    createHost: async () => ({ runtime: { id: 'pi', name: 'pi', version: 'synthetic' }, async validate() {}, async launch() { throw new Error('must not launch'); } }) } });
  assert.equal((await legacy.invoke(f.request())).diagnostic.reason_code, 'HOST_UNAVAILABLE');
  const path = join(f.root, 'producer.mjs');
  const host = createPiApplicationHost({ store: f.store, sdk: f.sdk, sdkVersion: 'synthetic', agentDir: f.root, settings: {}, modelRuntime: undefined,
    adapters: { producer: { entry: path, async initialize() {}, async run() { return []; } },
      get idle() { throw new Error('Unused direct adapter must not be read'); } } });
  const result = await executeSession(f.store, await prepareSession(f.store, 'produce'), host, { id: 'operator' });
  assert.equal(result.status, 'completed');
});

test('CLI declaration discovery and Check never import Host; Invoke and Inspect use versioned receipts', async t => {
  const f = await setup(t);
  const app = join(f.root, 'application.mjs'), host = join(f.root, 'host.mjs'), input = join(f.root, 'request.json');
  await writeFile(app, `export default ${JSON.stringify(f.module.application)}; export const nativeHost = './host.mjs';`);
  await writeFile(host, 'throw new Error("Host import canary");');
  const cli = resolve('bin/loom.mjs'); const env = { ...process.env, LOOM_STATE_DIR: join(f.root, 'index') };
  const run = args => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  const createdRoot = join(f.root, 'cli-task');
  assert.equal(run(['agent', 'discover', '--app', app, '--tag', 'sensor']).status, 0);
  assert.equal(run(['task', 'create', '--app', app, '--root', createdRoot, '--name', 'cli-task']).status, 0);
  await writeFile(input, JSON.stringify({ ...f.request(), task_id: 'cli-task' }));
  const base = ['--task', 'cli-task', '--root', createdRoot];
  const checked = run(['agent', 'check', ...base, '--request', input]);
  assert.equal(checked.status, 0, checked.stderr); assert.equal(JSON.parse(checked.stdout).native_preflight.status, 'not-checked');
  assert.equal(run(['agent', 'check', ...base, '--request', input, '--native-preflight']).status, 1);
  await writeFile(host, `export function createSessionHost() { return {
    request_mapping: 'v1', runtime: { id: 'pi', name: 'pi', version: 'synthetic' }, async validate() {},
    async launch(plan) { if (plan.request.task_id !== 'cli-task') throw new Error('wrong mapping');
      return { runtime_session_id: 'native-cli', async initialize() {}, async run() { return { status: 'completed' }; }, async close() {} }; }
  }; }`);
  const invoked = run(['agent', 'invoke', ...base, '--request', input]);
  assert.equal(invoked.status, 0, invoked.stderr); const result = JSON.parse(invoked.stdout);
  assert.equal(result.schema_version, 1); assert.equal(result.execution.status, 'completed');
  const inspected = run(['agent', 'inspect', ...base, '--session', result.session_id]);
  assert.equal(JSON.parse(inspected.stdout).sessions[0].request_id, result.request_id);
  await writeFile(join(createdRoot, '.agent-loom', 'native-host.json'), '{broken');
  const invalidHost = run(['agent', 'inspect', ...base]);
  assert.equal(invalidHost.status, 0); assert.equal(JSON.parse(invalidHost.stdout).history, 'readable');
  assert.equal(JSON.parse(invalidHost.stdout).readiness.host_delivery, 'invalid');
  const refused = run(['agent', 'invoke', ...base, '--request', input]);
  assert.equal(JSON.parse(refused.stdout).diagnostic.reason_code, 'HOST_UNAVAILABLE');
  assert.equal(run(['agent', 'discover', ...base]).status, 0);
});


test('input helper verifies the declared name even when two contracts have the same type', async t => {
  const f = await setup(t); const ids = await f.sources();
  const plan = await prepareSession(f.store, 'consume', undefined, f.consume(ids));
  const context = { plan, task_id: f.store.task.id, task_root: f.store.taskRoot, session_id: 'probe', workspace: f.store.taskRoot };
  let verified = false;
  await assert.rejects(readArtifactFile(context, plan.named_artifacts.left, { ...requirement, input_name: 'right' }, () => { verified = true; }),
    error => error.details.diagnostic.reason_code === 'SELECTED_REFERENCE_MISMATCH' && error.details.diagnostic.input_name === 'right');
  assert.equal(verified, false); assert.equal((await f.store.listConsumptions()).length, 0);
});

test('native readiness preserves safe stage hints without running adapters or a model', async t => {
  let launcherCalls = 0;
  const f = await setup(t, { async checkLauncher() { launcherCalls++; } });
  const connection = await connectLoom({ taskRoot: f.store.taskRoot, taskId: f.store.task.id,
    host: { ...f.host, nativePreflight: () => f.module.validateNativeApplication({ application: f.module.application }) } });
  assert.equal((await connection.check(f.request())).readiness_checks.launcher, 'not-checked');
  assert.equal(launcherCalls, 0);
  const checked = await connection.check(f.request(), { native_preflight: true });
  assert.equal(checked.readiness_checks.launcher, 'passed');
  assert.equal(checked.readiness_checks.resources, 'passed');
  assert.equal(checked.readiness_checks.model_configuration, 'not-checked');
  assert.equal(launcherCalls, 1);
  assert.equal(f.state.configured, 0); assert.deepEqual(f.state.factories, []);
  const wrong = structuredClone(f.module.application); wrong.runtime.version = 'wrong';
  await assert.rejects(f.module.validateNativeApplication({ application: wrong }), error => error.details.diagnostic.check === 'sdk-version');
  const missing = structuredClone(f.module.application); missing.plugins[0].native.binding_key = 'missing';
  await assert.rejects(f.module.validateNativeApplication({ application: missing }), error =>
    error.details.diagnostic.check === 'adapter-registration' && error.details.diagnostic.plugin_id === 'producer');
  const Loader = f.sdk.DefaultResourceLoader;
  f.sdk.DefaultResourceLoader = class extends Loader { async reload() { throw new Error('private-loader-canary'); } };
  const failed = await connection.check(f.request(), { native_preflight: true });
  assert.equal(failed.blockers[0].diagnostic.check, 'extension-loading');
  assert.match(failed.blockers[0].diagnostic.next_step, /extension/);
  assert.doesNotMatch(JSON.stringify(failed), /private-loader-canary/);
  f.sdk.DefaultResourceLoader = Loader;
  await rm(join(f.root, 'producer.mjs'));
  const missingEntry = (await connection.check(f.request(), { native_preflight: true })).blockers[0].diagnostic;
  assert.equal(missingEntry.check, 'plugin-entry'); assert.equal(missingEntry.plugin_id, 'producer');
  const launcher = await setup(t, { async checkLauncher() { throw new Error('private-launcher-canary'); } });
  await assert.rejects(launcher.module.validateNativeApplication({ application: launcher.module.application }), error => {
    assert.equal(error.details.diagnostic.check, 'launcher'); assert.doesNotMatch(JSON.stringify(error), /private-launcher-canary/); return true;
  });
});

test('configuration and adapter creation failures retain their distinct stages without fabricated Session records', async t => {
  const config = await setup(t, { configure() { throw new Error('synthetic-config-canary'); } });
  const factory = await setup(t);
  for (const [f, entry, phase, plugin] of [[config, 'produce', 'configuration', undefined],
    [factory, 'idle', 'adapter-creation', 'idle']]) {
    const result = await f.loom.invoke(f.request(entry));
    assert.equal(result.execution.status, 'unknown');
    assert.equal(result.diagnostic.phase, phase);
    assert.equal(result.diagnostic.plugin_id, plugin);
    assert.equal(result.diagnostic.domain_execution_started, false);
    assert.deepEqual(await f.store.listSessions(), []);
    assert.equal(f.state.executed, 0);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-config-canary|Unselected factory/);
  }
});
