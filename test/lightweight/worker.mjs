// Compatibility entry for the original integration harness; governance lives in Loom.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { LocalTaskStore, prepareSession, executeSession, inspectTask } from '../../packages/container-core/src/index.ts';
import { createPiApplicationHost } from '../../packages/runtime-pi/src/index.ts';
import { nativeRuntime } from './native-runtime.mjs';
import { webAdapters } from './web-adapters.mjs';

const root = resolve(process.env.LOOM_TEST_TASK_ROOT);
const profile = process.argv[2];
const store = await LocalTaskStore.open(root);
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const started = performance.now();
try {
  if (profile === 'inspect') {
    await writeJson(join(root, 'inspection.local.json'), await inspectTask(store));
  } else {
    const plan = await prepareSession(store, profile);
    const config = JSON.parse(await readFile(join(root, 'execution.local.json'), 'utf8'));
    const host = createPiApplicationHost({ store, ...await nativeRuntime(root, config), adapters: webAdapters(config) });
    const session = await executeSession(store, plan, host, { id: 'test-operator' });
    assert.equal(session.status, 'completed');
    await writeJson(join(root, `${profile}-timing.local.json`), { total_ms: performance.now() - started });
    console.log(JSON.stringify({ profile, status: session.status, session_id: session.id, mode: config.mode }));
  }
} catch (error) {
  await writeFile(join(root, `${profile}-failure.local.txt`), String(error?.stack ?? error));
  console.error(JSON.stringify({ profile, status: 'failed', code: error.code ?? 'NativeCheckFailed' }));
  process.exitCode = 1;
}
