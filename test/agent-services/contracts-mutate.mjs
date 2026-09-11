// Synthetic contract regressions in isolated copies, never changes to the active checkout.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, copyFile, readFile, writeFile, symlink } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../governance-parity/freeze.mjs';
const base = '.test-tmp/agent-services'; await mkdir(base, { recursive: true });
const campaign = await mkdtemp(join(base, 'contracts-'));
const files = await inventory();
await writeFile(join(campaign, 'source-inventory.local.json'), JSON.stringify(files, null, 2));
const core = 'packages/container-core/src/';
const mutations = [
  ['C01', 'agent-receipt.ts', "status: confirmed ? session.status : 'unknown'", 'status: session.status'],
  ['C02', 'governance.ts', '...(prepared.request ? { resolved_inputs:', '...(false ? { resolved_inputs:'],
  ['C03', 'agent-receipt.ts', 'session.consumed.map', 'session.consumed.slice(0, 0).map'],
  ['C04', 'storage/index.ts', '&& selected.artifact_id === artifact.id && selected.sha256 === artifact.sha256', '&& selected.artifact_id === artifact.id'],
  ['C05', 'agent.ts', "native = 'failed';", "native = 'not-checked';"],
  ['C06', 'governance.ts', 'createNativeFailure(result.failure, domainStarted)', 'createNativeFailure(undefined, domainStarted)'],
  ['C07', 'failure/diagnostic.ts', "const registered = typeof error === 'object'", "const registered = readSafeDiagnostic((error as FailureRecord)?.diagnostic) ?? (typeof error === 'object'"],
];
const results = [];
for (const [id, file, before, after] of mutations) {
  const root = resolve(await mkdtemp(join(campaign, `${id}-`)));
  for (const path of Object.keys(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await copyFile(path, join(root, path)); }
  await symlink(resolve('node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const target = join(root, core, file); let source = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(source.split(before).length - 1, 1, `${id} requires an exact anchor`);
  source = source.replace(before, after);
  // Close only the extra expression in the trust-admission mutant.
  if (id === 'C07') source = source.replace("trusted.get(error) : undefined;\n  const code", "trusted.get(error) : undefined);\n  const code");
  await writeFile(target, source);
  const run = args => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const build = run([resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json']);
  await writeFile(join(root, 'build.local.txt'), build.stdout + build.stderr);
  assert.equal(build.status, 0, `${id} must compile`);
  const test = run(['--test', '--test-reporter=tap', 'tests/agent/contracts.test.mjs']);
  await writeFile(join(root, 'test.local.txt'), test.stdout + test.stderr);
  assert.equal(test.status, 1, `${id} must be detected by behavior`);
  assert.match(test.stdout, /# tests 10\b/, `${id} must execute all contract tests`);
  const failed = [...test.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  assert(failed.length > 0);
  results.push({ id, build: 'passed', status: 'detected', failing_tests: failed });
  await writeFile(join(campaign, 'results.local.json'), JSON.stringify(results, null, 2));
  console.log(`${id}: detected`);
}
console.log(JSON.stringify({ synthetic: true, detected: results.length, native_acceptance: false, evidence: relative('.', campaign) }));
