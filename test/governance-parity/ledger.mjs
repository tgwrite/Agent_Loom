import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const git = args => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const loom = git(['ls-files', '--', 'packages/container-core/src', 'packages/runtime-pi/src', 'packages/cli/src']).split('\n');
const control = ['test/governance-parity/control/store.mjs', 'test/governance-parity/control/runtime.mjs', 'test/governance-parity/control/cli.mjs'];
async function size(files) {
  const rows = await Promise.all(files.map(async file => {
    const source = await readFile(file, 'utf8');
    return { file, physical_lines: source.trimEnd().split('\n').length, nonempty_lines: source.split('\n').filter(line => line.trim()).length };
  }));
  return { files: rows.length, physical_lines: rows.reduce((n, row) => n + row.physical_lines, 0), rows };
}
const responsibility = {
  observer: {
    loom: ['typed observer contract', 'runtime phase/class selection', 'event payload construction', 'persisted event shape validation'],
    control: ['runtime phase/class selection', 'event payload construction', 'persisted event shape validation'],
  },
  native_provenance: {
    loom: ['typed record/reference contract', 'runtime producer construction', 'record shape validation', 'session/role identity validation', 'record-to-reference field propagation'],
    control: ['runtime producer construction', 'record shape validation', 'session/role identity validation'],
  },
};
const ledger = { scope: 'Bounded parity, not full replacement of every Loom API or user interface',
  implementation: { loom: await size(loom), control: await size(control) },
  semantic_owners: { loom: 1, control: 1 }, responsibility,
  excluded_from_relative_owner_credit: ['shared domain digest acceptance', 'shared native setup', 'scripted providers', 'oracle and fault probes'],
  unmeasured: ['human review minutes', 'long-term incident probabilities', 'LLM quality', 'interactive DX', 'other runtimes'],
  production_diff: git(['diff', '--numstat', '--', 'packages']),
};
await writeFile('.test-tmp/governance-parity/ledger.local.json', JSON.stringify(ledger, null, 2));
console.log(JSON.stringify({ loom: ledger.implementation.loom.physical_lines, control: ledger.implementation.control.physical_lines, responsibility }));
