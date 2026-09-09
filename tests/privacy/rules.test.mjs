import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPath, inspectText } from '../../scripts/privacy-rules.mjs';

test('publication rules detect synthetic private paths, credentials and unreviewed URLs', () => {
  const drivePath = ['Q:', 'Users', 'synthetic', 'case'].join(String.fromCharCode(92));
  const privateUrl = ['https:', '', 'internal.example.invalid', 'private-source'].join('/');
  const token = ['ghp', 'x'.repeat(36)].join('_');
  assert.ok(inspectText(drivePath).includes('absolute local path'));
  assert.ok(inspectText(privateUrl).includes('unreviewed external URL'));
  assert.ok(inspectText(token).includes('credential pattern'));
  assert.ok(inspectPath('local/reference-baseline.local.json').length > 0);
  assert.ok(inspectPath('.agent-container/task.json').length > 0);
});

test('public relative references and neutral project email pass', () => {
  assert.deepEqual(inspectText('fixtures/synthetic.json contributors@example.invalid'), []);
  assert.deepEqual(inspectPath('packages/container-core/src/index.ts'), []);
});
