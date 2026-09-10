import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { runGuarantees } from './guarantees.mjs';
const base = '.test-tmp/governance-parity'; await mkdir(base, { recursive: true });
const root = await mkdtemp(join(base, 'parity-'));
const results = await runGuarantees(root, process.env.PARITY_ARM ? [process.env.PARITY_ARM] : undefined, process.env.PARITY_FILTER ?? '');
const summary = Object.fromEntries([...new Set(results.map(r => r.arm))].map(arm => [arm, {
  cases: results.filter(r => r.arm === arm).length, passed: results.filter(r => r.arm === arm && r.passed).length,
  guarantees: Object.fromEntries([...new Set(results.map(r => r.guarantee))].map(g => [g, results.filter(r => r.arm === arm && r.guarantee === g).every(r => r.passed)])),
}]));
await writeFile(join(root, 'summary.local.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ output: relative('.', root), summary }));
process.exitCode = results.every(r => r.passed) ? 0 : 1;
