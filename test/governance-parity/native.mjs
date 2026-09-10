import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { sha256 } from '../lightweight/handoff.mjs';
import { readJson } from '../lightweight/native-runtime.mjs';
import { launcher } from '../composite/launcher.mjs';
import { provider } from '../composite/provider.mjs';
import { nativeFingerprints } from '../composite/fingerprints.mjs';
import { repo, freeze, integrationHashes, marketHashes } from '../cross-application/freeze.mjs';

// Public CLI driver and evidence assertions only. It never writes governance.
const args = process.argv.slice(2);
const requestedPhase = args.find(a => a.startsWith('--phase='))?.split('=')[1] ?? 'verify';
const verify = requestedPhase === 'verify';
const phase = verify ? 'm2' : requestedPhase;
const smoke = args.includes('--smoke');
assert(['a', 'm1', 'm2'].includes(phase));
assert(args.every(a => a === '--smoke' || a === `--phase=${requestedPhase}`));
assert.equal(process.platform, 'win32', 'This optional native experiment validates Windows profile isolation');
const outputBase = join(repo, '.test-tmp/governance-parity/native');
await mkdir(outputBase, { recursive: true });
const initialFreeze = freeze(phase), integrations = await integrationHashes();
if (phase !== 'a' && !verify) {
  const previous = await readJson(join(outputBase, `checkpoint-${phase === 'm1' ? 'a' : 'm1'}.local.json`));
  assert.equal(previous.status, 'passed', 'Previous phase must pass before migration');
  assert.deepEqual(integrations, previous.integrations, 'Business integration changed during semantic migration');
}
const root = await mkdtemp(join(outputBase, `${requestedPhase}-`));
const globalDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
async function globalHashes() {
  return Object.fromEntries(await Promise.all(['settings.json', 'auth.json', 'models.json', 'telemetry.json'].map(async name => {
    const bytes = await readFile(join(globalDir, name)).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    return [name, bytes === null ? null : sha256(bytes)];
  })));
}
const before = { global: await globalHashes(), prior: await nativeFingerprints(), market: await marketHashes() };
const launcherEnv = await launcher(root);
const nativeHome = join(root, 'native-home'), consoleRoot = join(root, 'console');
await mkdir(nativeHome); await mkdir(consoleRoot);
const pandoc = process.env.PANDOC_PATH;
assert(pandoc, 'Set PANDOC_PATH to a real local Pandoc binary; no fake exporter is permitted');
const env = { ...process.env, USERPROFILE: nativeHome, LOOM_STATE_DIR: join(root, 'index'), PI_SKIP_VERSION_CHECK: '1' };
const calls = [], results = [];
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<html><head><title>Synthetic Source</title></head><body><article><h1>Synthetic Source</h1><p>INPUT_CANARY_${req.url.slice(1)}</p><h2>Status</h2><p>Pending review.</p></article></body></html>`);
});
await new Promise((done, fail) => { server.on('error', fail); server.listen(0, 'localhost', done); });
const baseUrl = new URL('http://localhost'); baseUrl.port = String(server.address().port);
const apps = {
  a: { file: 'test/reuse/application.mjs', profiles: ['fetch', 'report'], domainTypes: ['web.source', 'web.report'] },
  b: { file: 'test/cross-application/local.application.mjs', profiles: ['transform'], domainTypes: ['local.result'] },
  c: { file: 'test/cross-application/pipeline.application.mjs', profiles: ['capture', 'normalize', 'publish'],
    domainTypes: ['source.snapshot', 'normalized.data', 'final.output'] },
};
async function command(arm, operation, task, profile, expected = 0, human = false) {
  const argv = arm === 'loom' ? [join(repo, 'bin/loom.mjs'), ...({
    create: ['task', 'create', '--app', task.app, '--root', task.root, '--name', task.id, '--host-module', join(repo, 'test/governance-parity/native-host.mjs'), '--json'],
    start: ['session', 'start', '--task', task.id, '--profile', profile, '--json'],
    inspect: ['task', 'inspect', task.id, ...(human ? [] : ['--json'])],
  })[operation]] : [join(repo, 'test/governance-parity/control/cli.mjs'), operation, task.root, task.id, profile ?? '-', task.app];
  let barrierError, inspecting = false;
  if (operation === 'start' && task.delayed) for (const file of ['barrier-entered.local.json', 'barrier-release.local.json']) await rm(join(task.root, file), { force: true });
  const monitor = operation === 'start' && task.delayed ? setInterval(async () => {
    if (inspecting) return;
    try { await readFile(join(task.root, 'barrier-entered.local.json')); } catch { return; }
    inspecting = true;
    try { const snapshot = await command(arm, 'inspect', task); assert(snapshot.sessions.some(s => s.status === 'running')); }
    catch (error) { barrierError = error; }
    finally { await writeJson(join(task.root, 'barrier-release.local.json'), { released: true }); }
  }, 10) : undefined;
  const output = await new Promise((done, fail) => {
    const child = spawn(process.execPath, argv, { cwd: consoleRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('error', e => { clearTimeout(timer); fail(e); });
    child.on('close', code => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
  if (monitor) clearInterval(monitor); if (barrierError) throw barrierError; if (operation === 'start' && task.delayed) assert(inspecting, 'Settlement barrier not reached');
  calls.push({ arm, operation, profile, task: task.id, ...output });
  await writeJson(join(root, `command-${calls.length}.local.json`), calls.at(-1));
  assert.equal(output.code, expected, `Command ${calls.length}: ${arm}/${task.id}/${profile ?? operation}`);
  if (expected) {
    const error = JSON.parse(output.stderr.split('\n').findLast(line => line.startsWith('{"error":')));
    assert.equal(error.error.code, 'NativeExecutionFailed'); return error;
  }
  return human ? output.stdout : JSON.parse(output.stdout);
}

async function scenario(arm, appKey, kind) {
  freeze(phase);
  const app = apps[appKey], count = app.profiles.length;
  const task = { id: `${arm}-${appKey}-${kind}`, root: join(root, `${arm}-${appKey}-${kind}`), delayed: kind === 'delayed-write', app: join(repo, app.file) };
  const review = await provider(false);
  const domainFailure = kind === 'domain-failure', hookFailure = ['native-hook', 'two-aspects'].includes(kind);
  const rejectedAudit = ['after-run', 'invalid-publication', 'two-aspects'].includes(kind);
  try {
    await command(arm, 'create', task);
    await writeJson(join(task.root, 'web-input.local.json'), { app_key: appKey, mode: 'scripted',
      url: new URL('/' + task.id, baseUrl).href, observer_fault: hookFailure, export_fault: domainFailure,
      governance_delay: task.delayed, audit_fault: ['after-run', 'two-aspects'].includes(kind), invalid_audit: kind === 'invalid-publication' ? 'contract' : undefined,
      review_provider: review.baseUrl, launcher_env: launcherEnv });
    await writeJson(join(task.root, 'fixture.json'), { items: [{ name: 'sample', value: 7 }, { name: 'extra', value: 11 }] });
    for (const profile of app.profiles)
      await command(arm, 'start', task, profile, domainFailure && profile === app.profiles.at(-1) ? 1 : 0);
    const snapshot = await command(arm, 'inspect', task);
    const actualRequests = await readFile(join(task.root, 'external-provider-requests.local.jsonl'), 'utf8');
    assert(actualRequests.trim().length); assert(!actualRequests.includes('RETRO_PRIVATE_CANARY')); assert(!actualRequests.includes('strict postmortem reviewer'));
    await writeJson(join(task.root, 'inspection.local.json'), snapshot);
    assert.equal(snapshot.sessions.length, count);
    assert.equal(new Set(snapshot.sessions.map(s => s.runtime_session_id)).size, count);
    assert.equal(snapshot.artifacts.length, count * (rejectedAudit ? 3 : 4) - Number(domainFailure));
    assert.equal(snapshot.sessions.flatMap(s => s.consumed).length, count - 1);
    for (const session of snapshot.sessions) {
      const failedDomain = domainFailure && session.profile_id === app.profiles.at(-1);
      assert.equal(session.status, failedDomain ? 'failed' : 'completed');
      assert.deepEqual(session.aspect_plugin_ids, ['run-metrics', 'conversation-review', 'session-audit']);
      const failures = session.events.filter(e => e.type === 'observer.failed');
      assert.equal(failures.some(e => e.payload.plugin_id === 'run-metrics'), hookFailure);
      assert.equal(failures.some(e => e.payload.plugin_id === 'session-audit'), rejectedAudit);
      assert(!failures.some(e => e.payload.plugin_id === 'conversation-review'));
      for (const event of failures) {
        assert.equal(event.task_id, snapshot.task.id); assert.equal(event.session_id, session.id);
        assert.equal(event.payload.failure.source, event.payload.plugin_id);
        assert(Number.isFinite(Date.parse(event.payload.failure.timestamp)));
        if (phase !== 'a') {
          assert.equal(event.payload.phase, event.payload.plugin_id === 'run-metrics' ? 'tool_execution_end' : 'after-run');
          assert.equal(event.payload.failure_class, event.payload.plugin_id === 'run-metrics' ? 'native-hook'
            : kind === 'invalid-publication' ? 'publication-validation' : 'aspect-execution');
        }
      }
      const observation = await readJson(join(task.root, session.workspace, session.id, 'audit-observation.local.json'));
      assert(observation.unchanged); assert.equal(observation.outcome, failedDomain ? 'failed' : 'completed');
      const isolation = await readJson(join(task.root, session.workspace, session.id, 'isolation.local.json'));
      assert(isolation.passed && isolation.history_unchanged && isolation.tools_unchanged && isolation.system_unchanged);
      assert.equal(isolation.actual_load_order.length, 4);
      const audit = snapshot.artifacts.find(a => a.producer.session_id === session.id && a.type === 'audit.session-summary');
      assert.equal(Boolean(audit), !rejectedAudit);
      if (audit) {
        const data = await readJson(join(task.root, audit.payload_ref.path));
        assert.equal(data.native_session_id, session.runtime_session_id);
        assert.equal(data.reported_outcome, session.status);
      }
      assert.equal(session.events.at(-1).type, `session.${session.status}`);
      for (const consumption of session.consumed) {
        const artifact = snapshot.artifacts.find(a => a.id === consumption.artifact_id);
        assert(artifact); assert.equal(consumption.sha256, artifact.sha256);
        assert.notEqual(artifact.producer.session_id, session.id);
      }
    }
    for (const artifact of snapshot.artifacts) {
      const session = snapshot.sessions.find(s => s.id === artifact.producer.session_id);
      assert(session); assert.equal(artifact.task_id, snapshot.task.id);
      assert.equal(artifact.sha256, sha256(await readFile(join(task.root, artifact.payload_ref.path))));
      assert.equal(artifact.executor.actor_id, session.actor.id); assert.equal(artifact.executor.runtime_id, session.runtime.id);
      if (phase === 'm2') {
        assert.equal(artifact.producer_phase, artifact.producer.plugin_id === session.primary_plugin_id ? 'domain-run' : 'aspect-after-run');
        assert.equal(artifact.native_runtime_session_id, session.runtime_session_id);
      }
    }
    assert.equal(review.requests.length, 3 * count);
    for (const previous of results) assert(!JSON.stringify(review.requests).includes(`INPUT_CANARY_${previous.task}`));
    if (arm === 'loom' && phase !== 'a' && (kind !== 'normal' || phase === 'm2')) {
      const human = await command(arm, 'inspect', task, undefined, 0, true);
      if (failuresPresent(kind)) assert(human.includes(kind === 'native-hook' ? 'native-hook' : kind === 'after-run' ? 'aspect-execution' : 'publication-validation'));
      if (phase === 'm2') {
        assert(human.includes('Native provenance: aspect-after-run'));
        if (!domainFailure || count > 1) assert(human.includes('Native provenance: domain-run'));
      }
    }
    results.push({ arm, application: appKey, scenario: kind, task: task.id, passed: true, sessions: count,
      artifacts: snapshot.artifacts.length, review_requests: review.requests.length, actual_llm_requests: 0 });
  } finally { await writeJson(join(task.root, 'review-requests.local.json'), review.requests); await review.close(); }
}
const failuresPresent = kind => ['native-hook', 'after-run', 'invalid-publication'].includes(kind);
try {
  for (const arm of process.env.PARITY_ARM ? [process.env.PARITY_ARM] : smoke ? ['loom'] : ['loom', 'control'])
    for (const app of process.env.PARITY_APP ? [process.env.PARITY_APP] : ['a', 'b', 'c'])
    for (const kind of process.env.PARITY_SCENARIO ? [process.env.PARITY_SCENARIO] : phase === 'a' || smoke ? ['normal']
      : ['normal', 'native-hook', 'after-run', 'invalid-publication', 'two-aspects', 'domain-failure', 'delayed-write']) {
      console.log(`${phase}: ${arm}/${app}/${kind}`); await scenario(arm, app, kind);
    }
  assert.deepEqual(await globalHashes(), before.global);
  assert.deepEqual(await nativeFingerprints(), before.prior);
  assert.deepEqual(await marketHashes(), before.market);
  assert.deepEqual(await integrationHashes(), integrations);
  freeze(phase);
  const result = { status: 'passed', phase: requestedPhase, smoke, results, freeze: initialFreeze, integrations, native_packages: before,
    global_pi_config_unchanged: true, native_packages_unchanged: true, commands: calls.length };
  await writeJson(join(root, 'result.local.json'), result);
  if (!smoke && !verify) await writeJson(join(outputBase, `checkpoint-${phase}.local.json`), { ...result, output: relative(repo, root) });
  console.log(JSON.stringify({ status: 'passed', phase: requestedPhase, cases: results.length, output: relative(repo, root) }));
} catch (error) {
  await writeFile(join(root, 'failure.local.txt'), String(error?.stack ?? error));
  await writeJson(join(root, 'partial.local.json'), results);
  console.error(`Cross-Application experiment failed: ${relative(repo, root)}`); process.exitCode = 1;
} finally {
  await writeJson(join(root, 'commands.local.json'), calls);
  server.closeAllConnections(); await new Promise(done => server.close(done));
}
