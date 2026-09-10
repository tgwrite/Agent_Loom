// Optional local experiment. Raw evidence and existing Tasks remain outside version control.
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { inventory } from '../governance-parity/freeze.mjs';
import { sha256 } from '../lightweight/handoff.mjs';

const repo = process.cwd(), base = '.test-tmp/internal-simplification';
await mkdir(base, { recursive: true });
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
async function tree(root) {
  const result = {};
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) for (const [name, hash] of Object.entries(await tree(path))) result[join(entry.name, name)] = hash;
    else result[entry.name] = sha256(await readFile(path));
  }
  return result;
}
async function cli(tasks, consoleRoot) {
  const rows = [];
  await mkdir(consoleRoot, { recursive: true });
  for (const root of tasks) {
    const before = await tree(join(root, '.agent-loom'));
    const task = await json(join(root, '.agent-loom/task.json'));
    const command = args => {
      const r = spawnSync(process.execPath, [resolve('bin/loom.mjs'), ...args, '--root', resolve(root)], {
        cwd: consoleRoot, encoding: 'utf8', windowsHide: true, timeout: 30000,
        env: { ...process.env, LOOM_STATE_DIR: join(consoleRoot, 'catalog') },
      });
      assert.equal(r.status, 0, `CLI ${task.id}: ${r.stderr}`);
      rows.push({ root, args, stdout: r.stdout, stderr: r.stderr });
      return r.stdout;
    };
    const snapshot = JSON.parse(command(['task', 'inspect', task.id, '--json']));
    command(['task', 'inspect', task.id]);
    for (const session of snapshot.sessions) command(['session', 'inspect', session.id, '--task', task.id, '--json']);
    for (const artifact of snapshot.artifacts) command(['artifact', 'inspect', artifact.id, '--task', task.id, '--json']);
    assert.deepEqual(await tree(join(root, '.agent-loom')), before, 'Inspection modified governance');
  }
  return rows;
}
async function run(args, log, env = {}, executable = process.execPath) {
  return new Promise((done, fail) => {
    const child = spawn(executable, args, { cwd: repo, windowsHide: true,
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    const timer = setTimeout(() => child.kill(), 1200000);
    child.on('error', error => { clearTimeout(timer); fail(error); });
    child.on('close', async code => {
      clearTimeout(timer);
      try { await writeFile(log, output); assert.equal(code, 0, `Failed command; see ${relative(repo, log)}`); done(output); }
      catch (error) { fail(error); }
    });
  });
}
const lastResult = output => JSON.parse(output.trim().split('\n').findLast(line => line.startsWith('{') && line.includes('"output":')));
const [mode, ...args] = process.argv.slice(2);
if (mode === 'freeze') {
  const [nativeFile, parityFile, mutationFile] = args;
  const native = await json(nativeFile), parity = await json(parityFile), mutations = await json(mutationFile);
  assert.equal(native.status, 'passed'); assert.equal(native.results.length, 42);
  for (const arm of ['loom', 'control']) {
    assert.equal(parity[arm].passed, 50); assert.equal(Object.keys(parity[arm].guarantees).length, 18);
    assert(Object.values(parity[arm].guarantees).every(Boolean));
  }
  const matched = mutations.filter(m => m.arm === 'loom' && !['M06', 'M18'].includes(m.mutation_id));
  assert.equal(matched.length, 16); assert(matched.every(m => m.status === 'killed'));
  const tasks = native.results.filter(r => r.arm === 'loom').map(r => join(dirname(nativeFile), r.task));
  for (const name of ['loom-G14-legacy-observer-read-only', 'loom-G15-legacy-artifact-read-only']) tasks.push(join(dirname(parityFile), name));
  const files = await inventory();
  const frozen = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
    files, nativeFile, parityFile, mutationFile, tasks, cli: await cli(tasks, resolve(base, 'console')),
    mutations: matched, timestamp: new Date().toISOString() };
  await save(join(base, 'frozen.local.json'), frozen);
  console.log(JSON.stringify({ stage: 'S0', tasks: tasks.length, cli_commands: frozen.cli.length, mutations: matched.length }));
} else if (mode === 'stage') {
  const [stage] = args;
  assert(/^S[1-5]$/.test(stage));
  if (stage !== 'S1') assert.equal((await json(join(base, `S${Number(stage[1]) - 1}.local.json`))).status, 'passed');
  const frozen = await json(join(base, 'frozen.local.json')), files = await inventory();
  for (const [path, hash] of Object.entries(frozen.files)) if (!path.startsWith('packages/') && !path.startsWith('test/internal-simplification/') && !path.startsWith('tests/'))
    assert.equal(files[path], hash, `Frozen integration changed: ${path}`);
  for (const [path, hash] of Object.entries(frozen.files)) if (path.startsWith('tests/')) assert.equal(files[path], hash, `Frozen test changed: ${path}`);
  const root = await mkdtemp(join(base, `${stage}-`));
  // Build first: the real native CLI below consumes dist, while mutations use isolated source copies.
  const windows = process.platform === 'win32';
  await run(windows ? ['/d', '/s', '/c', 'npm run check'] : ['run', 'check'], join(root, 'check.local.txt'), {},
    windows ? process.env.ComSpec : 'npm');
  console.log(`${stage}: root checks passed`);
  const parity = lastResult(await run(['test/governance-parity/run.mjs'], join(root, 'parity.local.txt'), { PARITY_ARM: 'loom', PARITY_FILTER: '' }));
  assert.equal(parity.summary.loom.passed, 50);
  const scenarios = { S1: [''], S2: ['normal'], S3: ['invalid-publication'], S4: ['normal', 'domain-failure'], S5: [''] }[stage];
  const outputs = await Promise.all([
    run(['test/internal-simplification/mutate.mjs', root], join(root, 'mutations.local.txt')),
    (async () => {
      const results = [];
      for (const scenario of scenarios) results.push(lastResult(await run(['test/governance-parity/native.mjs'],
        join(root, `native-${scenario || 'all'}.local.txt`), { PARITY_ARM: 'loom', PARITY_APP: '', PARITY_SCENARIO: scenario })));
      return results;
    })(),
  ]);
  const mutation = lastResult(outputs[0]), native = outputs[1];
  assert.equal(native.reduce((n, r) => n + r.cases, 0), scenarios[0] === '' ? 21 : 3 * scenarios.length);
  const rows = await cli(frozen.tasks, resolve(base, 'console'));
  assert.deepEqual(rows, frozen.cli, 'CLI observable output changed');
  assert.deepEqual(await inventory(), files, 'Sources changed during a checkpoint');
  const result = { stage, status: 'passed', files, timestamp: new Date().toISOString(), parity, mutation, native,
    cli_commands: rows.length, cli_identical: true, output: root };
  await save(join(root, 'result.local.json'), result); await save(join(base, `${stage}.local.json`), result);
  console.log(JSON.stringify(result, (key, value) => key === 'files' ? undefined : value));
} else throw new Error('Use freeze <native result> <parity summary> <mutation results>, or stage S1..S5.');
