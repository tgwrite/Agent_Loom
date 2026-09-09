#!/usr/bin/env node
try {
  const { main } = await import('../dist/packages/cli/src/index.js');
  process.exitCode = await main(process.argv.slice(2));
} catch {
  console.error('Unable to load Loom. Run npm run build before using this checkout.');
  process.exitCode = 1;
}
