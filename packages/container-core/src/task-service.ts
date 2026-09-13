import { randomUUID } from 'node:crypto';
import type { ApplicationDefinition } from './application/index.ts';
import type { TaskRecord } from './task/index.ts';
import { LocalTaskStore } from './storage/index.ts';

/** Create a fixed Application snapshot; never reinterpret an existing store. */
export async function createTask(options: { taskRoot: string; application: ApplicationDefinition; title: string; taskId?: string }): Promise<TaskRecord> {
  const store = await LocalTaskStore.create(options.taskRoot, { schema_version: 3,
    id: options.taskId ?? randomUUID(), application_id: options.application.id,
    application: options.application, title: options.title, created_at: new Date().toISOString() });
  return store.task;
}
