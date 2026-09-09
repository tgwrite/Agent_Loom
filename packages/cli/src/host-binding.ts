import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { ContainerFailure } from '../../container-core/src/index.ts';
import type { LocalTaskStore } from '../../container-core/src/index.ts';

/** Local executable binding, separate from the portable Application definition. */
export async function saveHostBinding(store: LocalTaskStore, module: string): Promise<void> {
  await writeFile(join(store.taskRoot, '.agent-loom', 'native-host.json'), JSON.stringify({
    schema_version: 1, task_id: store.task.id, module,
  }) + '\n', { flag: 'wx' });
}

export async function readHostBinding(store: LocalTaskStore): Promise<string | undefined> {
  let raw;
  try { raw = await readFile(join(store.taskRoot, '.agent-loom', 'native-host.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const value = JSON.parse(raw);
    if (value.schema_version !== 1 || value.task_id !== store.task.id || typeof value.module !== 'string'
      || !isAbsolute(value.module)) throw new Error();
    return value.module;
  } catch { throw new ContainerFailure('NativeIntegrationNotReady', 'Local native Host binding is malformed.'); }
}
