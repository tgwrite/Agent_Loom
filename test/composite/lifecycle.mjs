import { stat } from 'node:fs/promises';
import { join } from 'node:path';

// Check before opening fixture/provider servers, including direct script usage.
export async function requireBuild(repo) {
  const built = await stat(join(repo, 'dist/packages/cli/src/index.js')).catch(() => null);
  if (!built?.isFile()) throw new Error('Composite requires a built Loom CLI. Run npm run build before retrying.');
}

// Each cleanup must run even if the operation or another cleanup fails.
export async function withCleanup(operation, cleanups) {
  let result, failed = false;
  const errors = [];
  try { result = await operation(); }
  catch (error) { failed = true; errors.push(error); }
  for (const cleanup of cleanups) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors,
    failed ? 'Composite operation failed; additional cleanup failures were recorded.' : 'Composite cleanup failed.',
    { cause: errors[0] });
  return result;
}

export function failureText(error) {
  const summary = String(error?.stack ?? error);
  return error instanceof AggregateError
    ? summary + '\n' + error.errors.map((item, index) => `Failure ${index + 1}:\n${failureText(item)}`).join('\n')
    : summary;
}
