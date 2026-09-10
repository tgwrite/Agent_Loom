import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { sha256 } from '../lightweight/handoff.mjs';
export async function inventory() {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--',
    'packages', 'adapters', 'bin', 'scripts', 'tests', 'test', 'examples', 'package.json', 'tsconfig.json', 'tsconfig.build.json'],
  { encoding: 'utf8', windowsHide: true }).trim().split('\n').filter(p => p && !p.includes('/mutations/'));
  return Object.fromEntries(await Promise.all(paths.sort().map(async p => [p, sha256(await readFile(p))])));
}
if (process.argv[1]?.endsWith('freeze.mjs')) {
  const [parityFile, nativeFile] = process.argv.slice(2);
  const parity = JSON.parse(await readFile(parityFile)), native = JSON.parse(await readFile(nativeFile));
  if (!['loom', 'control'].every(a => parity[a]?.passed === parity[a]?.cases && Object.keys(parity[a].guarantees).length === 18
    && Object.values(parity[a].guarantees).every(Boolean)) || native.status !== 'passed' || native.results.length !== 42) throw new Error('Parity gate not satisfied');
  const files = await inventory();
  await writeFile('.test-tmp/governance-parity/frozen.local.json', JSON.stringify({ timestamp: new Date().toISOString(),
    baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
    parityFile, nativeFile, files, digest: sha256(JSON.stringify(files)) }, null, 2));
  console.log('Parity implementation, tests and native evidence frozen.');
}
