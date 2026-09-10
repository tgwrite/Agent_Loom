// Independent experimental governance owner. No Loom implementation dependencies.
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function requireValue(value, code = 'InvalidRecord') {
  if (!value) throw Object.assign(new Error(code), { code });
}
const text = value => requireValue(typeof value === 'string' && value.trim());
const id = value => requireValue(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value));
const date = value => requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const hash = value => requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
export function relativePath(value, workspace = false) {
  requireValue(typeof value === 'string' && (workspace && value === '.' || value && !value.includes('\\')
    && !value.includes(':') && value.split('/').every(p => p && p !== '.' && p !== '..')));
  if (workspace) requireValue(!/^\.agent-(loom|container)(\/|$)/.test(value));
  return value;
}
function failure(value) { text(value.code); text(value.message); text(value.source); date(value.timestamp); }
function task(value) {
  requireValue(value.schema_version === 2);
  id(value.id); id(value.application_id); text(value.title); date(value.created_at);
  const app = value.application;
  requireValue(app.id === value.application_id); text(app.version); text(app.runtime.id); text(app.runtime.version);
  requireValue(Array.isArray(app.plugins) && Array.isArray(app.profiles));
  requireValue(new Set(app.plugins.map(p => p.id)).size === app.plugins.length);
  for (const p of app.plugins) {
    id(p.id); requireValue(['domain', 'aspect'].includes(p.role)); text(p.native.binding_key);
    requireValue(p.native.runtime === app.runtime.id);
    for (const c of p.produces ?? []) { text(c.type); text(c.version); }
  }
  for (const p of app.profiles) {
    id(p.id); relativePath(p.workspace ?? '.', true);
    const selected = [p.primary, ...p.aspects].filter(Boolean);
    requireValue(new Set(selected).size === selected.length);
    if (p.primary) requireValue(app.plugins.some(x => x.id === p.primary && x.role === 'domain'));
    for (const aspect of p.aspects) requireValue(app.plugins.some(x => x.id === aspect && x.role === 'aspect'));
    for (const r of p.requirements) { text(r.type); text(r.version); text(r.verification_status); }
  }
}
function session(value, state) {
  [value.id, value.profile_id, value.actor.id, value.runtime.id].forEach(id);
  requireValue(value.task_id === state.task.id);
  const p = state.task.application.profiles.find(p => p.id === value.profile_id);
  requireValue(p && value.primary_plugin_id === p.primary && JSON.stringify(value.aspect_plugin_ids) === JSON.stringify(p.aspects));
  requireValue(JSON.stringify(value.plugin_ids) === JSON.stringify([p.primary, ...p.aspects].filter(Boolean)));
  relativePath(value.workspace, true); text(value.runtime.name); text(value.runtime.version);
  if (value.runtime_session_id !== undefined) text(value.runtime_session_id);
  requireValue(['running', 'completed', 'failed'].includes(value.status)); date(value.started_at);
  if (value.status === 'running') requireValue(value.finished_at === undefined);
  else { date(value.finished_at); requireValue(value.finished_at >= value.started_at); }
  if (value.failure) { failure(value.failure); requireValue(value.status === 'failed'); }
}
function artifact(value, state) {
  id(value.id); requireValue(value.task_id === state.task.id); hash(value.sha256); date(value.created_at);
  text(value.type); text(value.version); text(value.verification.status);
  const s = state.sessions.find(s => s.id === value.producer.session_id);
  requireValue(s && s.plugin_ids.includes(value.producer.plugin_id));
  id(value.producer.capability_id);
  const p = state.task.application.plugins.find(p => p.id === value.producer.plugin_id);
  requireValue(p.produces?.some(c => c.type === value.type && c.version === value.version));
  requireValue(value.executor.actor_id === s.actor.id && value.executor.runtime_id === s.runtime.id);
  if (value.producer_phase !== undefined || value.native_runtime_session_id !== undefined) {
    requireValue(['domain-run', 'aspect-after-run'].includes(value.producer_phase)); text(value.native_runtime_session_id);
    requireValue(value.native_runtime_session_id === s.runtime_session_id);
    requireValue(value.producer_phase === 'domain-run' ? value.producer.plugin_id === s.primary_plugin_id : s.aspect_plugin_ids.includes(value.producer.plugin_id));
  }
  requireValue(value.payload_ref.kind === 'file' || value.payload_ref.kind === 'inline');
  if (value.payload_ref.kind === 'file') relativePath(value.payload_ref.path);
}
function event(value, state) {
  [value.id, value.session_id, value.actor_id, value.correlation_id].forEach(id); text(value.source); date(value.timestamp);
  requireValue(value.task_id === state.task.id);
  const s = state.sessions.find(s => s.id === value.session_id);
  requireValue(s && s.actor.id === value.actor_id);
  requireValue(/^(session\.(started|completed|failed)|artifact\.(published|consumed)|observer\.failed|runtime\.[a-z][a-z0-9_.-]*)$/.test(value.type));
  if (value.type === 'observer.failed') {
    const p = value.payload; id(p.plugin_id); failure(p.failure);
    requireValue(s.aspect_plugin_ids.includes(p.plugin_id) && p.failure.source === p.plugin_id);
    if (p.contract_version !== undefined || p.phase !== undefined || p.failure_class !== undefined) {
      requireValue(p.contract_version === 2 && /^[a-z][a-z0-9_-]*$/.test(p.phase ?? ''));
      requireValue(['native-hook', 'aspect-execution', 'publication-validation', 'governance-storage', 'unspecified'].includes(p.failure_class));
    }
  }
}
function validate(state) {
  task(state.task);
  for (const collection of ['sessions', 'artifacts', 'consumptions', 'events']) {
    requireValue(Array.isArray(state[collection]));
    requireValue(new Set(state[collection].map(v => v.id)).size === state[collection].length);
  }
  for (const s of state.sessions) session(s, state);
  for (const a of state.artifacts) artifact(a, state);
  const bindings = new Set();
  for (const c of state.consumptions) {
    id(c.id); date(c.consumed_at); hash(c.sha256); requireValue(c.task_id === state.task.id);
    const s = state.sessions.find(s => s.id === c.session_id), a = state.artifacts.find(a => a.id === c.artifact_id);
    requireValue(s && a && s.plugin_ids.includes(c.consumer_plugin_id) && a.sha256 === c.sha256);
    const key = JSON.stringify([c.session_id, c.consumer_plugin_id, c.artifact_id]);
    requireValue(!bindings.has(key)); bindings.add(key);
  }
  for (const e of state.events) event(e, state);
}
const envelope = (state, s, type, payload, timestamp = new Date().toISOString()) => ({ id: randomUUID(), type, payload, timestamp,
  task_id: state.task.id, session_id: s.id, actor_id: s.actor.id, source: 'control', correlation_id: s.id });

export class ControlStore {
  constructor(root, value) { this.taskRoot = resolve(root); this.snapshot = structuredClone(value); }
  get task() { return structuredClone(this.snapshot); }
  get file() { return join(this.taskRoot, '.control', 'state.json'); }
  static async create(root, value) {
    task(value); const store = new ControlStore(root, value);
    await mkdir(join(store.taskRoot, '.control'), { recursive: true });
    await writeFile(store.file, JSON.stringify({ task: value, sessions: [], artifacts: [], consumptions: [], events: [] }), { flag: 'wx' });
    return store;
  }
  static async open(root) {
    const state = JSON.parse(await readFile(join(root, '.control', 'state.json'), 'utf8')); validate(state);
    return new ControlStore(root, state.task);
  }
  async read() {
    const state = JSON.parse(await readFile(this.file, 'utf8')); validate(state);
    requireValue(JSON.stringify(state.task) === JSON.stringify(this.snapshot)); return state;
  }
  async change(kind, operation) {
    const state = await this.read(); const result = await operation(state); validate(state);
    const temp = join(this.taskRoot, '.control', `state.${kind}.${randomUUID()}.tmp`);
    try { await writeFile(temp, JSON.stringify(state), { flag: 'wx' }); await rename(temp, this.file); }
    finally { await rm(temp, { force: true }); }
    return structuredClone(result);
  }
  async getSession(id) { const s = (await this.read()).sessions.find(s => s.id === id); requireValue(s); return s; }
  async listSessions() { return (await this.read()).sessions; }
  async listArtifacts() { return (await this.read()).artifacts; }
  async listConsumptions() { return (await this.read()).consumptions; }
  async listEvents(id) { return (await this.read()).events.filter(e => e.session_id === id); }
  async resolveArtifact(r) {
    const matches = (await this.listArtifacts()).filter(a => a.type === r.type && a.version === r.version
      && a.verification.status === r.verification_status && (!r.artifact_id || a.id === r.artifact_id));
    requireValue(matches.length, 'PreconditionNotSatisfied'); requireValue(matches.length === 1, 'BindingConflict'); return matches[0];
  }
  async startSession(s) {
    for (const r of this.task.application.profiles.find(p => p.id === s.profile_id)?.requirements ?? []) await this.resolveArtifact(r);
    await this.change('start', state => { requireValue(s.status === 'running'); state.sessions.push(s); state.events.push(envelope(state, s, 'session.started', {}, s.started_at)); });
  }
  async publishArtifact(a) {
    return this.change('artifact', state => {
      const s = state.sessions.find(s => s.id === a.producer.session_id); requireValue(s?.status === 'running');
      state.artifacts.push(a); state.events.push(envelope(state, s, 'artifact.published', { artifact_id: a.id })); return a;
    });
  }
  async recordConsumption(c) {
    return this.change('consumption', state => {
      const s = state.sessions.find(s => s.id === c.session_id); requireValue(s?.status === 'running');
      const old = state.consumptions.find(x => x.session_id === c.session_id && x.consumer_plugin_id === c.consumer_plugin_id && x.artifact_id === c.artifact_id);
      if (old) return old;
      state.consumptions.push(c); state.events.push(envelope(state, s, 'artifact.consumed', { artifact_id: c.artifact_id })); return c;
    });
  }
  async appendEvent(e) { await this.change('event', state => { requireValue(state.sessions.find(s => s.id === e.session_id)?.status === 'running'); state.events.push(e); }); }
  async recordObserverFailure(sessionId, pluginId, f, context = { phase: 'unknown', failure_class: 'unspecified' }) {
    await this.change('observer', state => {
      const s = state.sessions.find(s => s.id === sessionId); requireValue(s?.status === 'running');
      state.events.push(envelope(state, s, 'observer.failed', { contract_version: 2, plugin_id: pluginId,
        phase: context.phase, failure_class: context.failure_class, failure: f }, f.timestamp));
    });
  }
  async settleSession(sessionId, status, finishedAt, f) {
    await this.change('terminal', state => {
      const s = state.sessions.find(s => s.id === sessionId); requireValue(s?.status === 'running', 'InvalidTransition');
      s.status = status; s.finished_at = finishedAt;
      if (status === 'failed') s.failure = f ?? { code: 'NativeExecutionFailed', message: 'Execution failed.', source: 'control', timestamp: finishedAt };
      state.events.push(envelope(state, s, `session.${status}`, s.failure ?? {}, finishedAt));
    });
  }
  async inspect() {
    const state = await this.read();
    return { task: state.task, sessions: state.sessions.map(s => ({ ...s,
      produced: state.artifacts.filter(a => a.producer.session_id === s.id),
      consumed: state.consumptions.filter(c => c.session_id === s.id).map(c => ({ ...c, producer: state.artifacts.find(a => a.id === c.artifact_id).producer })),
      events: state.events.filter(e => e.session_id === s.id) })),
      artifacts: state.artifacts.map(a => ({ ...a, consumers: state.consumptions.filter(c => c.artifact_id === a.id) })) };
  }
}
