import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPiApplicationHost } from '../../packages/runtime-pi/src/index.ts';
import { setup } from './native-setup.mjs';
export async function createSessionHost({ store }) {
  return createPiApplicationHost({ store, ...await setup(store.taskRoot, JSON.parse(await readFile(join(store.taskRoot, 'web-input.local.json')))) });
}
