import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { runGuarantees } from '../../test/governance-parity/guarantees.mjs';

test('Both governance owners meet the shared synthetic G1-G18 contracts', async () => {
  await mkdir('.test-tmp/governance-parity', { recursive: true });
  const root = await mkdtemp('.test-tmp/governance-parity/check-');
  const rows = await runGuarantees(root, ['loom', 'control'], '', false);
  assert.deepEqual(rows.filter(r => !r.passed).map(r => ({ arm: r.arm, id: r.id, error: r.error })), []);
  assert.equal(new Set(rows.map(r => r.guarantee)).size, 18);
});
