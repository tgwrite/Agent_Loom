import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { containedFile, sha256 } from '../../lightweight/handoff.mjs';
import { requireValue, relativePath } from './store.mjs';

export async function prepare(store, profileId) {
  const p = store.task.application.profiles.find(p => p.id === profileId); requireValue(p, 'InvalidDefinition');
  return { task_id: store.task.id, profile_id: p.id, workspace: p.workspace ?? '.', primary_plugin_id: p.primary,
    aspect_plugin_ids: [...p.aspects], plugin_ids: [p.primary, ...p.aspects].filter(Boolean),
    artifacts: await Promise.all(p.requirements.map(r => store.resolveArtifact(r))) };
}
export async function execute(store, plan, options) {
  requireValue(JSON.stringify(plan) === JSON.stringify(await prepare(store, plan.profile_id)));
  const { sdk, sdkVersion, adapters } = options;
  requireValue(sdkVersion === store.task.application.runtime.version, 'NativeIntegrationNotReady');
  const plugins = plan.plugin_ids.map(id => store.task.application.plugins.find(p => p.id === id));
  const entries = await Promise.all(plugins.map(p => realpath(adapters[p.native.binding_key].entry)));
  requireValue(new Set(entries).size === entries.length);
  const primary = adapters[plugins[0].native.binding_key];
  const workspace = resolve(store.taskRoot, relativePath(plan.workspace, true));
  const id = randomUUID(), manager = sdk.SessionManager.create(workspace, join(store.taskRoot, 'native-sessions', id));
  const s = { id, task_id: store.task.id, profile_id: plan.profile_id, workspace: plan.workspace,
    primary_plugin_id: plan.primary_plugin_id, aspect_plugin_ids: plan.aspect_plugin_ids, plugin_ids: plan.plugin_ids,
    actor: { id: 'local-operator' }, runtime: { id: 'pi', name: 'pi', version: sdkVersion }, runtime_session_id: manager.getSessionId(),
    status: 'running', started_at: new Date().toISOString() };
  const context = { plan, workspace, session_id: id, task_id: store.task.id, task_root: store.taskRoot };
  let native, domainFailed = false, outcome = 'completed', recorded = false, pending = Promise.resolve();
  const enqueue = operation => { pending = pending.then(operation); void pending.catch(() => {}); return pending; };
  const event = type => enqueue(() => store.appendEvent({ id: randomUUID(), type: `runtime.pi.${type}`, task_id: s.task_id,
    session_id: id, actor_id: s.actor.id, timestamp: new Date().toISOString(), source: 'control', correlation_id: id, payload: {} }));
  const observer = (plugin, phase, failureClass) => enqueue(() => store.recordObserverFailure(id, plugin,
    { code: 'NativeAspectFailed', message: `Native aspect failed during ${phase}.`, source: plugin, timestamp: new Date().toISOString() },
    { phase, failure_class: failureClass }));
  async function publish(plugin, publications) {
    const batch = await Promise.all(publications.map(async p => {
      requireValue(plugin.produces?.some(c => c.type === p.type && c.version === p.version));
      requireValue(typeof p.verification_status === 'string' && p.verification_status.trim());
      return { id: randomUUID(), task_id: s.task_id, type: p.type, version: p.version,
        producer: { plugin_id: plugin.id, capability_id: 'native-publication', session_id: id },
        producer_phase: plugin.id === s.primary_plugin_id ? 'domain-run' : 'aspect-after-run', native_runtime_session_id: s.runtime_session_id,
        executor: { actor_id: s.actor.id, runtime_id: s.runtime.id }, verification: { status: p.verification_status },
        payload_ref: { kind: 'file', path: p.path }, sha256: sha256(await readFile(await containedFile(store.taskRoot, p.path))), created_at: new Date().toISOString() };
    }));
    for (const a of batch) await enqueue(async () => {
      try { await store.publishArtifact(a); }
      catch (error) {
        if (plugin.role === 'aspect') {
          try { await store.recordObserverFailure(id, plugin.id, { code: 'NativeAspectFailed', message: 'Governance storage failed.', source: plugin.id,
            timestamp: new Date().toISOString() }, { phase: 'after-run', failure_class: 'governance-storage' }); } catch { /* storage may be unavailable */ }
        }
        throw error;
      }
    });
  }
  try {
    await store.startSession(s); recorded = true;
    await primary.initialize(context, plan.artifacts);
    const settings = structuredClone(options.settings);
    for (const key of ['packages', 'extensions', 'skills', 'prompts', 'themes']) delete settings[key];
    const settingsManager = sdk.SettingsManager.inMemory(settings);
    const loader = new sdk.DefaultResourceLoader({ cwd: workspace, agentDir: options.agentDir, settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, additionalExtensionPaths: entries });
    await loader.reload(); const loaded = loader.getExtensions();
    requireValue(loaded.errors.length === 0 && JSON.stringify(loaded.extensions.map(e => e.resolvedPath).sort()) === JSON.stringify([...entries].sort()));
    ({ session: native } = await sdk.createAgentSession({ cwd: workspace, agentDir: options.agentDir, settingsManager,
      sessionManager: manager, resourceLoader: loader, modelRuntime: options.modelRuntime }));
    await native.bindExtensions({ mode: 'rpc', onError(error) {
      const key = value => process.platform === 'win32' ? String(value).toLowerCase() : String(value);
      const i = entries.findIndex(e => key(e) === key(error.extensionPath));
      if (i < 1) domainFailed = true;
      void event(i > 0 ? 'aspect-error' : 'extension-error');
      if (i > 0) void observer(plugins[i].id, ['session_start', 'session_shutdown', 'tool_execution_end'].includes(error.event) ? error.event : 'unknown', 'native-hook');
    } });
    await pending; requireValue(!domainFailed, 'NativeExecutionFailed'); await event('started');
    for (const a of plan.artifacts) await store.recordConsumption({ id: randomUUID(), task_id: s.task_id, session_id: id,
      consumer_plugin_id: s.primary_plugin_id, artifact_id: a.id, sha256: a.sha256, consumed_at: new Date().toISOString() });
    try { await publish(plugins[0], await primary.run(native, context)); requireValue(!domainFailed); }
    catch { outcome = 'failed'; }
    for (const plugin of plugins.slice(1)) {
      const adapter = adapters[plugin.native.binding_key]; if (!adapter.afterRun) continue;
      let failureClass = 'aspect-execution';
      try { const publications = await adapter.afterRun(native, context, outcome); failureClass = 'publication-validation'; await publish(plugin, publications); }
      catch { await pending; await observer(plugin.id, 'after-run', failureClass); }
    }
    await pending;
  } catch { outcome = 'failed'; }
  finally {
    if (native) {
      try { await native.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); await event('shutdown'); requireValue(!domainFailed); }
      catch { outcome = 'failed'; }
      finally { native.dispose(); }
    }
    try { await pending; } catch { outcome = 'failed'; }
  }
  requireValue(recorded, 'NativeExecutionFailed');
  await store.settleSession(id, outcome, new Date().toISOString());
  requireValue(outcome === 'completed', 'NativeExecutionFailed');
  return store.getSession(id);
}
