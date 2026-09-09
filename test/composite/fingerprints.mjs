import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '../lightweight/handoff.mjs';
import { here } from './launcher.mjs';

// Whole installed package trees, excluding nested dependencies; raw file paths
// stay local. This detects mutations made during the experimental run.
export async function nativeFingerprints() {
  const packages = ['pi-http-util', '@jakeryderv/pi-artifacts', '@spences10/pi-telemetry', 'pi-conversation-retro'];
  return Object.fromEntries(await Promise.all(packages.map(async name => {
    const root = join(here, name === 'pi-conversation-retro' ? 'node_modules' : '../lightweight/node_modules', name);
    async function walk(relative = '') {
      const entries = await readdir(join(root, relative), { withFileTypes: true });
      const lists = await Promise.all(entries.filter(e => !['node_modules', '.git'].includes(e.name)).map(async entry => {
        const file = relative ? `${relative}/${entry.name}` : entry.name;
        return entry.isDirectory() ? walk(file) : [[file, sha256(await readFile(join(root, file)))]];
      }));
      return lists.flat();
    }
    const files = (await walk()).sort(([a], [b]) => a.localeCompare(b));
    return [name, { version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
      files: files.length, sha256: sha256(JSON.stringify(files)) }];
  })));
}
