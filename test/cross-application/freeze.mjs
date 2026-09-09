import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../lightweight/handoff.mjs';

export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const baseline = '366d110';
const prior = ['test/lightweight', 'test/composite', 'test/reuse'];
export const production = ['packages/container-core', 'packages/runtime-pi', 'packages/cli'];
export function freeze(phase) {
  const paths = phase === 'a' ? [...production, ...prior] : prior;
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(git(['diff', '--name-only', baseline, '--', ...paths]), '', 'Primitive Gap: frozen source changed');
  assert.equal(git(['ls-files', '--others', '--exclude-standard', '--', ...paths]), '', 'Primitive Gap: frozen source added');
  return { baseline, frozen_paths: paths, diff: 0 };
}
export async function integrationHashes() {
  const files = ['json-native.ts', 'local-adapter.mjs', 'pipeline-adapters.mjs', 'decisions.mjs',
    'setup.mjs', 'host.mjs', 'local.application.mjs', 'pipeline.application.mjs'];
  return Object.fromEntries(await Promise.all(files.map(async file => [file,
    sha256(await readFile(new URL(file, import.meta.url)))])));
}
export async function marketHashes() {
  const names = ['@artale/pi-json', '@trycedar/pi-mdiff', 'pi-web-utils', 'pi-markdown-preview'];
  return Object.fromEntries(await Promise.all(names.map(async name => {
    const root = fileURLToPath(new URL(`node_modules/${name}/`, import.meta.url));
    async function walk(dir = '') {
      const entries = await readdir(join(root, dir), { withFileTypes: true });
      return (await Promise.all(entries.filter(e => !['node_modules', '.git'].includes(e.name)).map(async entry => {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        return entry.isDirectory() ? walk(path) : [[path, sha256(await readFile(join(root, path)))]];
      }))).flat();
    }
    return [name, { version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
      sha256: sha256(JSON.stringify((await walk()).sort(([a], [b]) => a.localeCompare(b)))) }];
  })));
}
