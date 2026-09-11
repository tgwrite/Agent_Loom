// Concrete patches selected only after the passing parity implementation and tests were frozen.
import { readFile } from 'node:fs/promises';
const host = 'packages/runtime-pi/src/application-host.ts';
const service = 'packages/container-core/src/governance.ts';
const store = 'packages/container-core/src/storage/index.ts';
const validation = 'packages/container-core/src/failure/observer.ts';
const cr = 'test/governance-parity/control/runtime.mjs', cs = 'test/governance-parity/control/store.mjs';
const all = ['a', 'b', 'c'];
async function patch(file, before, after) {
  const source = await readFile(file, 'utf8'), newline = source.includes('\r\n') ? '\r\n' : '\n';
  return { file, before: before.replaceAll('\n', newline), after: after.replaceAll('\n', newline) };
}
async function moveInitialization(file, first, next) {
  const source = await readFile(file, 'utf8'), start = source.indexOf(first), end = source.indexOf(next, start);
  if (start < 0 || end < 0) throw new Error('Initialization boundary missing');
  const before = source.slice(start, end);
  return { file, before, after: before.replace(first, '') + first + '\n' };
}
async function swallowObserver(file, next) {
  const source = await readFile(file, 'utf8'), start = source.indexOf('  async recordObserverFailure('), end = source.indexOf(next, start);
  const before = source.slice(start, end);
  const at = before.lastIndexOf('));');
  // Loom wraps the event write in io(); the independent control awaits change().
  const after = file === store ? before.slice(0, at) + ')).catch(() => {});' + before.slice(at + 3)
    : before.replace('    });', '    }).catch(() => {});');
  return { file, before, after };
}
async function prematureControl() {
  const source = await readFile(cr, 'utf8'), start = source.indexOf('  finally {\n    if (native)'), end = source.indexOf("  requireValue(outcome === 'completed'", start);
  const before = source.slice(start, end), settlement = "  await store.settleSession(id, outcome, new Date().toISOString());";
  return { file: cr, before, after: before.replace(settlement, '').replace('  finally {', `  finally {\n    if (recorded) ${settlement.trim()}`) };
}
async function prematureLoom() {
  const source = await readFile(service, 'utf8');
  const close = '    await nativeCall(() => handle.close());';
  const start = source.indexOf(close), end = source.indexOf('    return await store.getSession(session.id);', start);
  if (start < 0 || end < 0) throw new Error('Settlement boundary missing');
  const before = source.slice(start, end);
  return { file: service, before, after: before.replace(close, '') + close + '\n' };
}
export const mutations = [
  { id: 'M01', apps: all,
    loom: await patch(host, "origin.plugin_id, origin.phase, 'native-hook'", "origin.plugin_id, 'unknown', 'native-hook'"),
    control: await patch(cr, "['session_start', 'session_shutdown', 'tool_execution_end'].includes(error.event) ? error.event : 'unknown'", "'unknown'") },
  { id: 'M02', apps: all,
    loom: await patch(host, "failureClass = 'publication-validation';", "failureClass = 'aspect-execution';"),
    control: await patch(cr, "failureClass = 'publication-validation';", "failureClass = 'aspect-execution';") },
  { id: 'M03', apps: all,
    loom: await patch(host, 'producer_phase: producerPhase, native_runtime_session_id: nativeSessionId,', 'producer_phase: producerPhase,'),
    control: await patch(cr, "producer_phase: plugin.id === s.primary_plugin_id ? 'domain-run' : 'aspect-after-run', native_runtime_session_id: s.runtime_session_id,",
      "producer_phase: plugin.id === s.primary_plugin_id ? 'domain-run' : 'aspect-after-run',") },
  { id: 'M04', apps: all,
    loom: await patch(host, "publications, 'aspect-after-run'", "publications, 'domain-run'"),
    control: await patch(cr, "plugin.id === s.primary_plugin_id ? 'domain-run' : 'aspect-after-run'", "'domain-run'") },
  { id: 'M05', apps: all,
    loom: await patch(host, 'native_runtime_session_id: nativeSessionId,', "native_runtime_session_id: 'native-other',"),
    control: await patch(cr, 'native_runtime_session_id: s.runtime_session_id,', "native_runtime_session_id: 'native-other',") },
  { id: 'M06', apps: ['a', 'c'], owner: 'shared-domain',
    loom: await patch('test/cross-application/pipeline-adapters.mjs', '  assert.equal(sha256(bytes), input.sha256);', '  // Consumer digest revalidation omitted.'),
    control: await patch('test/cross-application/pipeline-adapters.mjs', '  assert.equal(sha256(bytes), input.sha256);', '  // Consumer digest revalidation omitted.') },
  { id: 'M07', apps: ['a', 'c'],
    loom: await moveInitialization(service, '    await nativeCall(() => handle.initialize(structuredClone(prepared.artifacts)));', '    const result = await nativeCall'),
    control: await moveInitialization(cr, '    await primary.initialize(context, plan.artifacts);', '    try { await publish') },
  { id: 'M08', apps: ['a', 'c'],
    loom: await patch(store, 'if (matches.length > 1)', 'if (matches.length > 1 && requirement.artifact_id !== undefined)'),
    control: await patch(cs, "requireValue(matches.length === 1, 'BindingConflict');", "if (r.artifact_id) requireValue(matches.length === 1, 'BindingConflict');") },
  { id: 'M09', apps: ['a', 'c'],
    loom: await patch(store, 'for (const artifact of artifacts) {\n      this.#assertTask(artifact.task_id);', 'for (const artifact of artifacts) {\n      // Persisted Artifact Task membership omitted.'),
    control: await patch(cs, 'id(value.id); requireValue(value.task_id === state.task.id); hash(value.sha256);', 'id(value.id); hash(value.sha256);') },
  { id: 'M10', apps: all,
    loom: await patch(host, "await enqueue(() => aspectFailure(context, pluginId, 'after-run', failureClass, error));\n          continue;",
      "await enqueue(() => aspectFailure(context, pluginId, 'after-run', failureClass, error));\n          outcome = 'failed'; domainError = new Error('Aspect failure'); continue;"),
    control: await patch(cr, "catch { await pending; await observer(plugin.id, 'after-run', failureClass); }", "catch { await pending; await observer(plugin.id, 'after-run', failureClass); outcome = 'failed'; }") },
  { id: 'M11', apps: all,
    loom: await patch(host, "await observe('aspect-completed', context, { plugin_id: pluginId, phase: 'after-run' });",
      "await observe('aspect-completed', context, { plugin_id: pluginId, phase: 'after-run' }); outcome = 'completed';"),
    control: await patch(cr, "await publish(plugin, publications); }", "await publish(plugin, publications); outcome = 'completed'; }") },
  { id: 'M12', apps: all,
    loom: await swallowObserver(store, '  #assertTask('), control: await swallowObserver(cs, '  async settleSession(') },
  { id: 'M13', apps: all,
    loom: await patch(validation, 'if (payload.contract_version !== undefined || payload.phase !== undefined || payload.failure_class !== undefined) {', '{'),
    control: await patch(cs, 'if (p.contract_version !== undefined || p.phase !== undefined || p.failure_class !== undefined) {', '{') },
  { id: 'M14', apps: all,
    loom: await patch(store, '    return artifacts;', "    for (const a of artifacts) if (a.producer_phase === undefined) { a.producer_phase = 'domain-run'; a.native_runtime_session_id = 'native-producer'; }\n    return artifacts;"),
    control: await patch(cs, 'requireValue(JSON.stringify(state.task) === JSON.stringify(this.snapshot)); return state;',
      "requireValue(JSON.stringify(state.task) === JSON.stringify(this.snapshot));\n    for (const a of state.artifacts) if (a.producer_phase === undefined) { a.producer_phase = 'domain-run'; a.native_runtime_session_id = 'native-producer'; }\n    return state;") },
  { id: 'M15', apps: all,
    loom: await prematureLoom(),
    control: await prematureControl() },
  { id: 'M16', apps: all,
    loom: await patch(host, 'const publications = await primary(context).run!(session, domainContext(context));',
      'const publications = await primary(context).run!(session, domainContext(context)); await session.prompt(JSON.stringify(store.task));'),
    control: await patch(cr, 'try { await publish(plugins[0], await primary.run(native, context)); requireValue(!domainFailed); }',
      'try { const publications = await primary.run(native, context); await native.prompt(JSON.stringify(store.task)); await publish(plugins[0], publications); requireValue(!domainFailed); }') },
  { id: 'M17', apps: all,
    loom: await patch('packages/container-core/src/inspection.ts', 'artifacts: artifacts.map((artifact) => ({ ...artifact,',
      'artifacts: artifacts.map(({ producer_phase, native_runtime_session_id, ...artifact }) => ({ ...artifact,'),
    control: await patch(cs, 'artifacts: state.artifacts.map(a => ({ ...a,', 'artifacts: state.artifacts.map(({ producer_phase, native_runtime_session_id, ...a }) => ({ ...a,') },
  { id: 'M18', apps: ['c'], reason: 'Both owners route all A/B/C publications, resolution and inspection through common implementations. No actual C-only migration branch exists; no branch is invented.' },
];
