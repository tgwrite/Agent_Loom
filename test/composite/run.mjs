import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { sha256 } from '../lightweight/handoff.mjs';
import { readJson } from '../lightweight/native-runtime.mjs';
import { launcher, here } from './launcher.mjs';
import { provider } from './provider.mjs';
import { nativeFingerprints } from './fingerprints.mjs';

// Driver invokes public CLI commands, injects faults and inspects evidence.
// It never imports Core or writes a Loom registry, event or Session record.
const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 1 && args[0] === '--smoke');
const smoke = args.length > 0;
const globalDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
const fingerprints = async () => Object.fromEntries(await Promise.all(['settings.json', 'auth.json', 'models.json', 'telemetry.json'].map(async name => {
  const bytes = await readFile(join(globalDir, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  return [name, bytes === null ? null : sha256(bytes)];
})));
const frozen = ['application.mjs', 'host.mjs', 'web-adapters.mjs', 'native-runtime.mjs', 'handoff.mjs', 'telemetry.mjs', 'scripted.mjs'];
const codeHashes = async () => Object.fromEntries(await Promise.all(frozen.map(async file =>
  [file, sha256(await readFile(join(here, '../lightweight', file)))])));
const before = await fingerprints(), codeBefore = await codeHashes();
const nativeBefore = await nativeFingerprints();
await mkdir(join(repo, '.test-tmp/composite'), { recursive: true });
const root = await mkdtemp(join(repo, '.test-tmp/composite/run-'));
const launcherEnv = await launcher(root);
const consoleRoot = join(root, 'operator-console');
await mkdir(consoleRoot);
const nativeHome = join(root, 'native-home');
await mkdir(nativeHome);
// The native exporter uses os.homedir(), not PI_CODING_AGENT_DIR. Scope only the
// child process's Windows profile so it writes inside the disposable experiment.
assert.equal(process.platform, 'win32', 'The composite runner currently validates Windows profile isolation only');
const env = { ...process.env, USERPROFILE: nativeHome, LOOM_STATE_DIR: join(root, 'index'), PI_SKIP_VERSION_CHECK: '1' };
const results = [], calls = [];
const writeJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html><body><h1>Synthetic Widget</h1><p>INPUT_CANARY_${req.url.slice(1)}</p></body></html>`);
});
await new Promise((done, fail) => { server.on('error', fail); server.listen(0, 'localhost', done); });
const fixture = new URL('http://localhost'); fixture.port = String(server.address().port);

async function command(arm, operation, task, profile, human = false) {
  const argv = arm === 'loom' ? [join(repo, 'bin/loom.mjs'), ...({
    create: ['task', 'create', '--app', task.app, '--root', task.root, '--name', task.id, '--json'],
    start: ['session', 'start', '--task', task.id, '--profile', profile, '--json'],
    inspect: ['task', 'inspect', task.id, ...(human ? [] : ['--json'])],
  })[operation]] : [join(here, 'control.mjs'), operation, task.root, task.id, profile ?? '-', task.app];
  const start = performance.now();
  const output = await new Promise((done, fail) => {
    const child = spawn(process.execPath, argv, { cwd: consoleRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('error', error => { clearTimeout(timer); fail(error); });
    child.on('close', code => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
  const call = { arm, operation, task: task.id, profile, elapsed_ms: Math.round(performance.now() - start), ...output };
  calls.push(call);
  await writeJson(join(root, `command-${calls.length}.local.json`), call);
  assert.equal(output.code, 0, `Command ${calls.length} failed`);
  return human ? output.stdout : JSON.parse(output.stdout);
}

async function scenario(arm, reversed, telemetryFault, retroFault) {
  const name = `${reversed ? 'reverse' : 'forward'}-telemetry-${+telemetryFault}-retro-${+retroFault}`;
  const task = { id: `${arm}-${name}`, root: join(root, `${arm}-${name}`),
    app: join(here, reversed ? 'reversed.application.mjs' : 'application.mjs') };
  const review = await provider(retroFault);
  try {
    await command(arm, 'create', task);
    await writeJson(join(task.root, 'web-input.local.json'), { mode: 'scripted', url: new URL('/' + task.id, fixture).href,
      observer_fault: telemetryFault, review_provider: review.baseUrl, launcher_env: launcherEnv });
    for (const profile of ['fetch', 'report']) await command(arm, 'start', task, profile);
    const snapshot = await command(arm, 'inspect', task);
    await writeJson(join(task.root, 'inspection.local.json'), snapshot);
    assert.equal(snapshot.sessions.length, 2);
    assert(snapshot.sessions.every(s => s.status === 'completed' && !s.failure));
    assert.equal(new Set(snapshot.sessions.map(s => s.runtime_session_id)).size, 2);
    assert.equal(snapshot.artifacts.length, retroFault ? 2 : 6);
    assert.equal(snapshot.sessions.flatMap(s => s.consumed).length, 1);
    const source = snapshot.artifacts.find(a => a.type === 'web.source');
    const report = snapshot.artifacts.find(a => a.type === 'web.report');
    assert.equal(source.consumers[0].session_id, report.producer.session_id);
    assert.equal(source.consumers[0].sha256, source.sha256);
    for (const artifact of snapshot.artifacts) {
      assert.equal(artifact.task_id, snapshot.task.id);
      assert.equal(artifact.sha256, sha256(await readFile(join(task.root, artifact.payload_ref.path))));
      const session = snapshot.sessions.find(s => s.id === artifact.producer.session_id);
      assert(session);
      assert.equal(artifact.executor.actor_id, session.actor.id);
      assert.equal(artifact.executor.runtime_id, session.runtime.id);
      if (artifact.type.startsWith('retro.')) {
        assert.equal(artifact.producer.plugin_id, 'conversation-review');
        assert.equal(artifact.consumers.length, 0);
      }
    }
    for (const session of snapshot.sessions) {
      assert.deepEqual(session.aspect_plugin_ids, reversed ? ['conversation-review', 'run-metrics'] : ['run-metrics', 'conversation-review']);
      const failures = session.events.filter(e => e.type === 'observer.failed');
      assert.equal(failures.some(e => e.payload.plugin_id === 'run-metrics'), telemetryFault);
      assert.equal(failures.some(e => e.payload.plugin_id === 'conversation-review'), retroFault);
      for (const failure of failures) {
        assert.equal(failure.session_id, session.id);
        assert.equal(failure.task_id, snapshot.task.id);
        assert.equal(failure.payload.failure.source, failure.payload.plugin_id);
        assert(Number.isFinite(Date.parse(failure.timestamp)));
        assert(failure.payload.failure.message.includes(failure.payload.plugin_id === 'run-metrics' ? 'tool_execution_end' : 'after-run'));
      }
      const isolation = await readJson(join(task.root, session.workspace, session.id, 'isolation.local.json'));
      assert(isolation.passed && isolation.main_requests.length >= 3);
      const order = isolation.actual_load_order.map(path => path.includes('telemetry.mjs') ? 'run-metrics'
        : path.includes('pi-conversation-retro') ? 'conversation-review' : session.primary_plugin_id);
      assert.deepEqual(order, [session.primary_plugin_id, ...session.aspect_plugin_ids]);
      const inputRoot = join(task.root, session.workspace, 'retro-input', session.id, 'sessions');
      assert.equal((await readdir(inputRoot)).length, 1);
      const diagnostics = await readJson(join(inputRoot, '..', 'diagnostics.local.json'));
      assert(diagnostics.some(d => d.message.includes('1 in scope, 1 to analyze, 0 already summarized')));
      if (!retroFault) {
        assert(diagnostics.some(d => d.message.includes('conversation retro complete')));
        const nativeRead = review.requests.filter(r => r.messages.some(m => m.role === 'tool' && m.content.includes(session.runtime_session_id)));
        assert.equal(nativeRead.length, 1, 'Each native reviewer must read exactly its bound Session');
        const other = snapshot.sessions.find(s => s.id !== session.id);
        assert(!JSON.stringify(nativeRead).includes(other.runtime_session_id));
      }
    }
    // Each Task uses a distinct fixture canary; accumulated prior Tasks must not enter review requests.
    const allRequests = JSON.stringify(review.requests);
    for (const previous of results) assert(!allRequests.includes(`INPUT_CANARY_${previous.task}`));
    assert.equal(review.requests.length, retroFault ? 2 : 6);
    if (!retroFault) assert(allRequests.includes(`INPUT_CANARY_${task.id}`));
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(task.root, 'metrics/telemetry.db'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs WHERE ended_at IS NOT NULL AND success = 1').get().n, 4); }
    finally { db.close(); }
    if (arm === 'loom' && (telemetryFault || retroFault)) {
      const human = await command(arm, 'inspect', task, undefined, true);
      if (telemetryFault) assert(human.includes('Aspect failure: run-metrics:'));
      if (retroFault) assert(human.includes('Aspect failure: conversation-review:'));
    }
    results.push({ arm, scenario: name, task: task.id, passed: true, sessions: 2, artifacts: snapshot.artifacts.length,
      review_requests: review.requests.length, commercial_model_requests: 0 });
  } finally { await writeJson(join(task.root, 'review-requests.local.json'), review.requests); await review.close(); }
}

try {
  for (const arm of smoke ? ['loom'] : ['loom', 'control']) {
    for (const reversed of smoke ? [false] : [false, true]) {
      for (const [telemetryFault, retroFault] of smoke ? [[false, false]] : [[false, false], [true, false], [false, true], [true, true]]) {
        console.log(`${arm}: ${reversed ? 'reverse' : 'forward'}, telemetry=${+telemetryFault}, retro=${+retroFault}`);
        await scenario(arm, reversed, telemetryFault, retroFault);
      }
    }
  }
  assert.deepEqual(await fingerprints(), before, 'Global Pi configuration changed');
  assert.deepEqual(await codeHashes(), codeBefore, 'Existing adapters changed');
  assert.deepEqual(await nativeFingerprints(), nativeBefore, 'Native package contents changed');
  for (const file of ['control.mjs', 'setup.mjs', 'retro-adapter.mjs', 'instrumentation.mjs']) {
    assert(!/from\s+['"][^'"]*packages\//.test(await readFile(join(here, file), 'utf8')), 'Control imports Loom implementation');
  }
  const oldControl = (await readFile(join(here, '../lightweight/control.mjs'), 'utf8')).trim().split('\n').length;
  const newControl = (await readFile(join(here, 'control.mjs'), 'utf8')).trim().split('\n').length;
  await writeJson(join(root, 'result.local.json'), { status: 'passed', results, global_pi_config_unchanged: true,
    existing_adapters_unchanged: true, existing_adapter_hashes: codeBefore, native_packages_unchanged: true, native_packages: nativeBefore,
    control_lines: { before: oldControl, after: newControl, delta: newControl - oldControl },
    limitations: ['Deterministic model decisions; review quality untested', 'No compaction/checkpoint validation',
      'No filesystem security sandbox', 'No performance advantage measured', 'Complete v0.1 acceptance pending'] });
  console.log(JSON.stringify({ status: 'passed', scenarios: results.length, output: relative(repo, root) }));
} catch (error) {
  await writeFile(join(root, 'failure.local.txt'), String(error?.stack ?? error));
  await writeJson(join(root, 'partial.local.json'), results);
  console.error(`Composite experiment failed; inspect ${relative(repo, root)}`);
  process.exitCode = 1;
} finally {
  await writeJson(join(root, 'commands.local.json'), calls);
  await writeJson(join(root, 'global-config-check.local.json'), { unchanged: JSON.stringify(await fingerprints()) === JSON.stringify(before) });
  server.closeAllConnections(); await new Promise(done => server.close(done));
}
