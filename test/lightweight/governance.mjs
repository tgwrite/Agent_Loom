import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { sha256 } from './handoff.mjs';

// Test controller: only public CLI operations, fault injection and assertions.
// It never opens a Loom store or writes governance state.
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--live-url'), 'Expected optional --live-url');
const liveUrl = args[1];
const authSource = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const jsonWrite = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const fingerprints = async () => Object.fromEntries(await Promise.all(['settings.json', 'auth.json', 'models.json', 'telemetry.json'].map(async name => {
  const bytes = await readFile(join(authSource, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  return [name, bytes === null ? null : sha256(bytes)];
})));
const before = await fingerprints();
const adapterFiles = ['web-adapters.mjs', 'native-runtime.mjs', 'handoff.mjs', 'application.mjs', 'host.mjs'];
const adapterHashes = async () => Object.fromEntries(await Promise.all(adapterFiles.map(async name => [name, sha256(await readFile(join(here, name)))])));
const codeBefore = await adapterHashes();
await mkdir(join(repo, '.test-tmp', 'governance'), { recursive: true });
const root = await mkdtemp(join(repo, '.test-tmp', 'governance', 'run-'));
const consoleRoot = join(root, 'operator-console');
await mkdir(consoleRoot);
const env = { ...process.env, LOOM_STATE_DIR: join(root, 'loom-index'), PI_SKIP_VERSION_CHECK: '1' };
const calls = [];
const results = [];
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><title>Sample Widget</title></head><body><h1>${req.url === '/second' ? 'Second Widget' : 'Sample Widget'}</h1><p>Synthetic input for governance acceptance.</p><ul><li>Portable</li><li>Offline reports</li><li>Simple setup</li></ul></body></html>`);
});
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, 'localhost', done); });
const fixture = new URL('http://localhost');
fixture.port = String(server.address().port);

async function command(arm, operation, task, profile, expected = 0) {
  let argv;
  if (arm === 'loom') {
    argv = [join(repo, 'bin/loom.mjs'), ...({
      validate: ['app', 'validate', task.app, '--json'],
      create: ['task', 'create', '--app', task.app, '--root', task.root, '--name', task.id, '--json'],
      start: ['session', 'start', '--task', task.id, '--profile', profile, '--json'],
      inspect: ['task', 'inspect', task.id, '--json'],
    })[operation]];
  } else argv = [join(here, 'control.mjs'), operation, task.root, task.id, profile ?? '-', task.app];
  const start = performance.now();
  const result = await new Promise((done, fail) => {
    const child = spawn(process.execPath, argv, { cwd: consoleRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => child.kill(), 240000);
    child.once('error', error => { clearTimeout(timer); fail(error); });
    child.once('close', code => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
  const n = calls.length;
  calls.push({ arm, operation, task: task.id, profile, argv, cwd: consoleRoot,
    code: result.code, elapsed_ms: Math.round(performance.now() - start) });
  await jsonWrite(join(root, `command-${n}.local.json`), { ...calls[n], ...result });
  assert.equal(result.code, expected, `${arm}/${task.id}/${operation}: inspect command-${n}.local.json`);
  if (!expected) return JSON.parse(result.stdout);
  const line = result.stderr.split('\n').findLast(line => line.startsWith('{"error":'));
  assert(line, `No structured failure in command-${n}`);
  return JSON.parse(line);
}

async function create(arm, name, options = {}) {
  const task = { id: `${arm}-${name}`, root: join(root, `${arm}-${name}`),
    app: join(here, options.alternate ? 'alternate.application.mjs' : 'application.mjs') };
  await command(arm, 'create', task);
  const url = options.url ?? fixture.href;
  await jsonWrite(join(task.root, 'web-input.local.json'), { mode: options.mode ?? 'scripted', url,
    auth_source: authSource, observer_fault: !!options.observer, export_fault: !!options.exportFault });
  return task;
}
const inspect = async (arm, task) => {
  const snapshot = await command(arm, 'inspect', task);
  await jsonWrite(join(task.root, 'inspection.local.json'), snapshot);
  return snapshot;
};
const consumers = snapshot => snapshot.sessions.flatMap(s => s.consumed);
async function nativeEvents(task, session) {
  const path = join(task.root, session.workspace, session.id, 'native-events.local.jsonl');
  const text = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : [];
}
async function happy(arm, name, options = {}) {
  const task = await create(arm, name, options);
  await command(arm, 'start', task, options.alternate ? 'capture' : 'fetch');
  // command() awaits process close: no producer process or in-memory state is reused.
  await command(arm, 'start', task, options.alternate ? 'publish' : 'report');
  const snapshot = await inspect(arm, task);
  assert.equal(snapshot.sessions.length, 2);
  assert(snapshot.sessions.every(s => s.status === 'completed'));
  assert.equal(new Set(snapshot.sessions.map(s => s.runtime_session_id)).size, 2);
  assert.equal(snapshot.artifacts.length, 2);
  assert.equal(consumers(snapshot).length, 1);
  const source = snapshot.artifacts.find(a => a.type === 'web.source');
  const report = snapshot.artifacts.find(a => a.type === 'web.report');
  assert.equal(source.consumers[0].session_id, report.producer.session_id);
  assert.equal(source.consumers[0].sha256, source.sha256);
  assert.equal(consumers(snapshot)[0].producer.session_id, source.producer.session_id);
  assert.equal(sha256(await readFile(join(task.root, report.payload_ref.path))), report.sha256);
  const delivery = await readJson(join(task.root, report.payload_ref.path, '..', 'delivery.json'));
  assert.equal(delivery.source_artifact_id, source.id);
  assert.equal(delivery.source_sha256, source.sha256);
  assert.equal(delivery.native_export_sha256, report.sha256);
  for (const s of snapshot.sessions) {
    assert.deepEqual(s.aspect_plugin_ids, ['run-metrics']);
    assert(s.events.some(e => e.type === 'runtime.pi.started'));
    assert(s.events.some(e => e.type === 'runtime.pi.shutdown'));
    assert.equal(s.events.some(e => e.type === 'runtime.pi.aspect-error'), !!options.observer);
    assert(!s.events.some(e => e.type === 'runtime.pi.extension-error'));
    if (options.mode === 'model') {
      const loaded = await readJson(join(task.root, s.workspace, s.id, 'loaded.local.json'));
      const defaults = await readJson(join(authSource, 'settings.json'));
      assert.equal(loaded.model.provider, defaults.defaultProvider);
      assert.equal(loaded.model.id, defaults.defaultModel);
    }
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(task.root, 'metrics', 'telemetry.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs WHERE ended_at IS NOT NULL AND success = 1').get().n, 2);
  } finally { db.close(); }
  results.push({ arm, scenario: name, passed: true, task: task.id,
    report: relative(root, join(task.root, report.payload_ref.path)).replaceAll('\\', '/') });
  return task;
}

try {
  await command('loom', 'validate', { app: join(here, 'application.mjs'), id: 'preflight' });
  for (const arm of ['loom', 'control']) {
    console.log(`${arm}: cross-process handoff and reuse`);
    await happy(arm, 'normal');
    await happy(arm, 'second-task', { url: new URL('/second', fixture).href });
    await happy(arm, 'second-app', { alternate: true });
    await happy(arm, 'observer-fault', { observer: true });
    console.log(`${arm}: missing, ambiguous, altered and isolated inputs; export failure`);
    const empty = await create(arm, 'missing');
    assert.equal((await command(arm, 'start', empty, 'report', 1)).error.code, 'PreconditionNotSatisfied');
    let snap = await inspect(arm, empty);
    assert.equal(snap.sessions.length, 0);
    assert.equal(consumers(snap).length, 0);
    results.push({ arm, scenario: 'missing', passed: true });
    // Other completed Tasks exist; the empty Task must not borrow their inputs.
    assert.equal((await command(arm, 'start', empty, 'report', 1)).error.code, 'PreconditionNotSatisfied');
    assert.equal((await inspect(arm, empty)).sessions.length, 0);
    results.push({ arm, scenario: 'task-isolation', passed: true });
    const ambiguous = await create(arm, 'ambiguous');
    await command(arm, 'start', ambiguous, 'fetch');
    await command(arm, 'start', ambiguous, 'fetch');
    assert.equal((await command(arm, 'start', ambiguous, 'report', 1)).error.code, 'BindingConflict');
    snap = await inspect(arm, ambiguous);
    assert.equal(snap.sessions.length, 2);
    assert.equal(snap.artifacts.length, 2);
    assert.equal(consumers(snap).length, 0);
    results.push({ arm, scenario: 'ambiguous', passed: true });
    const altered = await create(arm, 'altered');
    await command(arm, 'start', altered, 'fetch');
    snap = await inspect(arm, altered);
    const handoff = await readJson(join(altered.root, snap.artifacts[0].payload_ref.path));
    await writeFile(join(altered.root, handoff.markdown.path), 'Controlled snapshot alteration.');
    assert.equal((await command(arm, 'start', altered, 'report', 1)).error.code, 'NativeExecutionFailed');
    snap = await inspect(arm, altered);
    assert.equal(snap.sessions.length, 2);
    const alteredConsumer = snap.sessions.find(s => s.profile_id === 'report');
    assert.equal(alteredConsumer.status, 'failed');
    assert.equal(consumers(snap).length, 0);
    assert.equal((await nativeEvents(altered, alteredConsumer)).length, 0);
    if (arm === 'loom') assert(alteredConsumer.events.some(e => e.type === 'runtime.pi.initialization-rejected'));
    results.push({ arm, scenario: 'altered', passed: true });
    const failed = await create(arm, 'export-failure', { exportFault: true });
    await command(arm, 'start', failed, 'fetch');
    assert.equal((await command(arm, 'start', failed, 'report', 1)).error.code, 'NativeExecutionFailed');
    snap = await inspect(arm, failed);
    assert.equal(snap.artifacts.length, 1);
    const failedConsumer = snap.sessions.find(s => s.profile_id === 'report');
    assert.equal(failedConsumer.status, 'failed');
    assert.equal(consumers(snap).length, 1);
    if (arm === 'loom') assert(failedConsumer.events.some(e => e.type === 'runtime.pi.execution-rejected'));
    const events = await nativeEvents(failed, failedConsumer);
    assert(events.some(e => e.type === 'tool_execution_end' && e.toolName === 'export_artifact'
      && (e.isError || e.result?.isError || e.result?.details?.ok === false)));
    results.push({ arm, scenario: 'export-failure', passed: true });
  }
  if (liveUrl) {
    console.log('loom: current default model with the supplied live page');
    await happy('loom', 'live-model', { mode: 'model', url: liveUrl });
  }
  assert.deepEqual(await adapterHashes(), codeBefore, 'Adapter code changed between Tasks');
  assert.deepEqual(await fingerprints(), before, 'Global Pi configuration changed');
  const controlSource = await readFile(join(here, 'control.mjs'), 'utf8');
  for (const name of ['control.mjs', 'web-adapters.mjs', 'native-runtime.mjs', 'handoff.mjs', 'scripted.mjs', 'telemetry.mjs', 'application.mjs']) {
    assert(!/from\s+['"][^'"]*packages\//.test(await readFile(join(here, name), 'utf8')), 'Control imports Loom implementation');
  }
  const summary = { status: 'passed', results, global_pi_config_unchanged: true, adapters_unchanged: true,
    control_implementation_lines: controlSource.trim().split('\n').length,
    findings: { report_possible_without_loom: true, control_automates_same_checked_guarantees: true,
      per_task_governance_code_edits: { loom: 0, control: 0 }, manual_handoff_path_transfers: { loom: 0, control: 0 },
      loom_owns_shared_governance: true, control_owns_custom_governance: true,
      interactive_pi_acceptance: 'not-tested', complete_v01_acceptance: false,
      performance_claim: 'none; command timings are diagnostic, not a paired benchmark' } };
  await jsonWrite(join(root, 'result.local.json'), summary);
  await jsonWrite(join(root, 'commands.local.json'), calls);
  console.log(JSON.stringify({ status: summary.status, scenarios: results.length,
    output: relative(repo, root).replaceAll('\\', '/'), findings: summary.findings }, null, 2));
} catch (error) {
  await jsonWrite(join(root, 'commands.local.json'), calls);
  await jsonWrite(join(root, 'partial.local.json'), results);
  await writeFile(join(root, 'failure.local.txt'), String(error?.stack ?? error));
  console.error(`Governance experiment failed; inspect ${relative(repo, root).replaceAll('\\', '/')}`);
  process.exitCode = 1;
} finally {
  await new Promise(done => server.close(done));
  const unchanged = JSON.stringify(await fingerprints()) === JSON.stringify(before);
  await jsonWrite(join(root, 'global-config-check.local.json'), { unchanged });
  if (!unchanged) process.exitCode = 1;
}
