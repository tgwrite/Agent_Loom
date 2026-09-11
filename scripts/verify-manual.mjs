// Execute the files printed in the user manual against an independently installed archive.
// --native additionally installs pinned public Pi dependencies and uses a local model fixture.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { join, resolve, relative, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const repo = resolve(import.meta.dirname, '..');
const [archiveArg, mode] = process.argv.slice(2);
assert(archiveArg && (mode === undefined || mode === '--native') && process.argv.length <= 4,
  'Use npm run manual:verify -- <archive.tgz> [--native]');
assert(process.env.npm_execpath, 'Run through npm');
const archive = resolve(archiveArg), native = mode === '--native';
const root = await mkdtemp(join(tmpdir(), 'loom manual application '));
const project = join(root, 'application'), logs = [];
await mkdir(project);
await mkdir(join(repo, '.test-tmp/manual'), { recursive: true });
const evidence = await mkdtemp(join(repo, '.test-tmp/manual/verification-'));
let server, passed = false, modelRequests = 0;
const env = { ...process.env, npm_config_cache: join(root, 'npm-cache'),
  NODE_PATH: '', NODE_OPTIONS: '', LOOM_STATE_DIR: join(root, 'index'),
  PI_CODING_AGENT_DIR: join(root, 'pi-defaults'), PI_SKIP_VERSION_CHECK: '1' };
async function run(args, expected = 0) {
  const result = await new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: project, env, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    const timer = setTimeout(() => child.kill(), 240000);
    child.on('error', error => { clearTimeout(timer); fail(error); });
    child.on('close', status => { clearTimeout(timer); done({ status, stdout, stderr }); });
  });
  logs.push({ args, ...result });
  assert.equal(result.status, expected, `Manual command ${logs.length} failed; see local evidence`);
  return result.stdout;
}
const npm = args => run([process.env.npm_execpath, ...args]);
try {
  // Every linked manual chapter must exist; no dependency on ignored planning directories.
  for (const name of await readdir(join(repo, 'manual'))) {
    const file = join(repo, 'manual', name), text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g))
      await readFile(resolve(dirname(file), match[1]));
  }
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'manual-consumer', private: true, type: 'module' }));
  await copyFile(archive, join(project, basename(archive)));
  await npm(['install', './' + basename(archive), '--save-exact', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
  const cli = join(project, 'node_modules/agent-loom/bin/loom.mjs');
  const loom = args => run([cli, ...args]);
  const json = async args => JSON.parse(await loom([...args, '--json']));
  const demoApp = './node_modules/agent-loom/examples/integration/measurement.mjs';
  await json(['app', 'validate', demoApp, '--definition-only', '--explain']);
  await json(['task', 'create', '--app', demoApp, '--root', './sample-task', '--name', 'sample-task',
    '--input', './node_modules/agent-loom/examples/integration/measurement.json']);
  for (const profile of ['produce', 'consume'])
    await json(['session', 'start', '--task', 'sample-task', '--root', './sample-task', '--profile', profile]);
  const summary = await json(['task', 'inspect', 'sample-task', '--root', './sample-task', '--summary']);
  assert.deepEqual(summary.counts, { sessions: 2, artifacts: 2, consumptions: 1, aspect_failures: 0 });

  const text = await readFile(join(repo, 'manual/NATIVE_INTEGRATION.md'), 'utf8');
  const names = [];
  for (const match of text.matchAll(/<!-- file: ([a-z-]+\.(?:mjs|json)) -->\r?\n```(?:js|json)\r?\n([\s\S]*?)\r?\n```/g)) {
    const [, name, code] = match;
    assert(!names.includes(name)); names.push(name);
    await writeFile(join(project, name), code + '\n');
    if (name.endsWith('.mjs')) await run(['--check', join(project, name)]);
    else JSON.parse(code);
  }
  assert.deepEqual(names, ['application.mjs', 'native-tool.mjs', 'runtime.mjs', 'adapter.mjs', 'host.mjs', 'request.json']);
  await json(['app', 'validate', './application.mjs', '--definition-only', '--explain']);
  const described = await json(['agent', 'describe', 'text.normalize', '--app', './application.mjs']);
  assert.equal(described.entry_id, 'text.normalize');
  assert(described.request_schema.required.includes('data'));
  if (native) {
    await npm(['install', '--save-exact', '@earendil-works/pi-coding-agent@0.85.1',
      '@earendil-works/pi-ai@0.85.1', 'typebox@1.1.38', '--ignore-scripts', '--no-audit', '--no-fund']);
    await mkdir(env.PI_CODING_AGENT_DIR);
    server = createServer(async (req, res) => {
      try {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw); modelRequests++;
        const hasResult = body.messages.some(message => message.role === 'tool');
        const delta = hasResult ? { role: 'assistant', content: 'Completed.' } : {
          role: 'assistant', tool_calls: [{ index: 0, id: 'normalize-call', type: 'function',
            function: { name: 'normalize_text', arguments: JSON.stringify({ text: 'Hello Loom' }) } }],
        };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const [value, finish] of [[delta, null], [{}, hasResult ? 'stop' : 'tool_calls']])
          res.write('data: ' + JSON.stringify({ id: 'manual-fixture', object: 'chat.completion.chunk', created: 0,
            model: 'manual-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] }) + '\n\n');
        res.end('data: [DONE]\n\n');
      } catch { res.writeHead(500); res.end(); }
    });
    await new Promise(done => server.listen(0, 'localhost', done));
    const endpoint = new URL('http://localhost'); endpoint.port = String(server.address().port);
    await writeFile(join(env.PI_CODING_AGENT_DIR, 'settings.json'), JSON.stringify({
      defaultProvider: 'manual-fixture', defaultModel: 'manual-fixture' }));
    await writeFile(join(env.PI_CODING_AGENT_DIR, 'auth.json'), '{}');
    await writeFile(join(env.PI_CODING_AGENT_DIR, 'models.json'), JSON.stringify({ providers: {
      'manual-fixture': { baseUrl: endpoint.href, api: 'openai-completions', apiKey: 'synthetic-not-a-credential',
        models: [{ id: 'manual-fixture', name: 'Local fixture', reasoning: false, input: ['text'],
          contextWindow: 32000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] },
    } }));
    const preflight = await json(['app', 'validate', './application.mjs']);
    assert.equal(preflight.native_integration, 'host-preflight-passed');
    assert.equal(modelRequests, 0, 'Preflight made a model request');
    await json(['task', 'create', '--app', './application.mjs', '--root', './text-task', '--name', 'text-task']);
    const requestArgs = ['--task', 'text-task', '--root', './text-task', '--request', './request.json'];
    const check = await json(['agent', 'check', ...requestArgs]);
    assert.equal(check.blockers.length, 0);
    const receipt = await json(['agent', 'invoke', ...requestArgs, '--exclusive-writer']);
    assert.equal(receipt.execution.status, 'completed');
    assert.equal(receipt.observation.outcome_confirmed, true);
    assert.equal(receipt.artifacts.length, 1);
    const inspect = await json(['task', 'inspect', 'text-task', '--root', './text-task', '--summary']);
    const output = inspect.sessions[0].outputs[0].payload_ref.path;
    assert.deepEqual(JSON.parse(await readFile(join(project, 'text-task', output), 'utf8')),
      { input: 'Hello Loom', normalized: 'HELLO LOOM' });
    assert.equal(modelRequests, 2, 'Native loop did not execute the expected tool exchange');
    const cold = await json(['agent', 'inspect', '--task', 'text-task', '--root', './text-task']);
    assert.equal(cold.history, 'readable');
  }
  passed = true;
} finally {
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await writeFile(join(evidence, 'result.local.json'), JSON.stringify({ passed, native,
    model_fixture: native, modelRequests, commercial_model_requests: 0, root, archive, logs }, null, 2));
  console.log(JSON.stringify({ passed, native, model_fixture: native, commercial_model_requests: 0,
    business_quality_validated: false, evidence: relative(repo, evidence) }));
}
