import assert from 'node:assert/strict';
import test from 'node:test';
import { ContainerFailure, defineApplication, prepareSession, validateApplication } from '../../packages/container-core/src/index.ts';
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

test('definition diagnostics identify missing entry fields and nested contracts without echoing values', () => {
  const validEntry = { id: 'sample.run', purpose: 'Synthetic operation', implementation: 'native',
    request_mapping: 'v1', effect_declarations: [] };
  const application = (entry: unknown) => ({ ...testApplication,
    profiles: [{ ...testApplication.profiles[0], entry }] });
  for (const [field, rule] of [['implementation', 'expected-native-or-synthetic'], ['effect_declarations', 'expected-array']]) {
    const entry = { ...validEntry };
    Reflect.deleteProperty(entry, field!);
    assert.throws(() => validateApplication(application(entry)), error => {
      assert(error instanceof ContainerFailure);
      assert.equal(error.code, 'InvalidDefinition');
      assert.deepEqual(error.details, { path: `profiles[0].entry.${field}`, rule });
      return true;
    });
  }
  const invalid = application({ ...validEntry, implementation: 'synthetic-diagnostic-canary' });
  assert.throws(() => validateApplication(invalid), error => {
    assert(error instanceof ContainerFailure);
    assert.equal(error.details.path, 'profiles[0].entry.implementation');
    assert(!JSON.stringify({ message: error.message, details: error.details }).includes('synthetic-diagnostic-canary'));
    return true;
  });
  const nested = { ...testApplication, plugins: [{ ...testApplication.plugins[0], produces: [{ type: 'sample', version: null }] }] };
  assert.throws(() => validateApplication(nested), error => {
    assert(error instanceof ContainerFailure);
    assert.deepEqual(error.details, { path: 'plugins[0].produces[0].version', rule: 'expected-nonempty-string' });
    return true;
  });
  assert.doesNotThrow(() => validateApplication(application(validEntry)));
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
