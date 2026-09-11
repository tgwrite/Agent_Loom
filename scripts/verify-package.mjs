// Install the candidate outside the checkout using independent prefixes and an empty npm cache.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, relative, delimiter } from 'node:path';
import { createHash } from 'node:crypto';

const repo = resolve(import.meta.dirname, '..'), archive = resolve(process.argv[2]);
assert(process.env.npm_execpath, 'Use npm run package:verify -- <candidate.tgz>.');
const root = await mkdtemp(join(tmpdir(), 'loom installed package '));
const project = join(root, 'consumer project'), prefix = join(root, 'global prefix'), unrelated = join(root, 'operator');
for (const directory of [project, prefix, unrelated]) await mkdir(directory);
const config = join(root, 'empty.npmrc'); await writeFile(config, '');
const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_cache: join(root, 'empty-cache'),
  npm_config_userconfig: config, npm_config_globalconfig: join(root, 'global.npmrc'),
  LOOM_STATE_DIR: join(root, 'index') };
await writeFile(env.npm_config_globalconfig, '');
const logs = [];
function run(executable, args, cwd = project, expected = 0, overrides = {}) {
  const r = spawnSync(executable, args, { cwd, env: { ...env, ...overrides }, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  logs.push({ args, cwd, status: r.status, stdout: r.stdout, stderr: r.stderr });
  assert.equal(r.status, expected, r.stderr || r.stdout || r.error?.message); return r.stdout;
}
const npm = (args, cwd = project) => run(process.execPath, [process.env.npm_execpath, ...args], cwd);
await copyFile(archive, join(project, basename(archive)));
await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'synthetic-package-consumer', private: true,
  type: 'module', scripts: { loom: 'loom' } }));
const install = ['install', './' + basename(archive), '--offline', '--ignore-scripts', '--no-audit', '--no-fund'];
let passed = false;
try {
  npm(install);
  npm([...install, '--global', '--prefix', prefix]);
  const installed = join(project, 'node_modules/agent-loom');
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.version, JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version);
  assert(!manifest.workspaces && !manifest.scripts && !manifest.dependencies && !manifest.devDependencies);
  const commandDir = process.platform === 'win32' ? prefix : join(prefix, 'bin');
  const commandEnv = { PATH: commandDir + delimiter + process.env.PATH };
  const version = process.platform === 'win32'
    ? run(process.env.ComSpec, ['/d', '/s', '/c', 'loom --version'], unrelated, 0, commandEnv)
    : run(join(commandDir, 'loom'), ['--version'], unrelated, 0, commandEnv);
  assert.equal(version.trim(), manifest.version);
  assert(npm(['run', 'loom', '--', '--version']).includes(manifest.version));
  const cli = join(installed, 'bin/loom.mjs');
  assert(run(process.execPath, [cli, '--help'], unrelated).includes('loom task inspect'));
  const guide = await readFile(join(installed, 'AGENT_GUIDE.md'), 'utf8');
  assert(guide.includes('readArtifactFile') && guide.includes('business_acceptance'));
  for (const domain of ['measurement', 'catalog']) {
    const app = join(installed, 'examples/integration', `${domain}.mjs`);
    const input = join(installed, 'examples/integration', `${domain}.json`);
    const domainRoot = join(root, `${domain}-task`), id = `${domain}-task`;
    const explained = JSON.parse(run(process.execPath, [cli, 'app', 'validate', app, '--explain', '--json'], unrelated));
    assert.equal(explained.explanation.execution, 'explicit-session-start');
    assert.equal(explained.native_integration, 'host-preflight-passed');
    run(process.execPath, [cli, 'task', 'create', '--app', app, '--root', domainRoot, '--name', id, '--input', input, '--json'], unrelated);
    const start = profile => [cli, 'session', 'start', '--task', id, '--root', domainRoot, '--profile', profile, '--json'];
    run(process.execPath, start('consume'), unrelated, 1);
    assert.equal(JSON.parse(logs.at(-1).stderr).error.code, 'PreconditionNotSatisfied');
    for (const profile of ['produce', 'consume']) run(process.execPath, start(profile), unrelated);
    const summary = JSON.parse(run(process.execPath, [cli, 'task', 'inspect', id, '--root', domainRoot, '--summary', '--json'], unrelated));
    assert.deepEqual(summary.counts, { sessions: 2, artifacts: 2, consumptions: 1, aspect_failures: 0 });
    assert.equal(summary.business_acceptance, 'not-evaluated');
    const result = summary.sessions.find(s => s.profile === 'consume').outputs[0];
    const data = JSON.parse(await readFile(join(domainRoot, result.payload_ref.path), 'utf8'));
    assert.deepEqual(data, domain === 'measurement' ? { total: 5, unit: 'm' } : { keys: ['item-one', 'item-two'] });
  }
  await copyFile(join(installed, 'examples/minimal/example.mjs'), join(project, 'example.mjs'));
  const taskRoot = join(root, 'task with spaces');
  const result = JSON.parse(run(process.execPath, [join(project, 'example.mjs'), taskRoot], unrelated));
  assert.equal(result.sessions, 2); assert.equal(result.consumptions, 1);
  const args = ['task', 'inspect', 'install-example', '--root', taskRoot, '--json'];
  const snapshot = JSON.parse(run(process.execPath, [cli, ...args], unrelated));
  assert.equal(snapshot.artifacts[0].consumers.length, 1);
  assert(snapshot.sessions.every(s => s.status === 'completed'));
  run(process.execPath, [cli, 'session', 'start', '--task', 'install-example', '--root', taskRoot, '--profile', 'produce'], unrelated, 1);
  assert.equal(JSON.parse(logs.at(-1).stderr.trim()).error.code, 'NativeIntegrationNotReady');
  // Three fresh process-driven Tasks per domain exercise the installed facade.
  // These are synthetic cold starts, not independent Agent blind trials.
  for (const domain of ['measurement', 'catalog']) for (let repetition = 0; repetition < 3; repetition++) {
    const id = `agent-${domain}-${repetition}`, taskRoot = join(root, id);
    const app = join(installed, 'examples/integration', `${domain}.mjs`);
    run(process.execPath, [cli, 'task', 'create', '--app', app, '--root', taskRoot, '--name', id,
      '--input', join(installed, 'examples/integration', `${domain}.json`)], unrelated);
    const args = ['--task', id, '--root', taskRoot, '--json'];
    const cards = JSON.parse(run(process.execPath, [cli, 'agent', 'discover', ...args], unrelated));
    assert(cards.entries.some(e => e.entry_id === `${domain}.consume`));
    const requestFile = join(root, `${id}-request.json`);
    const request = { schema_version: 1, request_id: `${id}-consume`, task_id: id, entry_id: `${domain}.consume` };
    await writeFile(requestFile, JSON.stringify(request));
    const blocked = JSON.parse(run(process.execPath, [cli, 'agent', 'invoke', ...args, '--request', requestFile], unrelated, 1));
    assert.equal(blocked.execution.status, 'not-started'); assert.equal(blocked.session_id, null);
    const data = JSON.parse(await readFile(join(installed, 'examples/integration', `${domain}.json`), 'utf8'));
    await writeFile(requestFile, JSON.stringify({ ...request, request_id: `${id}-produce`, entry_id: `${domain}.produce`, data }));
    const produced = JSON.parse(run(process.execPath, [cli, 'agent', 'invoke', ...args, '--request', requestFile], unrelated));
    request.inputs = { source: { artifact_id: produced.artifacts[0].id } };
    await writeFile(requestFile, JSON.stringify(request));
    const check = JSON.parse(run(process.execPath, [cli, 'agent', 'check', ...args, '--request', requestFile], unrelated));
    assert.equal(check.blockers.length, 0); assert.equal(check.native_preflight.status, 'not-checked');
    const result = JSON.parse(run(process.execPath, [cli, 'agent', 'invoke', ...args, '--request', requestFile], unrelated));
    assert.equal(result.execution.status, 'completed'); assert.equal(result.business_acceptance.status, 'not-evaluated');
    const facts = JSON.parse(run(process.execPath, [cli, 'agent', 'inspect', ...args, '--session', result.session_id], unrelated));
    assert.equal(facts.sessions[0].request_id, request.request_id);
  }
  await writeFile(join(project, 'agent-import.mjs'), `import { connectLoom } from 'agent-loom/agent';
    const loom = await connectLoom({ taskRoot: process.argv[2], taskId: 'agent-measurement-0' });
    console.log(JSON.stringify(await loom.inspect()));`);
  const sdkFacts = JSON.parse(run(process.execPath, [join(project, 'agent-import.mjs'), join(root, 'agent-measurement-0')], unrelated));
  assert.equal(sdkFacts.history, 'readable'); assert.equal(sdkFacts.readiness.host_delivery, 'missing');
  const ts = join(project, 'node_modules/typescript');
  // Copy only the pinned test compiler, never the checkout or its node_modules resolution tree.
  await cp(join(repo, 'node_modules/typescript'), ts, { recursive: true });
  await writeFile(join(project, 'consumer.ts'), `import { LocalTaskStore, type ArtifactRef } from 'agent-loom';
import { connectLoom, createRequest, type AgentRequest } from 'agent-loom/agent';
import { createPiApplicationHost, createPiHostModule, definePiApplicationModule, readArtifactFile, readTaskInput, type PiApplicationHostOptions } from 'agent-loom/runtime-pi';
const open: (root: string) => Promise<LocalTaskStore> = LocalTaskStore.open;
const host: (options: PiApplicationHostOptions) => ReturnType<typeof createPiApplicationHost> = createPiApplicationHost;
const id = (ref: ArtifactRef): string => ref.id;
const request: AgentRequest = createRequest('task', 'entry');
void [open, host, id, createPiHostModule, readArtifactFile, readTaskInput, connectLoom, definePiApplicationModule, request];\n`);
  run(process.execPath, [join(ts, 'bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', 'consumer.ts']);
  const beforeUninstall = JSON.stringify(snapshot);
  npm(['uninstall', '--global', 'agent-loom', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(JSON.stringify(JSON.parse(run(process.execPath, [cli, ...args], unrelated))), beforeUninstall);
  await assert.rejects(stat(join(commandDir, process.platform === 'win32' ? 'loom.cmd' : 'loom')), { code: 'ENOENT' });
  passed = true;
} finally {
  const evidence = join(repo, '.test-tmp/packages'); await mkdir(evidence, { recursive: true });
  const file = await mkdtemp(join(evidence, 'verification-'));
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(join(file, 'result.local.json'), JSON.stringify({ passed, archive, sha256, root, platform: process.platform, logs }, null, 2));
  console.log(JSON.stringify({ passed, package: relative(repo, archive), evidence: relative(repo, file), platform: process.platform,
    synthetic: true, real_task_acceptance: false, published: false }));
}
