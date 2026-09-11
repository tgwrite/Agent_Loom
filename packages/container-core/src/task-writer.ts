import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContainerFailure } from './failure/index.ts';
import { GOVERNANCE_DIRECTORY } from './storage/index.ts';
import type { LocalTaskStore } from './storage/index.ts';
import { validateRequest } from './invocation.ts';

export interface TaskWriterLease {
  /** Keep the durable lock after this callback, including if it throws. */
  retainOnExit(): void;
  /** Permit cleanup on callback exit; this does not release the lock immediately. */
  releaseOnExit(): void;
}

/** Cooperative local lock. No PID guessing, lease expiry, waiting or stale-lock removal. */
export async function withTaskWriter<T>(store: LocalTaskStore, operation: (lease: TaskWriterLease) => Promise<T>,
  correlation?: { request_id: string; entry_id: string }): Promise<T> {
  const path = join(store.taskRoot, GOVERNANCE_DIRECTORY, 'writer.lock');
  if (correlation) validateRequest({ schema_version: 1, task_id: store.task.id,
    request_id: correlation.request_id, entry_id: correlation.entry_id });
  const owner = JSON.stringify({ schema_version: 1, owner: randomUUID(), task_id: store.task.id,
    ...(correlation ? { request_id: correlation.request_id, entry_id: correlation.entry_id } : {}) }) + '\n';
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ContainerFailure('TaskWriterBusy', 'Another writer or an unreconciled writer lock exists.');
    throw new ContainerFailure('StorageFailure', 'Unable to acquire the Task writer lock.');
  }
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  let release = true;
  let active = true;
  const setRelease = (value: boolean) => {
    if (!active) throw new ContainerFailure('InvalidTransition', 'Task writer callback has already exited.');
    release = value;
  };
  const lease: TaskWriterLease = { retainOnExit: () => setRelease(false), releaseOnExit: () => setRelease(true) };
  try {
    try { await handle.writeFile(owner, 'utf8'); await handle.sync(); }
    catch { throw new ContainerFailure('StorageFailure', 'Unable to persist Task writer ownership.'); }
    result = await operation(lease);
  } catch (error) { failed = true; failure = error; }
  active = false;
  let releaseFailed = false;
  try {
    await handle.close();
    if (release) {
      if (await readFile(path, 'utf8') !== owner) throw new Error();
      await unlink(path);
    }
  } catch { releaseFailed = true; }
  // Preserve the operation failure; an uncertain lock remains for explicit local reconciliation.
  if (failed) throw failure;
  if (releaseFailed) throw new ContainerFailure('TaskWriterReleaseFailed', 'Task writer ownership could not be safely released.');
  return result as T;
}
