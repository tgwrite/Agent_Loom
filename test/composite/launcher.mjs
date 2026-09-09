import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { here as lightweight } from '../lightweight/native-runtime.mjs';

export const here = fileURLToPath(new URL('.', import.meta.url));
export async function launcher(root) {
  const bin = join(root, 'bin');
  await mkdir(bin, { recursive: true });
  if (process.platform === 'win32') {
    const compiler = join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    await new Promise((done, fail) => {
      const child = spawn(compiler, ['/nologo', '/target:exe', `/out:${join(bin, 'pi.exe')}`, join(here, 'pi-launcher.cs')],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('error', fail);
      child.on('close', code => code === 0 ? done() : fail(new Error('Local Pi launcher compilation failed')));
    });
  } else await writeFile(join(bin, 'pi'), '#!/bin/sh\nexec "$LOOM_TEST_NODE" "$LOOM_TEST_PI_CLI" "$@"\n', { mode: 0o755 });
  assert(process.execPath);
  return { PATH: bin + delimiter + process.env.PATH, LOOM_TEST_NODE: process.execPath,
    LOOM_TEST_PI_CLI: join(lightweight, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js') };
}
