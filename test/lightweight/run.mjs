import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, open } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { application } from './application.mjs';
import { sha256 } from './handoff.mjs';
import { LocalTaskStore, prepareSession, inspectTask } from '../../packages/container-core/src/index.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
for (let i = 0; i < args.length; i++) {
  if (['--url', '--mode', '--agent-dir'].includes(args[i])) { assert(args[++i] && !args[i].startsWith('--'), 'Missing argument'); }
  else assert(args[i] === '--observer-fault', 'Unknown argument');
}
const mode = option('--mode') ?? 'scripted';
assert(['scripted', 'model'].includes(mode), 'Mode must be scripted or model');
const authSource = resolve(option('--agent-dir') ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'));
const fingerprint = async () => Object.fromEntries(await Promise.all(['settings.json', 'auth.json', 'models.json', 'telemetry.json'].map(async name => {
  const bytes = await readFile(join(authSource, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  return [name, bytes === null ? null : sha256(bytes)];
})));
const before = await fingerprint();
const output = resolve(repo, '.test-tmp', 'lightweight');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, 'run-'));
const store = await LocalTaskStore.create(root, { schema_version: 2, id: 'web-report-test',
  application_id: application.id, application, title: 'Web report native Plugin acceptance', created_at: new Date().toISOString() });
const nativeConfig = join(root, 'pi-config');
await mkdir(nativeConfig);
await mkdir(join(root, 'metrics'));
const observerFault = args.includes('--observer-fault');
let server;
let success = false;
let url = option('--url');
const started = performance.now();
try {
  if (!url) {
    const html = '<!doctype html><html><head><title>Sample Widget</title></head><body><h1>Sample Widget</h1><p>A synthetic local fixture for reusable governance tests.</p><h2>Features</h2><ul><li>Portable</li><li>Offline reports</li><li>Simple setup</li></ul><table><tr><th>Edition</th><th>Units</th></tr><tr><td>Basic</td><td>3</td></tr></table></body></html>';
    server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, 'localhost', done); });
    const fixtureUrl = new URL('http://localhost');
    fixtureUrl.port = String(server.address().port);
    url = fixtureUrl.href;
  }
  const target = new URL(url);
  assert(['http:', 'https:'].includes(target.protocol) && !target.username && !target.password, 'Expected HTTP URL without credentials');
  await writeFile(join(root, 'execution.local.json'), JSON.stringify({ mode, url, auth_source: authSource, observer_fault: observerFault }), { flag: 'wx' });
  const runWorker = async (profile, expected = 0) => {
    const log = await open(join(root, `${profile}.local.log`), 'wx');
    try {
      const code = await new Promise((done, fail) => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url)), profile], {
          cwd: repo, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
          env: { ...process.env, LOOM_TEST_TASK_ROOT: root, PI_CODING_AGENT_DIR: nativeConfig,
            PI_SKIP_VERSION_CHECK: '1', PI_ARTIFACTS_VIEWER: 'none',
            LOOM_TEST_OBSERVER_FAULT: observerFault ? '1' : '0' },
        });
        child.once('error', fail); child.once('close', done);
      });
      assert.equal(code, expected, `Worker ${profile} failed; inspect retained local log`);
    } finally { await log.close(); }
  };
  // Exercise the same real worker entry with missing input. No SDK Session is created.
  await runWorker('report', 1);
  assert.equal((await store.listSessions()).length, 0);
  assert.equal((await store.listConsumptions()).length, 0);
  const missing = JSON.parse((await readFile(join(root, 'report.local.log'), 'utf8')).trim());
  assert.equal(missing.code, 'PreconditionNotSatisfied', 'Wrong missing-input failure');
  // Save the negative-run log under a separate name before the positive invocation.
  const { rename } = await import('node:fs/promises');
  await rename(join(root, 'report.local.log'), join(root, 'missing-input.local.log'));
  await rename(join(root, 'report-failure.local.txt'), join(root, 'missing-input-failure.local.txt'));
  console.log('Missing-input gate passed; starting producer.');
  await runWorker('fetch');
  await prepareSession(await LocalTaskStore.open(root), 'report');
  console.log('Native source published; starting independent consumer.');
  await runWorker('report');
  await runWorker('inspect');
  const reopened = await inspectTask(await LocalTaskStore.open(root));
  assert.equal(reopened.sessions.length, 2);
  assert(reopened.sessions.every(s => s.status === 'completed' && s.runtime_session_id));
  assert.equal(new Set(reopened.sessions.map(s => s.runtime_session_id)).size, 2);
  assert.equal(reopened.artifacts.length, 2);
  assert.equal((await store.listConsumptions()).length, 1);
  const source = reopened.artifacts.find(a => a.type === 'web.source');
  const report = reopened.artifacts.find(a => a.type === 'web.report');
  assert.equal(source.consumers[0].sha256, source.sha256);
  assert.equal(source.consumers[0].session_id, report.producer.session_id);
  assert.equal(sha256(await readFile(join(root, report.payload_ref.path))), report.sha256);
  for (const session of reopened.sessions) {
    assert.deepEqual(session.aspect_plugin_ids, ['run-metrics']);
    assert(session.events.some(e => e.type === 'runtime.pi.started'));
    assert(session.events.some(e => e.type === 'runtime.pi.shutdown'));
    assert.equal(session.events.some(e => e.type === 'runtime.pi.aspect-error'), observerFault);
    assert(!session.events.some(e => e.type === 'runtime.pi.extension-error'));
  }
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(join(root, 'metrics', 'telemetry.db'), { readOnly: true });
  let metrics;
  try {
    metrics = { runs: database.prepare('SELECT COUNT(*) AS n FROM runs').get().n,
      tools: database.prepare('SELECT COUNT(*) AS n FROM tool_calls').get().n,
      tool_names: database.prepare('SELECT DISTINCT tool_name FROM tool_calls').all().map(r => r.tool_name),
      complete_runs: database.prepare('SELECT COUNT(*) AS n FROM runs WHERE ended_at IS NOT NULL AND success = 1').get().n,
      native_tools_ms: database.prepare('SELECT SUM(ended_at - started_at) AS n FROM tool_calls').get().n };
    assert.equal(metrics.runs, 2);
    assert.equal(metrics.complete_runs, 2);
    for (const name of ['http_fetch', 'scaffold_artifact', 'export_artifact']) assert(metrics.tool_names.includes(name));
  } finally { database.close(); }
  assert.deepEqual(await fingerprint(), before, 'Global Pi configuration changed');
  const result = { status: 'passed', mode, model_requests_scripted: mode === 'scripted',
    native_plugins: 3, native_sessions: 2, artifacts: 2, consumptions: 1,
    missing_input_gate: 'passed', observer_fault_isolation: observerFault ? 'passed' : 'not-injected',
    global_pi_config_unchanged: true, elapsed_ms: Math.round(performance.now() - started), metrics,
    report: relative(root, join(root, report.payload_ref.path)).replaceAll('\\', '/') };
  await writeFile(join(root, 'result.local.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, output: relative(repo, root).replaceAll('\\', '/') }, null, 2));
  success = true;
} catch (error) {
  await writeFile(join(root, 'failure.local.txt'), String(error?.stack ?? error));
  console.error(`Lightweight acceptance failed; local diagnostics: ${relative(repo, root).replaceAll('\\', '/')}`);
  process.exitCode = 1;
} finally {
  if (server) await new Promise(done => server.close(done));
  const unchanged = JSON.stringify(await fingerprint()) === JSON.stringify(before);
  if (!unchanged) { console.error('Global Pi configuration fingerprint changed.'); process.exitCode = 1; }
  await writeFile(join(root, 'global-config-check.local.json'), JSON.stringify({ unchanged, completed: success }));
}
