import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, copyFile, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { requireBuild, withCleanup, failureText } from '../../test/composite/lifecycle.mjs';

async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'loom-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function child(args, options = {}) {
  return new Promise((done, fail) => {
    const process = spawn(globalThis.process.execPath, args, { windowsHide: true, ...options });
    let stdout = '', stderr = '', timedOut = false;
    process.stdout.setEncoding('utf8'); process.stderr.setEncoding('utf8');
    process.stdout.on('data', value => stdout += value);
    process.stderr.on('data', value => stderr += value);
    const timer = setTimeout(() => { timedOut = true; process.kill(); }, 10000);
    process.on('error', error => { clearTimeout(timer); fail(error); });
    process.on('close', code => { clearTimeout(timer); done({ code, stdout, stderr, timedOut }); });
  });
}

test('missing or invalid CLI build fails before experimental setup', async t => {
  const root = await scratch(t);
  await assert.rejects(requireBuild(root), /npm run build/);
  await mkdir(join(root, 'dist/packages/cli/src/index.js'), { recursive: true });
  await assert.rejects(requireBuild(root), /npm run build/);
});

test('failed operations and diagnostics still release every resource and preserve the original cause', async () => {
  const original = new Error('Synthetic command failed');
  const diagnostic = new Error('Synthetic diagnostic write failed');
  const closed = [];
  await assert.rejects(withCleanup(async () => { throw original; }, [
    async () => { throw diagnostic; }, async () => { closed.push('review'); }, async () => { closed.push('fixture'); },
  ]), error => {
    assert.equal(error.cause, original);
    assert.deepEqual(error.errors, [original, diagnostic]);
    assert(failureText(error).includes(original.message));
    assert(failureText(error).includes(diagnostic.message));
    return true;
  });
  assert.deepEqual(closed, ['review', 'fixture']);
  await assert.rejects(withCleanup(async () => { throw original; }, [async () => {}]), error => error === original);
  await assert.rejects(withCleanup(async () => 'success', [async () => { throw diagnostic; }]), error => error === diagnostic);
});

test('Task creation and diagnostic failure exit without a live provider or forced process exit', async t => {
  const root = await scratch(t);
  const source = `
    import { writeFile } from 'node:fs/promises';
    import { provider } from ${JSON.stringify(pathToFileURL(resolve('test/composite/provider.mjs')).href)};
    import { withCleanup, failureText } from ${JSON.stringify(pathToFileURL(resolve('test/composite/lifecycle.mjs')).href)};
    const review = await provider();
    try {
      await withCleanup(async () => { throw new Error('SYNTHETIC_CREATE_FAILURE'); }, [
        () => writeFile('absent-task/diagnostic.json', '{}'), () => review.close(),
      ]);
    } catch (error) { console.error(failureText(error)); process.exitCode = 1; }
  `;
  const result = await child(['--input-type=module', '-e', source], { cwd: root });
  assert.equal(result.timedOut, false, 'Provider leaked and required forced termination');
  assert.equal(result.code, 1);
  assert(result.stderr.includes('SYNTHETIC_CREATE_FAILURE'));
  assert(result.stderr.includes('ENOENT'));
});

test('actual composite entry fails early without a build and preserves a failed CLI command after services start', async t => {
  const root = await scratch(t);
  const composite = join(root, 'test/composite'), lightweight = join(root, 'test/lightweight');
  await mkdir(composite, { recursive: true }); await mkdir(lightweight, { recursive: true });
  for (const file of ['run.mjs', 'provider.mjs', 'lifecycle.mjs']) await copyFile(resolve('test/composite', file), join(composite, file));
  for (const file of ['handoff.mjs', 'native-runtime.mjs']) await copyFile(resolve('test/lightweight', file), join(lightweight, file));
  // This fault fixture exercises the real driver and provider, without native plugins or a model.
  await writeFile(join(composite, 'launcher.mjs'), 'export const here = import.meta.dirname; export async function launcher() { return {}; }');
  await writeFile(join(composite, 'fingerprints.mjs'), 'export async function nativeFingerprints() { return {}; }');
  const args = [join(composite, 'run.mjs'), '--smoke'];
  let result = await child(args, { cwd: root });
  assert.equal(result.timedOut, false);
  assert.equal(result.code, 1);
  assert(result.stderr.includes('npm run build'));
  await assert.rejects(stat(join(root, '.test-tmp')), { code: 'ENOENT' });
  if (process.platform !== 'win32') return; // The actual composite runner is Windows-only.
  await mkdir(join(root, 'dist/packages/cli/src'), { recursive: true });
  await writeFile(join(root, 'dist/packages/cli/src/index.js'), '');
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'bin/loom.mjs'), 'console.error("SYNTHETIC_CLI_CREATE_FAILURE"); process.exitCode = 1;');
  for (const file of ['application.mjs', 'host.mjs', 'web-adapters.mjs', 'telemetry.mjs', 'scripted.mjs']) await writeFile(join(lightweight, file), '');
  result = await child(args, { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: join(root, 'unused-config') } });
  assert.equal(result.timedOut, false, 'Actual driver leaked a server');
  assert.equal(result.code, 1);
  assert(result.stderr.includes('SYNTHETIC_CLI_CREATE_FAILURE'));
  const runs = await readdir(join(root, '.test-tmp/composite'));
  assert.equal(runs.length, 1);
  const evidence = join(root, '.test-tmp/composite', runs[0]);
  const failure = await readFile(join(evidence, 'failure.local.txt'), 'utf8');
  assert(failure.includes('SYNTHETIC_CLI_CREATE_FAILURE'));
  assert(!failure.includes('ENOENT'), 'Cleanup replaced the original error');
  assert((await readdir(evidence)).some(name => name.endsWith('-review-requests.local.json')));
  await assert.rejects(stat(join(evidence, 'loom-forward-telemetry-0-retro-0')), { code: 'ENOENT' });
});
