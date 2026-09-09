// Experimental no-Loom control, not a second supported runtime.
// Owns the governance needed for the same tested guarantees. No Loom imports.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readJson } from '../lightweight/native-runtime.mjs';
import { setup } from './setup.mjs';
import { containedFile, sha256 } from '../lightweight/handoff.mjs';

const [operation, rootArg, taskId, profileId, appFile] = process.argv.slice(2);
const root = resolve(rootArg);
const stateFile = join(root, 'control-state.local.json');
const save = state => writeFile(stateFile, JSON.stringify(state, null, 2));
const fail = code => { const error = new Error(code); error.code = code; throw error; };
try {
  if (operation === 'create') {
    const { application } = await import(pathToFileURL(resolve(appFile)).href);
    await mkdir(root, { recursive: true });
    await writeFile(stateFile, JSON.stringify({ task: { id: taskId, application }, sessions: [], artifacts: [], consumptions: [] }), { flag: 'wx' });
    console.log(JSON.stringify({ task: taskId }));
  } else {
    const state = await readJson(stateFile);
    assert.equal(state.task.id, taskId);
    if (operation === 'inspect') {
      console.log(JSON.stringify({ ...state,
        sessions: state.sessions.map(s => ({ ...s,
          produced: state.artifacts.filter(a => a.producer.session_id === s.id),
          consumed: state.consumptions.filter(c => c.session_id === s.id).map(c => ({ ...c,
            producer: state.artifacts.find(a => a.id === c.artifact_id).producer })) })),
        artifacts: state.artifacts.map(a => ({ ...a, consumers: state.consumptions.filter(c => c.artifact_id === a.id) })),
      }));
    } else {
      assert.equal(operation, 'start');
      const app = state.task.application;
      const profile = app.profiles.find(p => p.id === profileId);
      assert(profile);
      const artifacts = profile.requirements.map(req => {
        const matches = state.artifacts.filter(a => a.task_id === taskId && a.type === req.type && a.version === req.version
          && a.verification.status === req.verification_status && (!req.artifact_id || a.id === req.artifact_id));
        if (!matches.length) fail('PreconditionNotSatisfied');
        if (matches.length > 1) fail('BindingConflict');
        return matches[0];
      });
      const config = await readJson(join(root, 'web-input.local.json'));
      const { sdk, sdkVersion, settings, modelRuntime, agentDir, adapters } = await setup(root, config);
      assert.equal(sdkVersion, app.runtime.version);
      const ids = [profile.primary, ...profile.aspects];
      assert.equal(new Set(ids).size, ids.length);
      const plugins = ids.map(id => app.plugins.find(p => p.id === id));
      assert.equal(plugins[0].role, 'domain');
      assert(plugins.slice(1).every(p => p.role === 'aspect'));
      const entries = await Promise.all(plugins.map(p => realpath(adapters[p.native.binding_key].entry)));
      assert.equal(new Set(entries).size, entries.length);
      const primary = adapters[plugins[0].native.binding_key];
      const id = randomUUID();
      const workspace = join(root, profile.workspace);
      const plan = { task_id: taskId, profile_id: profile.id, primary_plugin_id: profile.primary,
        aspect_plugin_ids: profile.aspects, plugin_ids: ids, artifacts };
      const context = { plan, workspace, session_id: id, task_id: taskId, task_root: root };
      const manager = sdk.SessionManager.create(workspace, join(root, 'native-sessions', id));
      const record = { id, task_id: taskId, profile_id: profile.id, workspace: profile.workspace,
        primary_plugin_id: profile.primary, aspect_plugin_ids: profile.aspects, plugin_ids: ids,
        runtime_session_id: manager.getSessionId(), actor: { id: 'local-operator' },
        runtime: { id: 'pi', name: 'pi', version: sdkVersion }, status: 'running', events: [] };
      state.sessions.push(record);
      await save(state);
      let session;
      let primaryFailed = false;
      const event = type => record.events.push({ type: `runtime.pi.${type}`, session_id: id, timestamp: new Date().toISOString() });
      const aspectFailure = (pluginId, phase) => record.events.push({ type: 'observer.failed',
        task_id: taskId, session_id: id, actor_id: record.actor.id, timestamp: new Date().toISOString(),
        payload: { plugin_id: pluginId, failure: { code: 'NativeAspectFailed',
          message: `Native aspect failed during ${phase}.`, source: pluginId, timestamp: new Date().toISOString() } } });
      try {
        await primary.initialize(context, artifacts);
        for (const key of ['packages', 'extensions', 'skills', 'prompts', 'themes']) delete settings[key];
        const settingsManager = sdk.SettingsManager.inMemory(settings);
        const loader = new sdk.DefaultResourceLoader({ cwd: workspace, agentDir, settingsManager,
          noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, additionalExtensionPaths: entries });
        await loader.reload();
        const loaded = loader.getExtensions();
        assert.equal(loaded.errors.length, 0);
        assert.deepEqual(loaded.extensions.map(e => e.resolvedPath).sort(), [...entries].sort());
        ({ session } = await sdk.createAgentSession({ cwd: workspace, agentDir, settingsManager,
          sessionManager: manager, resourceLoader: loader, modelRuntime }));
        await session.bindExtensions({ mode: 'rpc', onError(error) {
          const index = entries.findIndex(entry => entry.toLowerCase() === String(error.extensionPath).toLowerCase());
          const aspect = index > 0;
          if (!aspect) primaryFailed = true;
          event(aspect ? 'aspect-error' : 'extension-error');
          if (aspect) aspectFailure(ids[index], ['session_start', 'session_shutdown', 'tool_execution_end'].includes(error.event) ? error.event : 'unknown');
        } });
        assert(!primaryFailed);
        event('started');
        for (const a of artifacts) state.consumptions.push({ id: randomUUID(), task_id: taskId, session_id: id,
          consumer_plugin_id: profile.primary, artifact_id: a.id, sha256: a.sha256 });
        await save(state);
        const publish = async (plugin, publications) => {
          for (const p of publications) {
            assert(plugin.produces.some(contract => contract.type === p.type && contract.version === p.version));
            state.artifacts.push({ id: randomUUID(), task_id: taskId, type: p.type, version: p.version,
              producer: { plugin_id: plugin.id, capability_id: 'native-publication', session_id: id },
              executor: { actor_id: record.actor.id, runtime_id: 'pi' }, verification: { status: p.verification_status },
              payload_ref: { kind: 'file', path: p.path }, sha256: sha256(await readFile(await containedFile(root, p.path))),
              created_at: new Date().toISOString() });
          }
        };
        await publish(plugins[0], await primary.run(session, context));
        assert(!primaryFailed);
        for (const plugin of plugins.slice(1)) {
          const adapter = adapters[plugin.native.binding_key];
          if (!adapter.afterRun) continue;
          try { await publish(plugin, await adapter.afterRun(session, context, 'completed')); }
          catch { aspectFailure(plugin.id, 'after-run'); }
        }
        record.status = 'completed';
      } catch {
        record.status = 'failed';
        record.failure = { code: 'NativeExecutionFailed' };
      } finally {
        if (session) {
          try {
            await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
            event('shutdown');
            assert(!primaryFailed);
          } catch { record.status = 'failed'; record.failure = { code: 'NativeExecutionFailed' }; }
          finally { session.dispose(); }
        }
        await save(state);
      }
      if (record.status !== 'completed') fail('NativeExecutionFailed');
      console.log(JSON.stringify({ status: record.status, session: record }));
    }
  }
} catch (error) {
  console.error(JSON.stringify({ error: { code: error.code ?? 'ControlFailure' } }));
  process.exitCode = 1;
}
