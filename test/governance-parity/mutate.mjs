import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from './freeze.mjs';
import { sha256 } from '../lightweight/handoff.mjs';

const frozen = JSON.parse(await readFile('.test-tmp/governance-parity/frozen.local.json'));
const actual = await inventory(); assert.deepEqual(actual, frozen.files, 'Frozen production or regression changed');
const { mutations } = await import('./mutations/manifest.mjs');
const campaign = await mkdtemp('.test-tmp/governance-parity/campaign-'), results = [];
const selected = process.env.MUTATION_FILTER;
for (const m of mutations.filter(m => !selected || selected.split(',').includes(m.id))) for (const arm of ['loom', 'control']) {
  const target = m[arm];
  const row = { mutation_id: m.id, arm, owner: m.owner ?? arm, application_scope: m.apps, baseline_hash: frozen.digest,
    detected: false, detection_layer: null, failing_test: null, escaped_shared_tests: null, escaped_application_tests: null,
    manual_inspection_required: false, runtime_contained: null, actual_violation: null, path_reached: null };
  if (!target) { results.push({ ...row, status: 'structurally-not-applicable', reason: m.reason }); continue; }
  const root = resolve(await mkdtemp(join(campaign, `${m.id}-${arm}-`)));
  for (const path of Object.keys(frozen.files)) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await copyFile(path, join(root, path));
  }
  for (const path of ['node_modules', 'test/lightweight/node_modules', 'test/composite/node_modules', 'test/reuse/node_modules', 'test/cross-application/node_modules']) {
    try { await stat(path); await mkdir(dirname(join(root, path)), { recursive: true }); await symlink(resolve(path), join(root, path), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const source = await readFile(join(root, target.file), 'utf8');
  const count = source.split(target.before).length - 1;
  assert.equal(count, target.count ?? 1, `${m.id}/${arm} patch anchor count`);
  await writeFile(join(root, target.file), source.replaceAll(target.before, target.after));
  row.patch_hash = sha256(JSON.stringify(target)); row.target = target.file; row.patch = target;
  const command = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true,
    timeout: 45000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...env } });
  const buildStarted = performance.now();
  const build = arm === 'loom' ? command([resolve('node_modules/typescript/bin/tsc'), '--noEmit']) : command(['--check', target.file]);
  row.build_ms = performance.now() - buildStarted; row.compile_result = build.status === 0 ? (arm === 'loom' ? 'typecheck-passed' : 'syntax-passed-untyped') : 'rejected';
  await writeFile(join(root, 'build.local.txt'), build.stdout + build.stderr);
  if (build.status !== 0) {
    row.status = build.error ? 'infrastructure-error' : 'compile-blocked'; row.detection_layer = 'build'; row.detected = !build.error;
  } else {
    const started = performance.now();
    const test = command(['test/governance-parity/run.mjs'], { PARITY_ARM: arm, PARITY_FILTER: '' });
    row.suite_ms = performance.now() - started;
    await writeFile(join(root, 'test.local.txt'), test.stdout + test.stderr);
    const line = test.stdout.trim().split('\n').findLast(line => line.startsWith('{"output":'));
    if (!line) { row.status = 'infrastructure-error'; row.reason = test.error?.code ?? 'No complete test result'; }
    else {
      const output = JSON.parse(line).output, cases = JSON.parse(await readFile(join(root, output, 'guarantees.local.json')));
      const failed = cases.filter(c => !c.passed), first = failed[0];
      row.failing_tests = failed.map(c => c.id); row.cases = cases.length;
      row.detected = Boolean(first); row.failing_test = first?.id ?? null;
      row.time_to_first_failure = first?.elapsed_ms ?? null;
      row.detection_layer = first ? first.guarantee === 'G14' || first.guarantee === 'G15' ? 'legacy-compatibility'
        : first.guarantee === 'G18' ? 'product-inspect' : 'shared-primitive' : 'undetected';
      row.escaped_shared_tests = !failed.some(c => !['G14', 'G15', 'G18'].includes(c.guarantee));
      row.status = first ? 'killed' : 'needs-diagnosis';
      // A failing test alone does not establish a business violation or prove a mutant was contained.
      row.path_reached = first ? 'behavioral-failure-at-target-family-pending-review' : null;
    }
  }
  row.output = relative('.', root); results.push(row);
  await writeFile(join(campaign, 'results.local.json'), JSON.stringify(results, null, 2));
  console.log(`${m.id} ${arm}: ${row.status} ${row.failing_test ?? ''}`);
}
await writeFile(join(campaign, 'results.local.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output: campaign, count: results.length }));
