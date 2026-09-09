import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createPiApplicationHost } from '../../packages/runtime-pi/src/index.ts';
import { nativeRuntime, readJson, here } from './native-runtime.mjs';
import { webAdapters } from './web-adapters.mjs';

export async function validateNativeApplication({ application }) {
  const version = (await readJson(join(here, 'node_modules/@earendil-works/pi-coding-agent/package.json'))).version;
  assert.equal(application.runtime.id, 'pi');
  assert.equal(application.runtime.version, version);
  const adapters = webAdapters({});
  for (const plugin of application.plugins) assert((await stat(adapters[plugin.native.binding_key].entry)).isFile());
}

export async function createSessionHost({ store }) {
  const config = await readJson(join(store.taskRoot, 'web-input.local.json'));
  const runtime = await nativeRuntime(store.taskRoot, config);
  return createPiApplicationHost({ store, ...runtime, adapters: webAdapters(config) });
}
