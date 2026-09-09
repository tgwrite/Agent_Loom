import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { sha256 } from '../lightweight/handoff.mjs';
import { readJson } from '../lightweight/native-runtime.mjs';
import { launcher } from '../composite/launcher.mjs';
import { provider } from '../composite/provider.mjs';
import { nativeFingerprints } from '../composite/fingerprints.mjs';
import { freeze, auditFingerprint } from './freeze.mjs';

// Driver invokes public CLI commands, injects faults and inspects evidence.
// It never imports Core or writes a Loom registry, event or Session record.
const repo = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
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
const auditBefore = await auditFingerprint();
const initialFreeze = freeze();
await mkdir(join(repo, '.test-tmp/reuse'), { recursive: true });
const root = await mkdtemp(join(repo, '.test-tmp/reuse/run-'));
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

async function command(arm, operation, task, profile, human = false, expected = 0) {
  const argv = arm === 'loom' ? [join(repo, 'bin/loom.mjs'), ...({
    create: ['task', 'create', '--app', task.app, '--root', task.root, '--name', task.id, '--json'],
    start: ['session', 'start', '--task', task.id, '--profile', profile, '--json'],
    inspect: ['task', 'inspect', task.id, ...(human ? [] : ['--json'])],
  })[operation]] : [join(here, arm === 'control-baseline' ? 'control-baseline.mjs' : 'control.mjs'), operation, task.root, task.id, profile ?? '-', task.app];
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
  assert.equal(output.code, expected, `Command ${calls.length} failed`);
  if (expected) {
    const failure = JSON.parse(output.stderr.split('\n').findLast(line => line.startsWith('{"error":')));
    assert.equal(failure.error.code, 'NativeExecutionFailed');
    return failure;
  }
  return human ? output.stdout : JSON.parse(output.stdout);
}

async function scenario(arm, reversed, kind) {
  freeze();
  const name = `${reversed ? 'reverse' : 'forward'}-${kind}`;
  const retroFault = kind === 'review-failure';
  const domainFault = kind === 'domain-failure';
  const auditFault = kind === 'audit-failure';
  const invalidAudit = kind.startsWith('invalid-') ? kind.slice('invalid-'.length) : undefined;
  const auditRejected = auditFault || !!invalidAudit;
  const baselineGap = arm === 'control-baseline' && domainFault;
  const task = { id: `${arm}-${name}`, root: join(root, `${arm}-${name}`),
    app: join(here, reversed ? 'reversed.application.mjs' : 'application.mjs') };
  const review = await provider(retroFault);
  try {
    await command(arm, 'create', task);
    await writeJson(join(task.root, 'web-input.local.json'), { mode: 'scripted', url: new URL('/' + task.id, fixture).href,
      observer_fault: false, export_fault: domainFault, review_provider: review.baseUrl, launcher_env: launcherEnv,
      audit_fault: auditFault, invalid_audit: invalidAudit });
    await command(arm, 'start', task, 'fetch');
    await command(arm, 'start', task, 'report', false, domainFault ? 1 : 0);
    const snapshot = await command(arm, 'inspect', task);
    await writeJson(join(task.root, 'inspection.local.json'), snapshot);
    assert.equal(snapshot.sessions.length, 2);
    assert(snapshot.sessions.every(s => s.status === (domainFault && s.profile_id === 'report' ? 'failed' : 'completed')));
    assert.equal(new Set(snapshot.sessions.map(s => s.runtime_session_id)).size, 2);
    const expectedArtifacts = baselineGap ? 4 : domainFault ? 7 : retroFault ? 4 : auditRejected ? 6 : 8;
    assert.equal(snapshot.artifacts.length, expectedArtifacts);
    assert.equal(snapshot.sessions.flatMap(s => s.consumed).length, 1);
    const source = snapshot.artifacts.find(a => a.type === 'web.source');
    const report = snapshot.artifacts.find(a => a.type === 'web.report');
    assert.equal(source.consumers[0].session_id, snapshot.sessions.find(s => s.profile_id === 'report').id);
    assert.equal(!!report, !domainFault);
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
      if (artifact.type === 'audit.session-summary') {
        assert.equal(artifact.producer.plugin_id, 'session-audit');
        assert.equal(artifact.verification.status, 'COMPLETED');
        assert.equal(artifact.consumers.length, 0);
        const audit = await readJson(join(task.root, artifact.payload_ref.path));
        assert.equal(audit.native_session_id, session.runtime_session_id);
        assert.equal(audit.reported_outcome, domainFault && session.profile_id === 'report' ? 'failed' : 'completed');
        assert(audit.counts.user >= 1 && audit.counts.assistant >= 1 && audit.counts.tool_results > 0);
      }
    }
    for (const session of snapshot.sessions) {
      assert.deepEqual(session.aspect_plugin_ids, reversed ? ['session-audit', 'conversation-review', 'run-metrics']
        : ['run-metrics', 'conversation-review', 'session-audit']);
      if (baselineGap && session.profile_id === 'report') {
        assert.equal(session.produced.length, 0);
        const observed = await readFile(join(task.root, session.workspace, session.id, 'audit-observation.local.json')).catch(error => {
          if (error.code === 'ENOENT') return null; throw error;
        });
        assert.equal(observed, null, 'The original control unexpectedly ran afterRun on domain failure');
        continue;
      }
      const failures = session.events.filter(e => e.type === 'observer.failed');
      assert.equal(failures.some(e => e.payload.plugin_id === 'run-metrics'), false);
      assert.equal(failures.some(e => e.payload.plugin_id === 'conversation-review'), retroFault);
      assert.equal(failures.some(e => e.payload.plugin_id === 'session-audit'), auditRejected);
      assert.equal(failures.length, Number(retroFault) + Number(auditRejected));
      for (const failure of failures) {
        assert.equal(failure.session_id, session.id);
        assert.equal(failure.task_id, snapshot.task.id);
        assert.equal(failure.payload.failure.source, failure.payload.plugin_id);
        assert(Number.isFinite(Date.parse(failure.timestamp)));
        assert(failure.payload.failure.message.includes('after-run'));
      }
      const isolation = await readJson(join(task.root, session.workspace, session.id, 'isolation.local.json'));
      assert(isolation.passed && isolation.main_requests.length >= 3);
      const order = isolation.actual_load_order.map(path => path.includes('telemetry.mjs') ? 'run-metrics'
        : path.includes('pi-conversation-retro') ? 'conversation-review' : path.includes('session-audit.mjs') ? 'session-audit' : session.primary_plugin_id);
      assert.deepEqual(order, [session.primary_plugin_id, ...session.aspect_plugin_ids]);
      const auditObservation = await readJson(join(task.root, session.workspace, session.id, 'audit-observation.local.json'));
      assert(auditObservation.unchanged);
      assert.equal(auditObservation.outcome, domainFault && session.profile_id === 'report' ? 'failed' : 'completed');
      assert.equal(auditObservation.command_failed, auditFault);
      assert.equal(session.produced.filter(a => a.type === 'audit.session-summary').length, auditRejected ? 0 : 1);
      const auditFiles = await readdir(join(task.root, session.workspace, '.pi-session-audit')).catch(error => {
        if (error.code === 'ENOENT') return []; throw error;
      });
      assert.equal(auditFiles.length, auditFault ? 0 : 1);
      if (arm === 'loom' && !auditRejected) {
        assert.equal(session.plugin_artifact_counts['session-audit']['audit.session-summary'], 1);
        const published = session.events.filter(e => e.type === 'artifact.published');
        assert(published.some(e => e.payload.artifact_id === session.produced.find(a => a.type === 'audit.session-summary').id));
        assert(['session.completed', 'session.failed'].includes(session.events.at(-1).type));
      }
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
    assert.equal(review.requests.length, baselineGap ? 3 : retroFault ? 2 : 6);
    if (!retroFault) assert(allRequests.includes(`INPUT_CANARY_${task.id}`));
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(task.root, 'metrics/telemetry.db'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs WHERE ended_at IS NOT NULL AND success = 1').get().n, baselineGap ? 3 : 4); }
    finally { db.close(); }
    if (arm === 'loom') {
      const human = await command(arm, 'inspect', task, undefined, true);
      assert(human.includes('session-audit'));
      if (auditRejected) assert(human.includes('Aspect failure: session-audit:'));
      else assert(human.includes('Artifacts: session-audit audit.session-summary = 1'));
      if (retroFault) assert(human.includes('Aspect failure: conversation-review:'));
    }
    results.push({ arm, scenario: name, task: task.id, passed: !baselineGap,
      ...(baselineGap ? { gap: 'Original control skips all aspects when domain execution throws' } : {}),
      sessions: 2, artifacts: snapshot.artifacts.length,
      review_requests: review.requests.length, commercial_model_requests: 0 });
  } finally { await writeJson(join(task.root, 'review-requests.local.json'), review.requests); await review.close(); }
}

try {
  for (const arm of smoke ? ['loom'] : ['loom', 'control-baseline']) {
    for (const reversed of smoke ? [false] : [false, true]) {
      for (const kind of smoke ? ['normal'] : ['normal', 'audit-failure', 'invalid-escape', 'invalid-contract', 'invalid-missing', 'review-failure', 'domain-failure']) {
        console.log(`${arm}: ${reversed ? 'reverse' : 'forward'}, ${kind}`);
        await scenario(arm, reversed, kind);
      }
    }
  }
  if (!smoke) for (const reversed of [false, true]) {
    console.log(`control-repaired: ${reversed ? 'reverse' : 'forward'}, domain-failure`);
    await scenario('control-repaired', reversed, 'domain-failure');
  }
  assert.deepEqual(await fingerprints(), before, 'Global Pi configuration changed');
  assert.deepEqual(await codeHashes(), codeBefore, 'Existing adapters changed');
  assert.deepEqual(await nativeFingerprints(), nativeBefore, 'Native package contents changed');
  assert.equal(await auditFingerprint(), auditBefore);
  assert.deepEqual(freeze(), initialFreeze);
  for (const file of ['control.mjs', 'setup.mjs', 'audit-adapter.mjs', 'native/session-audit.mjs']) {
    assert(!/from\s+['"][^'"]*packages\//.test(await readFile(join(here, file), 'utf8')), 'Control imports Loom implementation');
  }
  const oldControl = (await readFile(join(here, '../composite/control.mjs'), 'utf8')).trim().split('\n').length;
  const newControl = (await readFile(join(here, 'control.mjs'), 'utf8')).trim().split('\n').length;
  await writeJson(join(root, 'result.local.json'), { status: 'completed', loom_gates: 'passed', results, freeze: initialFreeze,
    global_pi_config_unchanged: true,
    existing_adapters_unchanged: true, existing_adapter_hashes: codeBefore, native_packages_unchanged: true, native_packages: nativeBefore,
    audit_native_sha256: auditBefore,
    control_lines: { before: oldControl, reuse_governance_delta: 0, after_repair: newControl, lifecycle_repair_delta: newControl - oldControl },
    limitations: ['Deterministic model decisions; review quality untested', 'No compaction/checkpoint validation',
      'No filesystem security sandbox', 'No performance advantage measured', 'Complete v0.1 acceptance pending'] });
  console.log(JSON.stringify({ status: 'completed', loom_gates: 'passed', scenarios: results.length,
    observed_control_gaps: results.filter(r => !r.passed).length, output: relative(repo, root) }));
} catch (error) {
  await writeFile(join(root, 'failure.local.txt'), String(error?.stack ?? error));
  await writeJson(join(root, 'partial.local.json'), results);
  console.error(`Reuse experiment failed; inspect ${relative(repo, root)}`);
  process.exitCode = 1;
} finally {
  await writeJson(join(root, 'commands.local.json'), calls);
  await writeJson(join(root, 'global-config-check.local.json'), { unchanged: JSON.stringify(await fingerprints()) === JSON.stringify(before) });
  server.closeAllConnections(); await new Promise(done => server.close(done));
}
