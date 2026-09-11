// Optional synthetic regression of the existing 16 matched Loom mutations.
// Native parity and independent Agent experience are separate evidence gates.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../governance-parity/freeze.mjs';
import { mutations } from '../governance-parity/mutations/manifest.mjs';
const base = '.test-tmp/agent-services'; await mkdir(base, { recursive: true });
const campaign = await mkdtemp(join(base, 'mutations-'));
const files = await inventory(), results = [];
await writeFile(join(campaign, 'source-inventory.local.json'), JSON.stringify(files, null, 2));
for (const mutation of mutations.filter(m => !['M06', 'M18'].includes(m.id))) {
  const root = resolve(await mkdtemp(join(campaign, `${mutation.id}-`)));
  for (const path of Object.keys(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await copyFile(path, join(root, path));
  }
  await symlink(resolve('node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const target = mutation.loom, source = await readFile(join(root, target.file), 'utf8');
  assert.equal(source.split(target.before).length - 1, 1, `${mutation.id} patch anchor count`);
  await writeFile(join(root, target.file), source.replace(target.before, target.after));
  const run = args => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true,
    timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const build = run([resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json']);
  await writeFile(join(root, 'build.local.txt'), build.stdout + build.stderr);
  assert.equal(build.status, 0, `${mutation.id} must compile before receiving behavioral detection credit`);
  const runner = `import { runGuarantees } from './test/governance-parity/guarantees.mjs';
    import { mkdir, writeFile } from 'node:fs/promises'; await mkdir('.test-tmp/results', { recursive: true });
    const rows = await runGuarantees('.test-tmp/results', ['loom'], '', false);
    await writeFile('rows.local.json', JSON.stringify(rows));`;
  await writeFile(join(root, 'run.local.mjs'), runner);
  const test = run(['run.local.mjs']);
  await writeFile(join(root, 'test.local.txt'), test.stdout + test.stderr);
  assert.equal(test.status, 0, `${mutation.id} must complete its probe collection`);
  const rows = JSON.parse(await readFile(join(root, 'rows.local.json'), 'utf8'));
  assert.equal(rows.length, 49);
  const failed = rows.filter(row => !row.passed);
  results.push({ mutation_id: mutation.id, build: 'passed', cases: rows.length,
    status: failed.length ? 'detected' : 'survived', failing_tests: failed.map(row => row.id) });
  await writeFile(join(campaign, 'results.local.json'), JSON.stringify(results, null, 2));
  console.log(`${mutation.id}: ${failed.length ? 'detected' : 'survived'} (${failed[0]?.id ?? 'none'})`);
}
assert.equal(results.length, 16);
assert(results.every(row => row.status === 'detected'), 'An existing matched mutation survived');
console.log(JSON.stringify({ synthetic: true, matched_loom_mutations: results.length, native_acceptance: false,
  independent_agent_trials: false, evidence: relative('.', campaign) }));
