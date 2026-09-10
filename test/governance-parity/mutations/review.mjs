import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
const campaign = process.argv[2], rows = JSON.parse(await readFile(join(campaign, 'results.local.json')));
const native = JSON.parse(await readFile(join(campaign, 'native-diagnostics.local.json')));
const notes = {
  M01: 'Observer phase is wrong; structured failure remains present.',
  M02: 'Publication rejection is incorrectly attributed as aspect execution.',
  M03: 'Remaining record validation rejects missing native identity; valid native execution loses its publication.',
  M04: 'Remaining role validation rejects the mislabeled aspect publication.',
  M05: 'Remaining producer validation rejects the foreign native identity.',
  M06: 'The unchanged real pipeline initializer accepts modified bytes after its shared domain digest guard is removed.',
  M07: 'Consumption is persisted before the initializer rejects modified bytes; no accepted input is established.',
  M08: 'Ambiguity returns a candidate instead of rejecting the request.',
  M09: 'A foreign-Task Artifact row is readable. This probe does not claim physical bytes were fetched from another Task directory.',
  M10: 'Real domain work is marked failed because an optional aspect fails.',
  M11: 'A real failed final domain operation is reported completed.',
  M12: 'Observer persistence fails, but execution reports completed without the required failure evidence.',
  M13: 'Valid legacy observer wire data is rejected.',
  M14: 'Legacy native identity and phase are fabricated on reads; control can also persist that invented projection during a later write.',
  M15: 'Completed becomes visible before required close observations; subsequent close failure does not retract the completed state.',
  M16: 'Independent actual provider request capture contains the entire governance Task snapshot.',
  M17: 'Top-level Artifact projection loses native fields. Session-produced entries retain them; this is projection drift, not total loss of recoverability.',
};
const reviewed = [];
for (const row of rows) {
  if (row.status === 'structurally-not-applicable') { reviewed.push(row); continue; }
  assert.equal(row.status, 'killed');
  const log = await readFile(join(row.output, 'test.local.txt'), 'utf8');
  const output = JSON.parse(log.trim().split('\n').findLast(line => line.startsWith('{"output":'))).output;
  const caseRoot = resolve(row.output, output, `${row.arm}-${row.failing_test.replaceAll(':', '-')}`);
  let state;
  if (row.arm === 'control') state = JSON.parse(await readFile(join(caseRoot, '.control/state.json')));
  else {
    const base = join(caseRoot, '.agent-loom');
    const jsonl = async path => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    state = { sessions: await Promise.all((await readdir(join(base, 'sessions'))).map(id => readFile(join(base, 'sessions', id, 'session.json')).then(JSON.parse))),
      artifacts: await jsonl(join(base, 'artifacts.jsonl')), consumptions: await jsonl(join(base, 'consumptions.jsonl')) };
  }
  const guarded = ['M03', 'M04', 'M05'].includes(row.mutation_id);
  if (guarded) assert(state.artifacts.every(a => {
    const s = state.sessions.find(s => s.id === a.producer.session_id);
    return s && a.native_runtime_session_id === s.runtime_session_id
      && a.producer_phase === (a.producer.plugin_id === s.primary_plugin_id ? 'domain-run' : 'aspect-after-run');
  }));
  if (row.mutation_id === 'M07') assert.equal(state.consumptions.length, 1);
  if (row.mutation_id === 'M12' || row.mutation_id === 'M15') assert(state.sessions.some(s => s.status === 'completed'));
  if (row.mutation_id === 'M06') assert((await readFile(join(caseRoot, 'consumer/normalized.md'), 'utf8')).includes('Modified content.'));
  const applicationEvidence = native.filter(n => n.mutation_id === row.mutation_id && n.arm === row.arm);
  if (row.mutation_id === 'M16') { assert.equal(applicationEvidence.length, 3); assert(applicationEvidence.every(n => n.metadata_in_main)); }
  reviewed.push({ ...row, classification_review: 'agent review of source patch, frozen failures and persisted evidence; not blinded human review',
    path_reached: true, runtime_contained: guarded, actual_violation: !guarded,
    guarded_scope: guarded ? 'Invalid native provenance was not registered; execution still regressed.' : null,
    escaped_application_tests: applicationEvidence.length ? applicationEvidence.some(n => n.frozen_native_driver_exit === 0) : null,
    actual_native_applications: applicationEvidence.map(n => n.application),
    actual_affected_applications: row.mutation_id === 'M06' ? ['c'] : row.application_scope,
    evidence: relative('.', caseRoot), effect: notes[row.mutation_id] });
}
await writeFile(join(campaign, 'reviewed.local.json'), JSON.stringify(reviewed, null, 2));
console.log(JSON.stringify({ reviewed: reviewed.length, native_diagnostics: native.length,
  matched_governance_per_arm: reviewed.filter(r => r.arm === 'loom' && r.owner !== 'shared-domain' && r.status === 'killed').length,
  early_per_arm: reviewed.filter(r => r.arm === 'loom' && r.owner !== 'shared-domain' && r.detection_layer === 'shared-primitive').length }));
