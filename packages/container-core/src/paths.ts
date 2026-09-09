import { isAbsolute, join, win32 } from 'node:path';
import { ContainerFailure } from './failure/index.ts';

export function taskRelativePath(value: unknown, allowRoot = false): asserts value is string {
  if (allowRoot && value === '.') return;
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value) || win32.isAbsolute(value)
    || /[\\:\x00-\x1f]/.test(value) || value.split('/').some((part) =>
      !part || part === '.' || part === '..' || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    throw new ContainerFailure('InvalidRecord', 'Path must be relative to the Task root.');
  }
}

export function resolveTaskPath(taskRoot: string, path: string): string {
  taskRelativePath(path, true);
  return join(taskRoot, path);
}
