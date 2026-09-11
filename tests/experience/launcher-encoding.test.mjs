import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launcher } from '../../test/composite/launcher.mjs';

test('compiled Windows launcher preserves UTF-8 in both streams, arguments and trace files',
  { skip: process.platform !== 'win32' }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'loom-unicode-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const env = await launcher(root);
    const script = join(root, 'child.mjs');
    const text = '中文复盘 — 报告 → 正确 ✓';
    await writeFile(script, 'process.stdout.write(process.argv[2]); process.stderr.write(process.argv[2]); process.exitCode = 7;');
    const result = spawnSync(join(root, 'bin/pi.exe'), [text], { encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: { ...process.env, ...env, LOOM_TEST_PI_CLI: script, LOOM_TEST_CHILD_TRACE: root } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 7);
    assert.equal(result.stdout, text);
    assert.equal(result.stderr, text);
    const traces = (await readdir(root)).filter(name => name.endsWith('.local.txt'));
    assert.equal(traces.length, 1);
    const trace = await readFile(join(root, traces[0]), 'utf8');
    assert.equal(trace, `Exit: 7\nSTDOUT\n${text}\nSTDERR\n${text}`);
  });
