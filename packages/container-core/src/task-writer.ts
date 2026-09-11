import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContainerFailure } from './failure/index.ts';
import { GOVERNANCE_DIRECTORY } from './storage/index.ts';
import type { LocalTaskStore } from './storage/index.ts';

/** Cooperative local lock. No PID guessing, lease expiry, waiting or stale-lock removal. */
export async function withTaskWriter<T>(store: LocalTaskStore, operation: () => Promise<T>): Promise<T> {
  const path = join(store.taskRoot, GOVERNANCE_DIRECTORY, 'writer.lock');
  const owner = `${randomUUID()}\n`;
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ContainerFailure('TaskWriterBusy', 'Another writer or an unreconciled writer lock exists.');
    throw new ContainerFailure('StorageFailure', 'Unable to acquire the Task writer lock.');
  }
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    try { await handle.writeFile(owner, 'utf8'); await handle.sync(); }
    catch { throw new ContainerFailure('StorageFailure', 'Unable to persist Task writer ownership.'); }
    result = await operation();
  } catch (error) { failed = true; failure = error; }
  let releaseFailed = false;
  try {
    await handle.close();
    if (await readFile(path, 'utf8') !== owner) throw new Error();
    await unlink(path);
  } catch { releaseFailed = true; }
  // Preserve the operation failure; an uncertain lock remains for explicit local reconciliation.
  if (failed) throw failure;
  if (releaseFailed) throw new ContainerFailure('TaskWriterReleaseFailed', 'Task writer ownership could not be safely released.');
  return result as T;
}
