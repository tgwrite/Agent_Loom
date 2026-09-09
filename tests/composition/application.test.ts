import assert from 'node:assert/strict';
import test from 'node:test';
import { defineApplication, prepareSession, validateApplication } from '../../packages/container-core/src/index.ts';
import { c2AnalysisApplication } from '../../examples/c2-analysis-application/application.ts';
import { fixture, testApplication } from '../helpers.ts';

test('full validation recognizes producers in another Profile without executing them', () => {
  assert.doesNotThrow(() => validateApplication(c2AnalysisApplication));
  const invalid = structuredClone(c2AnalysisApplication);
  invalid.plugins = invalid.plugins.map((plugin) => ({ ...plugin, produces: [] }));
  assert.throws(() => validateApplication(invalid), { code: 'InvalidDefinition' });
});

test('validation checks all Profiles and rejects malformed external definitions', () => {
  for (const invalid of [null, {}, { ...testApplication, runtime: null }, { ...testApplication, profiles: [] },
    { ...testApplication, profiles: [...testApplication.profiles, { id: 'bad', aspects: ['missing'], requirements: [] }] }]) {
    assert.throws(() => validateApplication(invalid), { code: 'InvalidDefinition' });
  }
});

test('Task keeps its own definition snapshot and Workspace resolution is explicit', async (t) => {
  const { store } = await fixture(t);
  const external = defineApplication(testApplication);
  external.id = 'modified';
  const snapshot = store.task;
  snapshot.application.id = 'modified';
  assert.equal(store.task.application.id, 'test-app');
  assert.equal((await prepareSession(store, 'test-profile', 'producer-workspace')).workspace, 'producer-workspace');
  await assert.rejects(prepareSession(store, 'test-profile', '../outside'), { code: 'InvalidRecord' });
  await assert.rejects(prepareSession(store, 'test-profile', '.agent-loom'), { code: 'InvalidRecord' });
});
