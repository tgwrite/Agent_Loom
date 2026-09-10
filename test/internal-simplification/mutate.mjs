// The original tests and order are frozen; only moved production patch anchors are retargeted.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../governance-parity/freeze.mjs';
import { mutations } from '../governance-parity/mutations/manifest.mjs';
const campaign = await mkdtemp(join(process.argv[2], 'campaign-')), results = [], files = await inventory();
const baseline = JSON.parse(await readFile('.test-tmp/internal-simplification/frozen.local.json'));
const roots = {
  M01: ['Observer phase accuracy', 'Exact'], M02: ['Publication failure classification', 'Exact'],
  M03: ['Native provenance completeness', 'Indirect'], M04: ['Native producer role', 'Exact'],
  M05: ['Native Session identity', 'Indirect'], M07: ['Consumption after successful initialization', 'Near'],
  M08: ['Ambiguous binding rejection', 'Exact'], M09: ['Persisted Task membership', 'Exact'],
  M10: ['Aspect failure containment', 'Near'], M11: ['Domain failure preservation', 'Indirect'],
  M12: ['Observer persistence failure propagation', 'Exact'], M13: ['Legacy observer readability', 'Exact'],
  M14: ['Legacy Artifact facts remain absent', 'Exact'], M15: ['Shutdown before settlement', 'Indirect'],
  M16: ['Main context isolation', 'Exact'], M17: ['Inspection provenance visibility', 'Exact'],
};
for (const m of mutations.filter(m => Object.hasOwn(roots, m.id))) {
  const target = { ...m.loom };
  if (m.id === 'M13' && files['packages/container-core/src/failure/observer.ts']) target.file = 'packages/container-core/src/failure/observer.ts';
  if (m.id === 'M17' && files['packages/container-core/src/inspection.ts']) target.file = 'packages/container-core/src/inspection.ts';
  const root = resolve(await mkdtemp(join(campaign, `${m.id}-`)));
  for (const path of Object.keys(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await copyFile(path, join(root, path));
  }
  for (const path of ['node_modules', 'test/lightweight/node_modules', 'test/composite/node_modules', 'test/reuse/node_modules', 'test/cross-application/node_modules']) {
    try { await stat(path); await mkdir(dirname(join(root, path)), { recursive: true }); await symlink(resolve(path), join(root, path), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const source = await readFile(join(root, target.file), 'utf8');
  // New semantic modules use LF; old anchors may originate from a CRLF checkout.
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  for (const key of ['before', 'after']) target[key] = target[key].replaceAll('\r\n', '\n').replaceAll('\n', newline);
  assert.equal(source.split(target.before).length - 1, 1, `${m.id} patch anchor count`);
  await writeFile(join(root, target.file), source.replace(target.before, target.after));
  const command = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true,
    timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...env } });
  const build = command([resolve('node_modules/typescript/bin/tsc'), '--noEmit']);
  await writeFile(join(root, 'build.local.txt'), build.stdout + build.stderr);
  assert.equal(build.status, 0, `${m.id} must remain an executable behavioral mutation`);
  const test = command(['test/governance-parity/run.mjs'], { PARITY_ARM: 'loom', PARITY_FILTER: '' });
  await writeFile(join(root, 'test.local.txt'), test.stdout + test.stderr);
  const line = test.stdout.trim().split('\n').findLast(line => line.startsWith('{"output":'));
  assert(line, `${m.id} incomplete test run`);
  const output = JSON.parse(line).output, cases = JSON.parse(await readFile(join(root, output, 'guarantees.local.json')));
  assert.equal(cases.length, 50);
  const failed = cases.filter(c => !c.passed), first = failed[0];
  const previous = baseline.mutations.find(row => row.mutation_id === m.id);
  assert(first, `${m.id} escaped`);
  const sameFirst = first.id === previous.failing_test;
  const row = { mutation_id: m.id, root_semantic: roots[m.id][0], status: 'killed', compile: 'passed', cases: cases.length,
    first_failing_test: first.id, first_failing_layer: ['G14', 'G15'].includes(first.guarantee) ? 'legacy-compatibility'
      : first.guarantee === 'G18' ? 'product-inspect' : 'shared-primitive',
    diagnostic_relevance: sameFirst ? roots[m.id][1] : 'pending-review', same_first_test: sameFirst,
    secondary_cascade_failures: failed.slice(1).map(c => ({ id: c.id, error: c.error })),
    first_error: first.error, failing_tests: failed.map(c => c.id), time_to_first_failure_ms: first.elapsed_ms,
    escaped_shared_tests: !failed.some(c => !['G14', 'G15', 'G18'].includes(c.guarantee)),
    patch: target, output: relative('.', root) };
  results.push(row); await writeFile(join(campaign, 'results.local.json'), JSON.stringify(results, null, 2));
}
const early = results.filter(r => !r.escaped_shared_tests).length;
assert.equal(results.length, 16); assert(early >= 13);
assert(results.every(r => r.diagnostic_relevance !== 'pending-review'), 'Changed localization requires explicit review');
console.log(JSON.stringify({ output: campaign, killed: results.length, early, cases: results.reduce((n, r) => n + r.cases, 0) }));
