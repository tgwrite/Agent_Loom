import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ContainerFailure, resolveTaskPath, taskRelativePath } from '../../container-core/src/index.ts';
import type { ArtifactRef, ArtifactRequirement } from '../../container-core/src/index.ts';
import type { PiApplicationContext } from './application-host.ts';

/** Read exactly the selected reference and bytes. Domain verification remains mandatory.
 * This helper never resolves an alternative, publishes, or records consumption. */
export async function readArtifactFile<T>(context: PiApplicationContext, artifact: ArtifactRef,
  requirement: ArtifactRequirement & { producer_plugin_id?: string },
  verify: (bytes: Uint8Array, artifact: ArtifactRef) => T | Promise<T>): Promise<T> {
  const ref = structuredClone(artifact);
  const reject = (check: string): never => { throw new ContainerFailure('InvalidRecord',
    'Artifact input was rejected.', { phase: 'artifact-input', check, artifact_id: ref.id }); };
  // Identity comparison uses the complete reference supplied in this Session plan.
  if (ref.task_id !== context.task_id || context.plan.task_id !== context.task_id
    || !context.plan.artifacts.some(selected => isDeepStrictEqual(selected, ref))) reject('selected-reference');
  if (ref.type !== requirement.type || ref.version !== requirement.version
    || ref.verification.status !== requirement.verification_status
    || (requirement.artifact_id !== undefined && ref.id !== requirement.artifact_id)
    || (requirement.producer_plugin_id !== undefined && ref.producer.plugin_id !== requirement.producer_plugin_id)) reject('contract');
  if (ref.payload_ref.kind !== 'file') return reject('file-reference');
  let bytes: Uint8Array;
  try {
    const path = await realpath(resolveTaskPath(context.task_root, ref.payload_ref.path));
    taskRelativePath(relative(await realpath(context.task_root), path).replaceAll('\\', '/'));
    bytes = await readFile(path);
  } catch { return reject('file-location'); }
  if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) reject('digest');
  // Rejection propagates to the initializer; Core records no successful consumption.
  return verify(bytes, ref);
}

/** CLI --input snapshot. The application parser owns structure and domain semantics. */
export async function readTaskInput<T>(context: { taskRoot: string },
  parse: (value: unknown) => T | Promise<T>): Promise<T> {
  let value: unknown;
  try {
    const path = await realpath(resolveTaskPath(context.taskRoot, '.agent-loom/input.json'));
    taskRelativePath(relative(await realpath(context.taskRoot), path).replaceAll('\\', '/'));
    const bytes = await readFile(path);
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ContainerFailure('InvalidRecord', 'Task input snapshot is missing or invalid.', { check: 'task-input' });
  }
  return parse(value);
}
