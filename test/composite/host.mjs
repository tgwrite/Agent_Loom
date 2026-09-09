import { join } from 'node:path';
import { createPiApplicationHost } from '../../packages/runtime-pi/src/index.ts';
import { readJson } from '../lightweight/native-runtime.mjs';
import { setup } from './setup.mjs';
export { validateNativeApplication } from './setup.mjs';
export async function createSessionHost({ store }) {
  const config = await readJson(join(store.taskRoot, 'web-input.local.json'));
  return createPiApplicationHost({ store, ...await setup(store.taskRoot, config) });
}
