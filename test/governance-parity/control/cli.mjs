import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ControlStore, requireValue } from './store.mjs';
import { prepare, execute } from './runtime.mjs';
import { setup } from '../native-setup.mjs';
const [operation, rootArg, taskId, profileId, appFile] = process.argv.slice(2), root = resolve(rootArg);
try {
  if (operation === 'create') {
    const { application } = await import(pathToFileURL(resolve(appFile)));
    await ControlStore.create(root, { schema_version: 2, id: taskId, application_id: application.id, application,
      title: 'Synthetic native parity', created_at: new Date().toISOString() });
    console.log(JSON.stringify({ task: taskId }));
  } else {
    const store = await ControlStore.open(root); requireValue(store.task.id === taskId);
    if (operation === 'inspect') console.log(JSON.stringify(await store.inspect()));
    else {
      requireValue(operation === 'start');
      const config = JSON.parse(await readFile(join(root, 'web-input.local.json')));
      const result = await execute(store, await prepare(store, profileId), await setup(root, config));
      console.log(JSON.stringify({ status: result.status, session: result }));
    }
  }
} catch (error) { console.error(JSON.stringify({ error: { code: error.code ?? 'NativeExecutionFailed' } })); process.exitCode = 1; }
