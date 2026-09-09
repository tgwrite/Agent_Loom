import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProfile } from '../../packages/container-core/src/index.ts';
import { c2AnalysisApplication } from '../../examples/c2-analysis-application/application.ts';

test('reference Profiles each select one domain Plugin and Postmortem', () => {
  for (const id of ['c2forge', 'c2decoder']) {
    const result = resolveProfile(c2AnalysisApplication, id);
    assert.deepEqual(result.plugins.map((plugin) => plugin.id), [id, 'postmortem']);
  }
});

test('domain Plugins cannot be smuggled into aspect bindings', () => {
  assert.throws(() => resolveProfile({ ...c2AnalysisApplication, profiles: [
    { id: 'invalid', primary: 'c2forge', aspects: ['c2decoder'], requirements: [] },
  ] }, 'invalid'), { code: 'InvalidDefinition' });
});

test('duplicate or missing Profile bindings fail explicitly', () => {
  assert.throws(() => resolveProfile(c2AnalysisApplication, 'missing'), { code: 'InvalidDefinition' });
  const profile = { id: 'duplicate', primary: 'c2forge', aspects: ['postmortem', 'postmortem'], requirements: [] };
  assert.throws(() => resolveProfile({ ...c2AnalysisApplication, profiles: [profile] }, profile.id), { code: 'BindingConflict' });
});

test('Capability provider conflicts are never auto-selected', () => {
  const application = structuredClone(c2AnalysisApplication);
  const plugins = application.plugins.map((plugin) => ({ ...plugin,
    capabilities: [{ id: 'shared', version: '1', provider: plugin.id, requirements: [] }] }));
  assert.throws(() => resolveProfile({ ...application, plugins }, 'c2forge'), { code: 'BindingConflict' });
});

test('an aspect-only Session is allowed', () => {
  const result = resolveProfile({ ...c2AnalysisApplication, profiles: [
    { id: 'observe', aspects: ['postmortem'], requirements: [] },
  ] }, 'observe');
  assert.equal(result.plugins.length, 1);
});
