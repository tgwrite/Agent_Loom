import { stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nativeRuntime, readJson, here as lightweight } from '../lightweight/native-runtime.mjs';
import { webAdapters } from '../lightweight/web-adapters.mjs';
import { join } from 'node:path';
import { retroAdapter } from './retro-adapter.mjs';
import { instrument } from './instrumentation.mjs';

export async function validateNativeApplication({ application }) {
  const sdk = await readJson(join(lightweight, 'node_modules/@earendil-works/pi-coding-agent/package.json'));
  const adapters = { ...webAdapters({}), retro: retroAdapter({}) };
  assert.equal(sdk.version, application.runtime.version);
  for (const plugin of application.plugins) assert((await stat(adapters[plugin.native.binding_key].entry)).isFile());
}

// Identical runtime, native adapters and instrumentation for Loom and control.
export async function setup(root, config) {
  const runtime = await nativeRuntime(root, config);
  const adapters = { ...webAdapters(config), retro: retroAdapter(config) };
  const observations = new WeakMap();
  for (const id of ['http-util', 'artifacts']) {
    const run = adapters[id].run;
    adapters[id].run = async (session, context) => {
      observations.set(session, instrument(session, context));
      return run(session, context);
    };
  }
  const afterRun = adapters.retro.afterRun;
  adapters.retro.afterRun = (session, context) => observations.get(session).checkReview(() => afterRun(session, context));
  return { ...runtime, adapters };
}
