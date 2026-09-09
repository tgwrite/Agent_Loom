import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../lightweight/handoff.mjs';

export const baseline = '44fd7f2';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const protectedPaths = ['packages/container-core', 'packages/runtime-pi', 'packages/cli', 'test/lightweight', 'test/composite'];
export function freeze() {
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(git(['diff', '--name-only', baseline, '--', ...protectedPaths]), '', 'Primitive Gap: frozen baseline changed');
  assert.equal(git(['ls-files', '--others', '--exclude-standard', '--', ...protectedPaths]), '', 'Primitive Gap: new file under frozen baseline');
  return { baseline, production_diff: 0, existing_integration_diff: 0,
    protected_files: git(['ls-tree', '-r', '--name-only', baseline, '--', ...protectedPaths]).split('\n').length };
}
export async function auditFingerprint() {
  return sha256(await readFile(new URL('./native/session-audit.mjs', import.meta.url)));
}
