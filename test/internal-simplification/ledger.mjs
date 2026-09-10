import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { inventory } from '../governance-parity/freeze.mjs';

const base = '.test-tmp/internal-simplification';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const frozen = await json(join(base, 'frozen.local.json')), files = await inventory();
const stages = [], nativeCases = [];
let localization;
for (const stage of ['S1', 'S2', 'S3', 'S4', 'S5']) {
  const checkpoint = await json(join(base, `${stage}.local.json`));
  assert.equal(checkpoint.status, 'passed');
  const mutations = await json(join(checkpoint.mutation.output, 'results.local.json'));
  assert.equal(mutations.length, 16);
  for (const mutation of mutations) {
    assert.equal(mutation.status, 'killed'); assert.equal(mutation.compile, 'passed');
    assert.deepEqual(mutation.failing_tests, frozen.mutations.find(m => m.mutation_id === mutation.mutation_id).failing_tests);
  }
  const cases = [];
  for (const result of [checkpoint.native].flat()) {
    const proof = await json(join(result.output, 'result.local.json'));
    assert.equal(proof.status, 'passed'); assert(proof.global_pi_config_unchanged && proof.native_packages_unchanged);
    cases.push(...proof.results);
  }
  assert.equal(checkpoint.parity.summary.loom.passed, 50);
  assert.equal(Object.keys(checkpoint.parity.summary.loom.guarantees).length, 18);
  assert(Object.values(checkpoint.parity.summary.loom.guarantees).every(Boolean));
  assert(checkpoint.cli_identical && checkpoint.mutation.early >= 13);
  nativeCases.push(...cases);
  stages.push({ stage, guarantees: 18, primitive_cases: 50, mutations: 16, early: checkpoint.mutation.early,
    native_tasks: cases.length, native_sessions: cases.reduce((n, c) => n + c.sessions, 0), cli_comparisons: checkpoint.cli_commands });
  if (stage === 'S5') {
    for (const [path, hash] of Object.entries(checkpoint.files)) if (/^(packages|tests)\//.test(path))
      assert.equal(files[path], hash, `Accepted source changed: ${path}`);
    localization = mutations.map(m => ({ mutation_id: m.mutation_id, root_semantic: m.root_semantic,
      first_failing_test: m.first_failing_test, first_failing_layer: m.first_failing_layer,
      diagnostic_relevance: m.diagnostic_relevance, secondary_cascade_failures: m.secondary_cascade_failures.map(f => f.id) }));
  }
}
for (const [path, hash] of Object.entries(frozen.files)) if (/^(adapters\/|test\/(?!internal-simplification\/)|packages\/(runtime-pi\/|container-core\/src\/application\/))/.test(path))
  assert.equal(files[path], hash, `Frozen integration changed: ${path}`);
const scope = path => /^packages\/(container-core|runtime-pi|cli)\/src\//.test(path);
const git = args => execFileSync('git', args, { encoding: 'utf8', windowsHide: true });
const oldPaths = Object.keys(frozen.files).filter(scope), newPaths = Object.keys(files).filter(scope);
const lines = source => source.trimEnd().split('\n').length;
const beforeLines = oldPaths.reduce((n, path) => n + lines(git(['show', `${frozen.revision}:${path}`])), 0);
const afterLines = (await Promise.all(newPaths.map(async path => lines(await readFile(path, 'utf8'))))).reduce((a, b) => a + b, 0);
const ledger = { baseline: frozen.revision, stages, localization,
  scope: { before: { files: oldPaths.length, physical_lines: beforeLines }, after: { files: newPaths.length, physical_lines: afterLines } },
  chain_responsibilities: { observer: { before: 4, after: 2 }, native_provenance: { before: 5, after: 3 } },
  native: { tasks: nativeCases.length, sessions: nativeCases.reduce((n, c) => n + c.sessions, 0),
    artifacts: nativeCases.reduce((n, c) => n + c.artifacts, 0), local_review_requests: nativeCases.reduce((n, c) => n + c.review_requests, 0),
    commercial_llm_requests: nativeCases.reduce((n, c) => n + c.actual_llm_requests, 0) },
  caveat: 'Responsibility counts are reviewed change-impact analysis, not measured human maintenance time. Rejected attempts are excluded.' };
await writeFile(join(base, 'ledger.local.json'), JSON.stringify(ledger, null, 2));
console.log(JSON.stringify({ stages: stages.length, scope: ledger.scope, native: ledger.native }));
