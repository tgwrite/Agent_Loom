import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createPiApplicationHost } from '../../packages/runtime-pi/src/index.ts';
import { readJson } from '../lightweight/native-runtime.mjs';
import { validateNativeApplication as priorValidate } from '../composite/setup.mjs';
import { auditAdapter } from './audit-adapter.mjs';
import { setup } from './setup.mjs';

export async function validateNativeApplication({ application }) {
  await priorValidate({ application: { ...application, plugins: application.plugins.filter(p => p.id !== 'session-audit') } });
  assert((await stat(auditAdapter().entry)).isFile());
}
export async function createSessionHost({ store }) {
  const config = await readJson(join(store.taskRoot, 'web-input.local.json'));
  return createPiApplicationHost({ store, ...await setup(store.taskRoot, config) });
}
