#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--version') {
    console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
  } else {
    const { main } = await import('../dist/packages/cli/src/index.js');
    process.exitCode = await main(args);
  }
} catch {
  console.error('Unable to load Loom. Reinstall the package; source checkouts require npm run build.');
  process.exitCode = 1;
}
