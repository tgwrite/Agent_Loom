import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discover(path) : /\.test\.(ts|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const files = [...discover('tests'), 'test/lightweight/handoff.test.mjs'].sort();
if (files.length === 0) throw new Error('No behavioral tests were discovered.');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
