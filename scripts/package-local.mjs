// Build a fresh, allowlisted local candidate. This script never publishes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { inspectText } from './privacy-rules.mjs';

const repo = resolve(import.meta.dirname, '..');
const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
await mkdir(join(repo, '.test-tmp/packages'), { recursive: true });
await mkdir(join(repo, 'local/packages'), { recursive: true });
const scratch = await mkdtemp(join(repo, '.test-tmp/packages/build-'));
const compiled = join(scratch, 'compiled'), stage = join(scratch, 'package');
await mkdir(stage);
const run = (args, cwd) => {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, npm_config_cache: join(scratch, 'npm-cache') }, timeout: 120000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  return result.stdout;
};
run([join(repo, 'node_modules/typescript/bin/tsc'), '-p', join(repo, 'tsconfig.build.json'), '--outDir', compiled], repo);
const expected = new Map();
async function include(source, destination) {
  const bytes = await readFile(source);
  assert.deepEqual(inspectText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), [], `Package privacy: ${destination}`);
  await mkdir(dirname(join(stage, destination)), { recursive: true });
  await copyFile(source, join(stage, destination)); expected.set(destination, bytes);
}
async function includeTree(root, prefix) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) await includeTree(join(root, entry.name), `${prefix}/${entry.name}`);
    else { assert(entry.isFile() && /\.(?:js|d\.ts)$/.test(entry.name)); await include(join(root, entry.name), `${prefix}/${entry.name}`); }
  }
}
for (const component of ['container-core', 'runtime-pi', 'cli'])
  await includeTree(join(compiled, 'packages', component, 'src'), `dist/packages/${component}/src`);
for (const [source, destination] of [
  ['bin/loom.mjs', 'bin/loom.mjs'], ['packaging/README.md', 'README.md'], ['packaging/INSTALL.md', 'INSTALL.md'],
  ['packaging/example.mjs', 'examples/minimal/example.mjs'], ['LICENSE', 'LICENSE'], ['NOTICE', 'NOTICE'],
  ['packaging/AGENT_GUIDE.md', 'AGENT_GUIDE.md'],
]) await include(join(repo, source), destination);
for (const name of ['domains.mjs', 'measurement.mjs', 'catalog.mjs', 'measurement.json', 'catalog.json', 'host.mjs', 'synthetic-sdk.mjs'])
  await include(join(repo, 'packaging/integration', name), `examples/integration/${name}`);
const manifest = Object.fromEntries(['name', 'version', 'description', 'license', 'type', 'engines', 'bin', 'exports'].map(key => [key, metadata[key]]));
manifest.private = true;
manifest.files = ['bin/', 'dist/', 'examples/', 'README.md', 'INSTALL.md', 'AGENT_GUIDE.md', 'LICENSE', 'NOTICE'];
const manifestPath = join(scratch, 'manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await include(manifestPath, 'package.json');
const output = await mkdtemp(join(repo, 'local/packages/candidate-'));
assert(process.env.npm_execpath, 'Run with npm run package:local so the active npm CLI is explicit.');
const packed = JSON.parse(run([process.env.npm_execpath, 'pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', output], stage))[0];
const archive = join(output, packed.filename), bytes = await readFile(archive);
// Inspect actual tar members, not just staging files. Accept only ordinary portable files.
const tar = gunzipSync(bytes), seen = new Set();
const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
  const name = field(header, 0, 100), prefix = field(header, 345, 155), type = field(header, 156, 1);
  const size = Number.parseInt(field(header, 124, 12).trim(), 8);
  assert(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
  assert(!prefix && (type === '0' || type === '') && name.startsWith('package/'), 'Unexpected tar entry');
  assert.equal(field(header, 265, 32), ''); assert.equal(field(header, 297, 32), '');
  assert.equal(Number.parseInt(field(header, 108, 8).trim(), 8) || 0, 0);
  assert.equal(Number.parseInt(field(header, 116, 8).trim(), 8) || 0, 0);
  const path = name.slice('package/'.length); assert(!seen.has(path)); seen.add(path);
  assert(expected.has(path), `Unexpected package member: ${path}`);
  assert(tar.subarray(offset + 512, offset + 512 + size).equals(expected.get(path)), `Packaged bytes changed: ${path}`);
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(seen.size, expected.size);
const sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(join(output, 'SHA256SUMS'), `${sha256}  ${packed.filename}\n`, { flag: 'wx' });
await copyFile(join(stage, 'INSTALL.md'), join(output, 'INSTALL.md'));
await writeFile(join(scratch, 'package.local.json'), JSON.stringify({ archive, sha256, members: [...seen].sort() }, null, 2));
console.log(JSON.stringify({ package: relative(repo, archive), sha256, files: seen.size, bytes: bytes.length, published: false }));
