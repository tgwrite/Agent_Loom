import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LocalTaskStore, inspectTask } from '../dist/packages/container-core/src/index.js';

/** Synthetic governance history only. No Plugins, network calls or domain quality claims. */
export async function historyFixture(count) {
  const root = await mkdtemp(join(tmpdir(), 'loom-history-'));
  const application = { id: 'synthetic', version: '1', runtime: { id: 'synthetic', version: '1' },
    plugins: [{ id: 'domain', role: 'domain', native: { runtime: 'synthetic', binding_key: 'domain' },
      capabilities: [], produces: [{ type: 'sample', version: '1' }] }],
    profiles: [{ id: 'run', primary: 'domain', aspects: [], requirements: [] }] };
  const stamp = '2026-01-01T00:00:00.000Z';
  const store = await LocalTaskStore.create(root, { schema_version: 2, id: 'task', application_id: application.id,
    application, title: 'Synthetic history', created_at: stamp });
  const artifacts = [], consumptions = [];
  try {
    for (let i = 0; i < count; i++) {
      const id = `session-${i}`;
      const directory = join(root, '.agent-loom', 'sessions', id);
      await mkdir(directory);
      const session = { id, task_id: 'task', profile_id: 'run', workspace: '.', primary_plugin_id: 'domain',
        aspect_plugin_ids: [], plugin_ids: ['domain'], actor: { id: 'actor' },
        runtime: { id: 'synthetic', name: 'synthetic', version: '1' }, status: 'completed', started_at: stamp, finished_at: stamp };
      const event = type => ({ id: `${id}-${type}`, type: `session.${type}`, timestamp: stamp,
        task_id: 'task', session_id: id, actor_id: 'actor', source: 'container-core', correlation_id: id, payload: {} });
      await writeFile(join(directory, 'session.json'), JSON.stringify(session));
      await writeFile(join(directory, 'events.jsonl'), [event('started'), event('completed')].map(item => JSON.stringify(item) + '\n').join(''));
      artifacts.push({ id: `artifact-${i}`, task_id: 'task', type: 'sample', version: '1',
        producer: { session_id: id, plugin_id: 'domain', capability_id: 'publish' }, executor: { actor_id: 'actor', runtime_id: 'synthetic' },
        verification: { status: 'READY' }, payload_ref: { kind: 'file', path: 'synthetic.json' }, sha256: 'a'.repeat(64), created_at: stamp });
      consumptions.push({ id: `consumption-${i}`, task_id: 'task', session_id: id, consumer_plugin_id: 'domain',
        artifact_id: `artifact-${i}`, sha256: 'a'.repeat(64), consumed_at: stamp });
    }
    for (const [name, records] of [['artifacts', artifacts], ['consumptions', consumptions]])
      await writeFile(join(root, '.agent-loom', `${name}.jsonl`), records.map(item => JSON.stringify(item) + '\n').join(''));
    return { store, cleanup: () => rm(root, { recursive: true, force: true }) };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

export async function measureHistory(count) {
  const fixture = await historyFixture(count);
  try {
    const get = fixture.store.getSession.bind(fixture.store);
    let reads = 0;
    fixture.store.getSession = (...args) => { reads++; return get(...args); };
    const started = performance.now();
    const snapshot = await inspectTask(fixture.store);
    return { sessions: snapshot.sessions.length, artifacts: snapshot.artifacts.length,
      session_record_reads: reads, elapsed_ms: Math.round(performance.now() - started) };
  } finally { await fixture.cleanup(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  for (const count of [100, 500]) console.log(JSON.stringify(await measureHistory(count)));
