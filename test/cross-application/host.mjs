import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createPiApplicationHost } from '../../packages/runtime-pi/src/index.ts';
import { readJson } from '../lightweight/native-runtime.mjs';
import { localAdapter } from './local-adapter.mjs';
import { pipelineAdapters } from './pipeline-adapters.mjs';
import { setup } from './setup.mjs';

export async function validateNativeApplication({ application }) {
  assert.equal(application.runtime.version, '0.85.1');
  const adapters = { 'local-json': localAdapter({}), ...pipelineAdapters({}) };
  for (const plugin of application.plugins.filter(p => p.role === 'domain'))
    assert((await stat(adapters[plugin.native.binding_key].entry)).isFile());
}
export async function createSessionHost({ store }) {
  return createPiApplicationHost({ store, ...await setup(store.taskRoot, await readJson(join(store.taskRoot, 'web-input.local.json'))) });
}
