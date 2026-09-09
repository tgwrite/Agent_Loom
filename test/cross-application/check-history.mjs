import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { repo } from './freeze.mjs';
import { sha256 } from '../lightweight/handoff.mjs';
import { readJson } from '../lightweight/native-runtime.mjs';

// Read-only migration compatibility check through the public inspect surfaces.
// Old records are neither upgraded in place nor assigned invented provenance.
const phases = process.argv.slice(2);
assert(phases.length && phases.every(p => ['a', 'm1'].includes(p)));
const results = [];
async function files(root, path = '') {
  const entries = await readdir(join(root, path), { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? files(root, file) : [[file, sha256(await readFile(join(root, file)))]];
  }))).flat().sort(([a], [b]) => a.localeCompare(b));
}
for (const phase of phases) {
  const checkpoint = await readJson(join(repo, `.test-tmp/cross-application/checkpoint-${phase}.local.json`));
  assert.equal(checkpoint.status, 'passed');
  for (const row of checkpoint.results) {
    const taskRoot = join(repo, checkpoint.output, row.task);
    const previous = await readJson(join(taskRoot, 'inspection.local.json'));
    const before = row.arm === 'loom' ? await files(join(taskRoot, '.agent-loom'))
      : sha256(await readFile(join(taskRoot, 'control-state.local.json')));
    const args = row.arm === 'loom' ? [join(repo, 'bin/loom.mjs'), 'task', 'inspect', row.task, '--root', taskRoot, '--json']
      : [join(repo, 'test/cross-application/control.mjs'), 'inspect', taskRoot, row.task];
    const current = JSON.parse(execFileSync(process.execPath, args, { cwd: repo, encoding: 'utf8', windowsHide: true }));
    assert.deepEqual(current, previous);
    assert(current.artifacts.every(a => a.producer_phase === undefined && a.native_runtime_session_id === undefined));
    const after = row.arm === 'loom' ? await files(join(taskRoot, '.agent-loom'))
      : sha256(await readFile(join(taskRoot, 'control-state.local.json')));
    assert.deepEqual(after, before);
    results.push({ phase, arm: row.arm, application: row.application, task: row.task, unchanged: true });
  }
}
await writeFile(join(repo, `.test-tmp/cross-application/history-${phases.join('-')}.local.json`),
  JSON.stringify({ status: 'passed', inspections: results.length, results }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'passed', inspections: results.length }));
