import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { ContainerFailure, LocalTaskStore } from '../../container-core/src/index.ts';
import { identifier } from '../../container-core/src/storage/validation.ts';

/** Local convenience index only. Task metadata remains authoritative in its Task root. */
export class TaskCatalog {
  readonly #directory: string;

  constructor(stateDirectory = process.env.LOOM_STATE_DIR ?? join(homedir(), '.agent-loom')) {
    this.#directory = join(resolve(stateDirectory), 'tasks');
  }

  async register(store: LocalTaskStore): Promise<void> {
    identifier(store.task.id);
    await mkdir(this.#directory, { recursive: true });
    const file = join(this.#directory, `${store.task.id}.json`);
    const record = { schema_version: 1, task_id: store.task.id, task_root: store.taskRoot };
    try {
      await writeFile(file, `${JSON.stringify(record)}\n`, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const existing = await this.#read(store.task.id);
        if (existing.task_root === store.taskRoot) return;
        throw new ContainerFailure('BindingConflict', 'Task name is already registered. Use a unique name or an explicit Task root.');
      }
      throw new ContainerFailure('StorageFailure', 'Unable to register the local Task. The Task root remains available explicitly.');
    }
  }

  async ensureAvailable(taskId: string): Promise<void> {
    identifier(taskId);
    try {
      await this.#read(taskId);
    } catch (error) {
      if (error instanceof ContainerFailure && error.code === 'TaskNotFound') return;
      throw error;
    }
    throw new ContainerFailure('BindingConflict', 'Task name is already registered. Choose a unique name.');
  }

  async open(taskId: string, explicitRoot?: string): Promise<LocalTaskStore> {
    identifier(taskId);
    const root = explicitRoot === undefined ? (await this.#read(taskId)).task_root : resolve(explicitRoot);
    const store = await LocalTaskStore.open(root);
    if (store.task.id !== taskId) throw new ContainerFailure('InvalidRecord', 'Task identity does not match its locator.');
    return store;
  }

  async #read(taskId: string): Promise<{ task_id: string; task_root: string }> {
    let content: string;
    try {
      content = await readFile(join(this.#directory, `${taskId}.json`), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ContainerFailure('TaskNotFound', 'Task is not in the local index. Supply --root to open it explicitly.');
      }
      throw new ContainerFailure('StorageFailure', 'Unable to read the local Task index.');
    }
    try {
      const value = JSON.parse(content) as Record<string, unknown>;
      if (value.schema_version !== 1 || value.task_id !== taskId
        || typeof value.task_root !== 'string' || !isAbsolute(value.task_root)) throw new Error();
      return { task_id: taskId, task_root: value.task_root };
    } catch {
      throw new ContainerFailure('StorageFailure', 'Local Task locator is malformed.');
    }
  }
}
