import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export const stamp = '2026-01-01T00:00:00.000Z';
export const application = { id: 'parity', version: '1', runtime: { id: 'pi', version: 'test' },
  plugins: ['domain', 'observer', 'audit'].map((id, index) => ({ id, role: index ? 'aspect' : 'domain',
    native: { runtime: 'pi', binding_key: id }, capabilities: [], produces: [{ type: index ? 'review' : 'source', version: '1' }] })),
  profiles: [{ id: 'producer', primary: 'domain', aspects: ['observer', 'audit'], requirements: [] },
    { id: 'consumer', primary: 'domain', aspects: ['observer', 'audit'], workspace: 'consumer', requirements: [{ type: 'source', version: '1', verification_status: 'READY' }] }] };
export const task = (id = 'task-one') => ({ schema_version: 2, id, application_id: 'parity', application: structuredClone(application), title: 'Synthetic parity', created_at: stamp });
export const session = (taskId = 'task-one', id = 'producer') => ({ id, task_id: taskId, profile_id: 'producer', workspace: '.',
  primary_plugin_id: 'domain', aspect_plugin_ids: ['observer', 'audit'], plugin_ids: ['domain', 'observer', 'audit'],
  actor: { id: 'local-operator' }, runtime: { id: 'pi', name: 'pi', version: 'test' }, runtime_session_id: `native-${id}`, status: 'running', started_at: stamp });
export const artifact = (taskId = 'task-one', id = 'artifact-one') => ({ id, task_id: taskId, type: 'source', version: '1',
  producer: { plugin_id: 'domain', capability_id: 'publish', session_id: 'producer' }, executor: { actor_id: 'local-operator', runtime_id: 'pi' },
  producer_phase: 'domain-run', native_runtime_session_id: 'native-producer', verification: { status: 'READY' },
  payload_ref: { kind: 'file', path: 'payload.txt' }, sha256: 'a'.repeat(64), created_at: stamp });
export const failure = plugin => ({ code: 'NativeAspectFailed', message: 'PRIVATE_OBSERVER_CANARY', source: plugin, timestamp: stamp });
export const barrier = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// Overrides actual Node I/O boundaries; the callback observes or fails before the real call.
// One probe per process, restored after each case. Never used by the production runtime.
export function interceptIO(callback) {
  const originals = {};
  for (const name of ['writeFile', 'appendFile', 'rename']) {
    originals[name] = fs[name];
    fs[name] = async (...args) => { await callback(name, args); return originals[name](...args); };
  }
  syncBuiltinESMExports();
  return () => { Object.assign(fs, originals); syncBuiltinESMExports(); };
}
export function writeKind(name, args) {
  const path = String(args[0]).replaceAll('\\', '/'), bytes = String(args[1]);
  if (path.includes('/.control/')) {
    const kind = /state\.(start|artifact|consumption|observer|terminal|event)\./.exec(path)?.[1];
    if (kind === 'event' && (name !== 'writeFile' || JSON.parse(bytes).events.at(-1)?.type !== 'runtime.pi.shutdown')) return undefined;
    return kind;
  }
  if (!path.includes('/.agent-loom/')) return undefined;
  if (name === 'appendFile') {
    if (path.endsWith('/artifacts.jsonl')) return 'artifact';
    if (path.endsWith('/consumptions.jsonl')) return 'consumption';
    if (bytes.includes('"type":"observer.failed"')) return 'observer';
    if (/"type":"session\.(completed|failed)"/.test(bytes)) return 'terminal';
    if (bytes.includes('"type":"runtime.pi.shutdown"')) return 'event';
  }
  if (name === 'writeFile' && path.endsWith('/session.json')) return 'start';
}

export async function fakeOptions(root, behavior = {}) {
  const trace = [], requests = []; let bindings, loader;
  const entries = Object.fromEntries(await Promise.all(['domain', 'observer', 'audit'].map(async id => {
    const path = join(root, `${id}.mjs`); await fs.writeFile(path, 'export default () => {};'); return [id, path];
  })));
  const native = { messages: [], systemPrompt: 'Synthetic policy', async prompt(message) {
    requests.push({ messages: structuredClone(this.messages), system: this.systemPrompt, prompt: message });
  }, async abort() {}, async bindExtensions(value) {
    bindings = value;
    if (behavior.hook) value.onError({ extensionPath: entries.observer, event: behavior.hook, error: 'PRIVATE_OBSERVER_CANARY' });
  }, extensionRunner: { async emit() { trace.push('shutdown'); if (behavior.shutdown) await behavior.shutdown(); } }, dispose() { trace.push('dispose'); } };
  const options = { sdkVersion: 'test', agentDir: root, settings: {}, modelRuntime: {}, sdk: {
    SettingsManager: { inMemory: () => ({}) }, SessionManager: { create: () => ({ getSessionId: () => `native-${randomUUID()}` }) },
    DefaultResourceLoader: class { constructor(value) { loader = value; } async reload() {} getExtensions() {
      return { errors: [], extensions: loader.additionalExtensionPaths.map(resolvedPath => ({ resolvedPath })) }; } },
    async createAgentSession() { trace.push('native'); return { session: native }; },
  }, adapters: Object.fromEntries(['domain', 'observer', 'audit'].map(id => [id, { entry: entries[id] }])) };
  options.adapters.domain.initialize = async (context, artifacts) => { trace.push('initialize'); await behavior.initialize?.(context, artifacts); trace.push('accepted'); };
  options.adapters.domain.run = async (s, context) => { trace.push('domain'); await s.prompt('Run domain.');
    if (behavior.domainFailure) throw new Error('PRIVATE_DOMAIN_CANARY');
    return behavior.run ? behavior.run(s, context) : []; };
  for (const id of ['observer', 'audit']) options.adapters[id].afterRun = async (s, context, outcome) => {
    trace.push(`${id}:${outcome}`); if (behavior[`${id}Failure`]) throw new Error('PRIVATE_REVIEW_CANARY');
    return behavior[id] ? behavior[id](s, context, outcome) : [];
  };
  return { options, trace, requests, native, hook: (id, event) => bindings.onError({ extensionPath: entries[id], event, error: 'PRIVATE_OBSERVER_CANARY' }) };
}
